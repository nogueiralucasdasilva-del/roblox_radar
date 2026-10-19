import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Data, Report, ReportItem, ReportsFile, SeedFile, SourcesFile, Stage } from '../types'
import { AMBER, BG, CLAY, FG, LINE, MUTED, NEON, NEON_BG, OLIVE, PANEL, RUST, SAND, SKY, USER_BG } from './theme'
import { ago, chatPanel, ideasView, knowledgeView, receiptsView, registryView, reportsView, sourcesView } from './views'
import type { Ctx } from './views'
import {
  HISTORY_CHARS,
  KNOWLEDGE_TAG,
  buildPrompt,
  clip,
  crudeSummary,
  emptyStore,
  extractInstructions,
  extractTagged,
  ideasAt,
  newIdea,
  parseKnowledge,
  parseTyped,
  promoteIdea,
  setIdeaStatus,
  isBusyStale,
  needsRollover,
  newThread,
  recentHistory,
  summarizerPrompt,
} from './model'
import { STALE_BUSY_MS } from './model'
import type { Idea, IdeaStatus, Job, Knowledge, LogEntry, Msg, Store, Thread } from './model'
import {
  KEEP_MESSAGES,
  MEMORY_FOLDER_ID,
  applyEvents,
  briefPrompt,
  crudeMemory,
  eventTitle,
  ideaChatPrompt,
  ideaHistory,
  ideaSnapshot,
  memoryPrompt,
  parseMemEvent,
  parsePotential,
  scanPrompt,
} from './memory'
import type { MemEvent } from './memory'
import { ICON_SVG } from './icon'
import { ideaBackground, ideaChatTitle, ideaOpening, parseLink, parseSessionId, stageBackground, stageChatTitle, stageOpening } from './chats'
import type { ChatLink } from './model'
import {
  RECEIPT_DAYS,
  RECEIPT_FOLDER_ID,
  STAGES_WITH_RECEIPTS,
  jsonOf,
  mergeReports,
  parseReceipt,
  receiptsFor,
  reportsFromReceipts,
  sourcesFromReceipt,
  stageHealth,
} from './receipts'
import type { Receipt } from './receipts'

const PANE = 'radar-panel'
const KEY = 'rr1'

const selected = atom({ plugin: 'radar-panel', key: 'selected' } as const, null)
const tab = atom({ plugin: 'radar-panel', key: 'tab' } as const, 'chat')
const rev = atom({ plugin: 'radar-panel', key: 'rev' } as const, 0)
const openIds = atom({ plugin: 'radar-panel', key: 'open' } as const, [] as string[])

type TabDef = { id: string; label: string }

// Chat first, then the tabs specific to the stage, then the common ones. Log only when it has something to show.
function tabsFor(stage: Stage, showLog: boolean): TabDef[] {
  const common: TabDef[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'tasks', label: 'Tasks' },
    { id: 'pending', label: 'Pending' },
    { id: 'assets', label: 'Skills and docs' },
  ]
  if (showLog) common.push({ id: 'log', label: 'Log' })
  const rec: TabDef[] = STAGES_WITH_RECEIPTS.includes(stage.id) ? [{ id: 'receipts', label: 'Receipts' }] : []
  return [{ id: 'chat', label: 'Chat' }, ...(stage.extra_tabs ?? []), ...rec, ...common]
}

/* ---------- live scheduled tasks ---------- */

const TRIGGERS = 'mcp__claude-code-remote__list_triggers'
const FETCH_MS = 5 * 60 * 1000
const REDRAW_MS = 60 * 1000

type LiveEntry = { name: string; enabled: boolean; status: string | null; firedAt: string | null; nextRun: string | null }
type Live = { at: string; byId: Record<string, LiveEntry> } | { at: string; error: string }

// Module variable: lost on a hot reload, refetched at session.start.
let live: Live | null = null

function textOf(r: any): string {
  if (typeof r.text === 'string') return r.text
  if (Array.isArray(r.content)) return r.content.map((b: any) => (b && typeof b.text === 'string' ? b.text : '')).join('')
  const x = r.result
  if (typeof x === 'string') return x
  if (Array.isArray(x)) return x.map((b: any) => (b && typeof b.text === 'string' ? b.text : '')).join('')
  if (x && Array.isArray(x.content)) return x.content.map((b: any) => (b && typeof b.text === 'string' ? b.text : '')).join('')
  return JSON.stringify(x ?? '')
}

async function fetchLive($: any): Promise<void> {
  const at = new Date().toISOString()
  try {
    const byId: Record<string, LiveEntry> = {}
    let cursor: string | undefined
    for (let page = 0; page < 20; page++) {
      const r: any = await $.tool.call(cursor ? { tool: TRIGGERS, limit: 100, cursor } : { tool: TRIGGERS, limit: 100 })
      if (r.deny || r.isError) throw new Error(String(r.deny || textOf(r)).slice(0, 120))
      const obj: any = JSON.parse(textOf(r))
      const list: any[] = Array.isArray(obj) ? obj : obj.data || obj.triggers || []
      for (const t of list) {
        if (!t || typeof t.id !== 'string') continue
        byId[t.id] = {
          name: String(t.name || t.id),
          enabled: t.enabled !== false,
          status: t.last_run && t.last_run.status ? String(t.last_run.status).replace('ROUTINE_RUN_STATUS_', '') : null,
          firedAt: t.last_run && t.last_run.fired_at ? String(t.last_run.fired_at) : null,
          nextRun: t.next_run_at ? String(t.next_run_at) : null,
        }
      }
      cursor = obj && !Array.isArray(obj) && obj.has_more && obj.next_cursor ? String(obj.next_cursor) : undefined
      if (!cursor) break
    }
    live = { at, byId }
  } catch (err: any) {
    live = { at, error: String((err && err.message) || err).slice(0, 140) }
  }
  await update($, rev, n => n + 1)
}

/* ---------- receipts from Drive ---------- */

// The runs write receipts to Drive. The connector's tool name differs by session, so the first
// spelling that answers is remembered. $.tool.call first, then the engine's own MCP connection.
const DRIVE_PREFIXES = ['mcp__claude_ai_Google_Drive__', 'mcp__Google_Drive__']
const DRIVE_SERVERS = ['claude.ai Google Drive', 'claude_ai_Google_Drive', 'Google Drive', 'Google_Drive']
const RECEIPT_KEY = 'rr1r'
const PLUGIN_NAME = 'radar-panel'
// Digits 1 to 9, then a, b, c for stages 10 to 12: press while the pane has focus.
const HOTKEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c']
const READS_PER_CYCLE = 25

type DriveHow = { kind: 'tool'; prefix: string } | { kind: 'mcp'; server: string }
type RState = { at: string; ok: boolean; error?: string; receipts: Receipt[] }

let driveHow: DriveHow | null = null
let rcp: RState | null = null
let rcpBusy = false
// File ids are immutable (a receipt is never edited), so a parsed receipt is cached for good. null = unreadable file.
const rcpCache = new Map<string, Receipt | null>()

// The session lists the tools it really has, so ask it instead of guessing spellings.
const DRIVE_TOOL_RE: Record<string, RegExp> = {
  search_files: /__(search_files|search|drive_search|list_files)$/i,
  read_file_content: /__(read_file_content|read_file|get_file_content|get_file)$/i,
}
const discovered: Record<string, string> = {}
let visibleMcp = ''

async function discoverDrive($: any, tool: string): Promise<string | null> {
  if (discovered[tool]) return discovered[tool] as string
  try {
    const list: { name: string; description?: string; mcp: boolean }[] = await $.tool.list()
    const mcpTools = list.filter(t => t.mcp)
    const servers = new Set<string>()
    for (const t of mcpTools) {
      const m = /^mcp__(.+?)__/.exec(t.name)
      if (m && m[1]) servers.add(m[1])
    }
    visibleMcp = servers.size > 0 ? `MCP tools visible here come from: ${[...servers].join(', ')}.` : 'No MCP tools are visible to the panel in this session.'
    // The desktop app names claude.ai connectors by an id (mcp__<uuid>__search_files), so the server name says
    // nothing. The tool name is the Drive connector's own, so match on it, then on the description.
    const exact = mcpTools.find(t => t.name.endsWith(`__${tool}`))
    const re = DRIVE_TOOL_RE[tool]
    const alt = re ? mcpTools.find(t => re.test(t.name) && /drive/i.test(`${t.name} ${t.description ?? ''}`)) : undefined
    const hit = exact ?? alt
    if (hit) discovered[tool] = hit.name
    return hit ? hit.name : null
  } catch {
    return null
  }
}

async function driveCall($: any, tool: string, args: Record<string, unknown>): Promise<string> {
  const errors: string[] = []
  const found = await discoverDrive($, tool)
  if (found) {
    // mcp__<server>__<tool>: a plain tool call first (goes through the permission flow), then the engine's own connection.
    const server = found.slice('mcp__'.length, found.length - tool.length - 2)
    const tries: { label: string; run: () => Promise<any> }[] = [
      { label: found, run: () => $.tool.call({ tool: found, ...args }) },
      { label: `mcp "${server}"`, run: () => $.mcp.call(server, tool, args) },
    ]
    for (const t of tries) {
      try {
        const r: any = await t.run()
        if (r && r.deny) errors.push(`${t.label}: denied ${String(r.deny).slice(0, 400)}`)
        else if (r && r.isError) errors.push(`${t.label}: error ${textOf(r).slice(0, 400)}`)
        else return textOf(r)
      } catch (err: any) {
        errors.push(`${t.label}: ${String((err && err.message) || err).replace(/^radar-panel: /, '').slice(0, 400)}`)
      }
    }
  }
  const all: DriveHow[] = [
    ...DRIVE_PREFIXES.map((prefix): DriveHow => ({ kind: 'tool', prefix })),
    ...DRIVE_SERVERS.map((server): DriveHow => ({ kind: 'mcp', server })),
  ]
  for (const how of driveHow ? [driveHow] : all) {
    const label = how.kind === 'tool' ? `${how.prefix}${tool}` : `mcp "${how.server}"`
    try {
      const r: any = how.kind === 'tool' ? await $.tool.call({ tool: `${how.prefix}${tool}`, ...args }) : await $.mcp.call(how.server, tool, args)
      if (r && r.deny) {
        errors.push(`${label}: denied`)
        continue
      }
      if (r && r.isError) {
        errors.push(`${label}: error ${textOf(r).slice(0, 80)}`)
        continue
      }
      driveHow = how
      return textOf(r)
    } catch {
      errors.push(label)
    }
  }
  driveHow = null
  // Nothing answered: say what the session does have, so the panel shows the real cause.
  throw new Error(`Google Drive is not reachable from this session. ${visibleMcp} ${errors.length > 0 && found ? errors.join(' | ') : ''}`.trim())
}

/* ---------- memory in Drive ---------- */

let flushBusy = false
let restoreBusy = false
let memError = ''
let version = ''

async function loadVersion($: any): Promise<string> {
  if (version) return version
  try {
    const o = JSON.parse(String(await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`)))
    version = typeof o?.version === 'string' ? o.version : 'dev'
  } catch {
    version = 'dev'
  }
  return version
}

function enqueue(s: Store, e: MemEvent): void {
  s.outbox.push({ title: eventTitle(e), content: JSON.stringify(e), at: e.at })
  if (s.outbox.length > 500) s.outbox = s.outbox.slice(-500)
}

// Writes waiting memory events to Drive, oldest first. A failure keeps them for the next cycle.
async function flushOutbox($: any): Promise<void> {
  if (flushBusy) return
  flushBusy = true
  try {
    const s0 = await loadStore($)
    const batch = s0.outbox.slice(0, 10)
    if (batch.length === 0) return
    const done: string[] = []
    for (const o of batch) {
      try {
        await driveCall($, 'create_file', { title: o.title, parentId: MEMORY_FOLDER_ID, contentMimeType: 'text/plain', textContent: o.content })
        done.push(`${o.title}|${o.at}`)
      } catch (err: any) {
        memError = String((err && err.message) || err).slice(0, 600)
        break
      }
    }
    if (done.length > 0) {
      memError = ''
      await mutate($, s => {
        s.outbox = s.outbox.filter(o => !done.includes(`${o.title}|${o.at}`))
        s.memSaved += done.length
      })
    }
  } finally {
    flushBusy = false
  }
}

// Once per install: replay the memory events saved in Drive, so a new machine or a reinstall starts where the last one stopped.
async function restoreMemory($: any): Promise<void> {
  if (restoreBusy) return
  const s0 = await loadStore($)
  if (s0.restoredAt) return
  restoreBusy = true
  try {
    const ids = new Set<string>()
    let pageToken: string | undefined
    for (let page = 0; page < 5; page++) {
      const raw = await driveCall($, 'search_files', {
        query: `parentId = '${MEMORY_FOLDER_ID}' and title contains 'mem_'`,
        pageSize: 100,
        excludeContentSnippets: true,
        ...(pageToken ? { pageToken } : {}),
      })
      const o: any = jsonOf(raw)
      const files: any[] = Array.isArray(o?.files) ? o.files : []
      for (const f of files) if (f && typeof f.id === 'string') ids.add(f.id)
      pageToken = typeof o?.nextPageToken === 'string' ? o.nextPageToken : undefined
      if (!pageToken || files.length === 0) break
    }
    const events: MemEvent[] = []
    for (const id of [...ids].slice(0, 300)) {
      try {
        const e = parseMemEvent(await driveCall($, 'read_file_content', { fileId: id }))
        if (e) events.push(e)
      } catch {
        // one unreadable file does not stop the restore
      }
    }
    await mutate($, s => {
      const n = applyEvents(s, events)
      s.restoredAt = new Date().toISOString()
      if (n > 0) addLog(s, 'prevalid', 'memory', `Restored ${n} memory events from Drive.`)
    })
  } catch (err: any) {
    memError = `Restore failed: ${String((err && err.message) || err).slice(0, 500)}`
  } finally {
    restoreBusy = false
  }
}

async function rewriteMemory($: any, label: string, old: string, user: string, answer: string): Promise<string> {
  try {
    const r = await $.model.complete({ model: 'haiku', prompt: memoryPrompt(label, old, user, answer), maxTokens: 700 })
    const t = r.isAnswered ? String(r.text).trim() : ''
    if (t) return t
  } catch {
    // fall through to the crude memory
  }
  return crudeMemory(old, user, answer)
}

// What every stage agent gets besides its own chat: its memory, the previous stage's memory, and the ideas in it.
function stageContext(data: Data, s: Store, stageId: string): string[] {
  const out: string[] = []
  const mem = s.memory[stageId]
  if (mem) out.push(`Memory of this stage (decisions and facts so far, updated ${mem.at.slice(0, 16)} UTC):`, mem.text)
  const idx = data.stages.findIndex(x => x.id === stageId)
  const prev = idx > 0 ? data.stages[idx - 1] : undefined
  const prevMem = prev ? s.memory[prev.id] : undefined
  if (prev && prevMem) out.push(`Memory of the previous stage, ${prev.name}:`, clip(prevMem.text, 1500))
  const here = s.ideas.filter(i => i.stage === stageId)
  if (here.length > 0) {
    out.push(
      'Ideas in this stage now:',
      ...here
        .slice(0, 12)
        .map(
          i =>
            `- ${i.title}${i.proto_id ? ` (${i.proto_id})` : ''}, ${i.status}${i.scan ? `, potential ${i.scan.level}` : ''}${i.memory ? `. Memory: ${clip(i.memory, 500)}` : ''}`,
        ),
    )
  }
  out.push(`Full transcripts are kept as files in the Drive folder roblox_radar_memory (id ${MEMORY_FOLDER_ID}). Search there if you need something older.`)
  return out
}

/* ---------- idea cards: quick scan, chat and brief ---------- */

const PURPOSE_LINE: Record<Job['purpose'], string> = {
  scan: 'Quick scan started.',
  brief: 'Full brief started.',
  chat: '',
}

// Fallback when the session refuses to start a background agent from a click (auto mode has no request to judge):
// the panel submits the job as a turn of the main chat, and the answer is copied back into the panel.
const mainQueue: string[] = []
let currentMain: string | null = null
let mainSeq = 0

function refusedByMode(msg: string): boolean {
  return /classifier|verdict|auto mode|denied|permission/i.test(msg)
}

async function submitMain($: any, job: Job, prompt: string, label: string): Promise<string> {
  const key = `main-${Date.now().toString(36)}-${mainSeq++}`
  await mutate($, s => {
    s.jobs[key] = job
  })
  mainQueue.push(key)
  const r: any = await $.prompt.submit({
    text: `[Roblox Radar panel: ${label}. Your full reply is copied into the panel, so answer only what is asked.]\n\n${prompt}`,
  })
  if (r && r.drop) {
    const i = mainQueue.indexOf(key)
    if (i >= 0) mainQueue.splice(i, 1)
    await mutate($, s => {
      delete s.jobs[key]
    })
    throw new Error(`The main chat refused the job: ${String(r.drop).slice(0, 200)}`)
  }
  return key
}

async function startIdeaJob($: any, ideaId: string, purpose: Job['purpose'], text: string): Promise<void> {
  const data = await load($)
  const s0 = await loadStore($)
  const idea = s0.ideas.find(i => i.id === ideaId)
  if (!data || !idea) return
  if (idea.busy && Date.now() - Date.parse(idea.busy.at) < STALE_BUSY_MS) {
    $.ui.toast('The agent is still working on this idea.')
    return
  }
  const stage = data.stages.find(x => x.id === idea.stage)
  const stageMem = s0.memory[idea.stage]?.text ?? ''
  const prompt =
    purpose === 'scan'
      ? scanPrompt(idea, stageMem)
      : purpose === 'brief'
        ? briefPrompt(idea)
        : ideaChatPrompt(idea, stage?.name ?? idea.stage, stageMem, ideaHistory(idea), text)
  const now = new Date().toISOString()
  await mutate($, s => {
    const i = s.ideas.find(x => x.id === ideaId)
    if (!i) return
    const msgs = i.messages ?? []
    msgs.push(purpose === 'chat' ? { role: 'user', text, at: now } : { role: 'system', text: PURPOSE_LINE[purpose], at: now })
    i.messages = msgs.slice(-KEEP_MESSAGES)
    i.busy = { agentId: 'pending', at: now }
  })
  const job: Job = { kind: 'idea', scope: ideaId, purpose }
  try {
    let agentId = ''
    let via = 'background agent'
    try {
      const started = await $.agent.spawn({ prompt, description: `Radar idea: ${clip(idea.title, 40)}`, subagentType: 'general-purpose' })
      if (started.deny) throw new Error(String(started.deny))
      agentId = String(started.agentId)
    } catch (err: any) {
      const msg = String((err && err.message) || err)
      if (!refusedByMode(msg)) throw err
      agentId = await submitMain($, job, prompt, `${purpose} for the idea "${clip(idea.title, 60)}"`)
      via = 'main chat'
    }
    await mutate($, s => {
      const i = s.ideas.find(x => x.id === ideaId)
      if (i) i.busy = { agentId, at: new Date().toISOString() }
      s.jobs[agentId] = job
      addLog(s, idea.stage, 'agent', `Idea agent started for "${clip(idea.title, 40)}" (${purpose}, ${via}).`)
      if (via === 'main chat' && i) i.messages = [...(i.messages ?? []), { role: 'system', text: 'Running in the main chat, the answer lands here when it ends.', at: new Date().toISOString() }]
    })
  } catch (err: any) {
    await mutate($, s => {
      const i = s.ideas.find(x => x.id === ideaId)
      if (!i) return
      i.busy = null
      i.messages = [...(i.messages ?? []), { role: 'system', text: `Could not start the agent: ${String((err && err.message) || err).slice(0, 200)}`, at: new Date().toISOString() }]
    })
  }
}

async function onIdeaDone($: any, agentId: string, job: Job, answer: string, reason: string): Promise<void> {
  let user = ''
  let clean = ''
  let ok = false
  const now = new Date().toISOString()
  await mutate($, s => {
    delete s.jobs[agentId]
    const i = s.ideas.find(x => x.id === job.scope)
    if (!i) return
    i.busy = null
    const msgs = i.messages ?? []
    if (reason !== 'answer') {
      msgs.push({ role: 'system', text: `The agent stopped (${reason}). Try again.`, at: now })
      i.messages = msgs
      return
    }
    clean = answer.trim() || '(empty answer)'
    user = job.purpose === 'chat' ? ([...msgs].reverse().find(m => m.role === 'user')?.text ?? '') : PURPOSE_LINE[job.purpose]
    msgs.push({ role: 'assistant', text: clean, at: now })
    i.messages = msgs.slice(-KEEP_MESSAGES)
    if (job.purpose === 'scan') {
      const level = parsePotential(clean)
      if (level) i.scan = { level, at: now }
    }
    i.updated = now
    ok = true
    addLog(s, i.stage, 'ideas', `Agent answered on "${clip(i.title, 40)}" (${job.purpose}).`)
  })
  if (!ok) return
  const s1 = await loadStore($)
  const idea = s1.ideas.find(x => x.id === job.scope)
  if (!idea) return
  const memText = await rewriteMemory($, `the idea "${idea.title}"`, idea.memory ?? '', user, clean)
  await mutate($, s => {
    const i = s.ideas.find(x => x.id === job.scope)
    if (!i) return
    i.memory = memText
    enqueue(s, { v: 1, kind: 'exchange', scope: `idea:${i.id}`, at: now, stage: i.stage, user, answer: clean, purpose: job.purpose, memory: memText, idea: ideaSnapshot(i) })
  })
  void flushOutbox($)
}

/* ---------- real chats: one app conversation per idea card and per stage ---------- */
// Nothing here starts on its own: a conversation is started only when Lucas clicks, and the app asks him to approve it.

const chatBusy = new Set<string>()
type PendingChat = { key: string; kind: 'idea' | 'stage'; scope: string; title: string; prompt: string; background: string }
const pendingChats = new Map<string, PendingChat>()
let lastPending: string | null = null
// What Lucas types after clicking a card whose conversation does not exist yet.
const OPEN_WORDS = ['abrir chat', 'abre o chat', 'abrir o chat', 'abre chat', 'open chat', 'abrir', 'abre']
const CHAT_MARK = /\[radar:((?:idea|stage):[^\]]+)\]/

// The main chat started a conversation for a pending request: tie it to its card or stage.
async function saveStartedChat($: any, p: PendingChat, id: string): Promise<void> {
  let link: string | null = null
  try {
    link = parseLink(await ccdCall($, 'ccd_session_mgmt', 'get_session', { session_id: id }))
  } catch {
    // the link is a convenience
  }
  const chat: ChatLink = { id, title: p.title, link, at: new Date().toISOString(), syncedAt: null, seen: 0 }
  await mutate($, s => {
    if (p.kind === 'idea') {
      const i = s.ideas.find(x => x.id === p.scope)
      if (i) i.chat = chat
      addLog(s, i ? i.stage : 'prevalid', 'chat', `Chat started: ${p.title}.`)
    } else {
      s.stageChats[p.scope] = chat
      addLog(s, p.scope, 'chat', `Chat started: ${p.title}.`)
    }
  })
  pendingChats.delete(p.key)
  delete chatError[p.key]
}
const chatError: Record<string, string> = {}
let syncBusy = false
const GROUP_NAME = 'Roblox Radar'

// Calls one of the desktop app's own tools (ccd_*) through the normal permission check.
async function ccdCall($: any, server: string, tool: string, args: Record<string, unknown>): Promise<string> {
  const name = `mcp__${server}__${tool}`
  const r: any = await $.tool.call({ tool: name, ...args })
  if (r && r.deny) throw new Error(`${name} denied: ${String(r.deny).slice(0, 300)}`)
  if (r && r.isError) throw new Error(`${name} failed: ${textOf(r).slice(0, 300)}`)
  return textOf(r)
}

function hashText(t: string): number {
  let h = 5381
  for (let i = 0; i < t.length; i++) h = ((h * 33) ^ t.charCodeAt(i)) | 0
  return h
}

// The potential the chat settled on last; the template line of the opening ("HIGH, MEDIUM or LOW") is skipped.
function lastPotential(text: string): string | null {
  let found: string | null = null
  for (const m of text.matchAll(/potential\s*:\s*\**\s*(high|medium|low)\b(?!\s*,\s*medium or)/gi)) {
    if (m[1]) found = m[1].toUpperCase()
  }
  return found
}

async function showChat($: any, chat: ChatLink): Promise<void> {
  for (const target of ['split', 'window']) {
    try {
      await ccdCall($, 'ccd_window', 'open_session_in', { session_id: chat.id, target })
      return
    } catch {
      // try the next way to show it
    }
  }
  $.ui.toast(`Open "${chat.title}" from the sidebar, in the ${GROUP_NAME} group.`)
}

// Files a new conversation under the Roblox Radar sidebar group, so the Radar chats never mix with the rest.
async function fileInGroup($: any, sessionId: string): Promise<void> {
  try {
    const listed: any = jsonOf(await ccdCall($, 'ccd_sidebar', 'list_groups', {}))
    const groups: any[] = Array.isArray(listed) ? listed : Array.isArray(listed?.groups) ? listed.groups : []
    let gid: string | undefined = groups.find(g => g && g.name === GROUP_NAME)?.id
    if (!gid) {
      const made: any = jsonOf(await ccdCall($, 'ccd_sidebar', 'create_group', { name: GROUP_NAME }))
      gid = typeof made === 'string' ? made : (made?.id ?? made?.group_id)
    }
    if (gid) await ccdCall($, 'ccd_sidebar', 'move_sessions', { session_ids: [sessionId], group_id: gid })
  } catch {
    // grouping is tidy-up only
  }
}

// Opens the conversation of an idea card or a stage. The first click starts it (the app asks to approve);
// every later click reopens the same one.
async function openChat($: any, kind: 'idea' | 'stage', scope: string): Promise<void> {
  const key = `${kind}:${scope}`
  if (chatBusy.has(key)) return
  chatBusy.add(key)
  await update($, rev, n => n + 1)
  try {
    const data = await load($)
    const s0 = await loadStore($)
    if (!data) throw new Error('Could not read the stage data.')
    const existing = kind === 'idea' ? s0.ideas.find(i => i.id === scope)?.chat : s0.stageChats[scope]
    if (existing) {
      await showChat($, existing)
      void syncChats($)
      return
    }
    let title = ''
    let prompt = ''
    let background = ''
    let logStage = scope
    if (kind === 'idea') {
      const idea = s0.ideas.find(i => i.id === scope)
      if (!idea) throw new Error('Idea not found.')
      title = ideaChatTitle(idea)
      prompt = ideaOpening(idea, idea.stage === 'prevalid' && !idea.scan)
      background = ideaBackground()
      logStage = idea.stage
    } else {
      const stage = data.stages.find(x => x.id === scope)
      if (!stage) throw new Error('Stage not found.')
      title = stageChatTitle(stage)
      prompt = stageOpening(stage, data.updated, stageContext(data, s0, scope))
      background = stageBackground()
    }
    // A new conversation is started by Lucas's own message: the panel writes the request in the message box,
    // he presses Enter, and the main chat starts the conversation (the app asks him to approve it).
    pendingChats.set(key, { key, kind, scope, title, prompt, background })
    lastPending = key
    const label = kind === 'idea' ? `the idea "${title.replace(/^Radar idea: /, '')}"` : `the ${title.replace(/^Radar stage: /, '')} stage`
    const request = `Open the Roblox Radar chat for ${label} [radar:${key}]`
    let filled = false
    try {
      const r: any = await $.prompt.fill({ text: request })
      filled = !!(r && r.isFilled)
    } catch {
      filled = false
    }
    chatError[key] = filled
      ? 'Press Enter in the message box to start this chat. The app may ask you to approve it.'
      : 'Now type "abrir chat" in the message box and press Enter. The app may ask you to approve it.'
  } catch (err: any) {
    chatError[key] = String((err && err.message) || err).slice(0, 700)
  } finally {
    chatBusy.delete(key)
    await update($, rev, n => n + 1)
  }
}

// "Yes" on a card: the idea moves to the brief stage and its own chat opens, where Lucas confirms the brief.
async function ideaYes($: any, ideaId: string, stages: Stage[]): Promise<void> {
  const chat = (await loadStore($)).ideas.find(x => x.id === ideaId)?.chat
  await promote($, ideaId, stages)
  if (!chat) return
  chatError[`idea:${ideaId}`] = 'Moved to the 2-page brief. Type "yes" in its chat and it writes the brief.'
  await showChat($, chat)
  await update($, rev, n => n + 1)
}

// Reads the linked conversations that changed and files them as memory: the note of the idea or stage, and the
// transcript as a new file in Drive. Read only on the app side.
async function syncChats($: any): Promise<void> {
  if (syncBusy) return
  syncBusy = true
  try {
    const s0 = await loadStore($)
    const targets: { kind: 'idea' | 'stage'; scope: string; chat: ChatLink; label: string; old: string }[] = []
    for (const i of s0.ideas) if (i.chat) targets.push({ kind: 'idea', scope: i.id, chat: i.chat, label: `the idea "${i.title}"`, old: i.memory ?? '' })
    for (const [sid, chat] of Object.entries(s0.stageChats)) targets.push({ kind: 'stage', scope: sid, chat, label: `the "${sid}" stage`, old: s0.memory[sid]?.text ?? '' })
    for (const t of targets.slice(0, 20)) {
      let text = ''
      try {
        text = await ccdCall($, 'ccd_session_mgmt', 'list_events', { session_id: t.chat.id, limit: 40 })
      } catch {
        continue
      }
      const h = hashText(text)
      if (h === t.chat.seen) continue
      const tail = text.slice(-8000)
      const memText = await rewriteMemory($, t.label, t.old, '(the conversation continued; transcript tail below)', tail)
      const at = new Date().toISOString()
      const level = t.kind === 'idea' ? lastPotential(text) : null
      await mutate($, s => {
        if (t.kind === 'idea') {
          const i = s.ideas.find(x => x.id === t.scope)
          if (!i || !i.chat) return
          i.memory = memText
          if (level) i.scan = { level, at }
          i.chat = { ...i.chat, seen: h, syncedAt: at }
          enqueue(s, { v: 1, kind: 'exchange', scope: `idea:${i.id}`, at, stage: i.stage, user: 'transcript', answer: tail, purpose: 'chat', memory: memText, idea: ideaSnapshot(i) })
        } else {
          const c = s.stageChats[t.scope]
          if (!c) return
          s.memory[t.scope] = { text: memText, at }
          s.stageChats[t.scope] = { ...c, seen: h, syncedAt: at }
          enqueue(s, { v: 1, kind: 'exchange', scope: t.scope, at, stage: t.scope, user: 'transcript', answer: tail, purpose: 'chat', memory: memText })
        }
      })
    }
  } finally {
    syncBusy = false
  }
  void flushOutbox($)
}

async function fetchReceipts($: any): Promise<void> {
  if (rcpBusy) return
  rcpBusy = true
  const at = new Date().toISOString()
  try {
    if (rcpCache.size === 0) {
      const saved: any = await $.store.get(RECEIPT_KEY)
      for (const r of Array.isArray(saved?.receipts) ? saved.receipts : []) {
        if (r && typeof r.fileId === 'string') rcpCache.set(r.fileId, r as Receipt)
      }
      if (!rcp && rcpCache.size > 0) rcp = { at, ok: true, receipts: [...rcpCache.values()].filter((x): x is Receipt => !!x) }
    }
    const cutoff = new Date(Date.now() - RECEIPT_DAYS * 86400000).toISOString()
    const files: { id: string; created: string }[] = []
    let token: string | undefined
    for (let page = 0; page < 5; page++) {
      const text = await driveCall($, 'search_files', {
        query: `parentId = '${RECEIPT_FOLDER_ID}' and createdTime > '${cutoff}'`,
        pageSize: 100,
        excludeContentSnippets: true,
        ...(token ? { pageToken: token } : {}),
      })
      const obj = jsonOf(text)
      for (const f of Array.isArray(obj.files) ? obj.files : []) {
        if (f && typeof f.id === 'string' && String(f.title ?? '').startsWith('receipt_')) files.push({ id: f.id, created: String(f.createdTime ?? '') })
      }
      token = obj.nextPageToken || obj.next_page_token || undefined
      if (!token) break
    }
    files.sort((a, b) => b.created.localeCompare(a.created))
    let reads = 0
    for (const f of files) {
      if (rcpCache.has(f.id)) continue
      if (reads >= READS_PER_CYCLE) break
      reads += 1
      try {
        rcpCache.set(f.id, parseReceipt(await driveCall($, 'read_file_content', { fileId: f.id }), f.id))
      } catch {
        // Leave it uncached: the next cycle tries again.
      }
    }
    const ids = new Set(files.map(f => f.id))
    const list = [...rcpCache.values()]
      .filter((r): r is Receipt => !!r && ids.has(r.fileId))
      .sort((a, b) => b.finished_utc.localeCompare(a.finished_utc))
      .slice(0, 80)
    await $.store.set(RECEIPT_KEY, { receipts: list })
    rcp = { at, ok: true, receipts: list }
  } catch (err: any) {
    rcp = { at, ok: false, error: String((err && err.message) || err).slice(0, 1400), receipts: rcp ? rcp.receipts : [] }
  } finally {
    rcpBusy = false
  }
  await update($, rev, n => n + 1)
}

function stamp(iso: string | null): string {
  return iso ? `${iso.slice(0, 16).replace('T', ' ')} UTC` : 'never'
}

// Live level from the scheduled tasks bound to the stage: 0 ok, 1 attention, 2 error.
function liveOf(s: Stage): { level: number; lines: string[] } {
  const lines: string[] = []
  let level = 0
  // What the runs themselves reported, from their receipts in Drive.
  if (rcp && rcp.receipts.length > 0) {
    const h = stageHealth(rcp.receipts, s.id, Date.now())
    level = h.level
    for (const l of h.lines) lines.push(`Receipt, ${l}`)
  }
  if (s.trigger_ids.length === 0) return { level, lines }
  if (!live) return { level, lines: [...lines, 'Live status: not queried yet.'] }
  if ('error' in live) return { level, lines: [...lines, `Live status unavailable: ${live.error}`] }
  for (const id of s.trigger_ids) {
    const t = live.byId[id]
    if (!t) {
      level = Math.max(level, 2)
      lines.push(`${id}: not found in the account`)
      continue
    }
    if (!t.enabled) level = Math.max(level, 2)
    else if (!t.status) level = Math.max(level, 1)
    else if (t.status !== 'SUCCEEDED') level = Math.max(level, 2)
    lines.push(
      `${t.name}: ${t.enabled ? 'on' : 'PAUSED'}, last run ${t.status || 'none'} (${stamp(t.firedAt)}), next ${stamp(t.nextRun)}`,
    )
  }
  return { level, lines }
}

/* ---------- data and store ---------- */

function dataPath($: any): string {
  return `${$.plugin.root}/data/stages.json`
}

async function load($: any): Promise<Data | null> {
  try {
    return JSON.parse(String(await $.fs.read(dataPath($)))) as Data
  } catch {
    return null
  }
}

async function loadJson<T>($: any, name: string, ok: (x: any) => boolean): Promise<T | null> {
  try {
    const x = JSON.parse(String(await $.fs.read(`${$.plugin.root}/data/${name}`)))
    return ok(x) ? (x as T) : null
  } catch {
    return null
  }
}

const loadSources = ($: any) => loadJson<SourcesFile>($, 'sources.json', x => Array.isArray(x?.sources))
const loadReports = ($: any) => loadJson<ReportsFile>($, 'reports.json', x => Array.isArray(x?.reports))
const loadSeed = ($: any) => loadJson<SeedFile>($, 'seed.json', x => Array.isArray(x?.ideas) && typeof x?.knowledge === 'object')

async function loadStore($: any): Promise<Store> {
  const raw = (await $.store.get(KEY)) as Partial<Store> | undefined
  // Merge over defaults so a store saved by an older build still loads.
  return raw && raw.threads ? { ...emptyStore(), ...raw } : emptyStore()
}

// First run: import the ideas and the knowledge seeds once.
async function ensureSeed($: any): Promise<void> {
  const s0 = await loadStore($)
  if (s0.seeded) return
  const seed = await loadSeed($)
  if (!seed) return
  await mutate($, s => {
    if (s.seeded) return
    const now = new Date().toISOString()
    seed.ideas.forEach((x, n) => {
      s.ideas.push(newIdea(x.title, x.note, x.origin, null, now, n))
    })
    for (const [stage, list] of Object.entries(seed.knowledge)) {
      const cur = s.knowledge[stage] ?? []
      list.forEach((k, n) => {
        cur.push({ id: `seed-${stage}-${n}`, kind: k.kind as Knowledge['kind'], text: k.text, source: k.source, tag: k.tag, at: now })
      })
      s.knowledge[stage] = cur
    }
    s.seeded = true
    addLog(s, 'prevalid', 'ideas', `Imported ${seed.ideas.length} ideas from the project docs.`)
  })
}

async function mutate($: any, fn: (s: Store) => void): Promise<void> {
  const s = await loadStore($)
  fn(s)
  await $.store.set(KEY, s)
  await update($, rev, n => n + 1)
}

function addLog(s: Store, stage: string, kind: string, text: string): void {
  const list = s.log[stage] ?? []
  list.push({ at: new Date().toISOString(), kind, text })
  s.log[stage] = list.slice(-200)
}

function threadOf(s: Store, stage: string): Thread {
  let t = s.threads[stage]
  if (!t) {
    t = newThread(1, '', new Date().toISOString())
    s.threads[stage] = t
  }
  return t
}

/* ---------- ideas and knowledge actions ---------- */

const toggleOpen = ($: any, id: string) => update($, openIds, (list: string[]) => (list.includes(id) ? list.filter(x => x !== id) : [...list, id]))

async function sendItem($: any, report: Report, si: number, ii: number): Promise<void> {
  const item = report.sections[si]?.items[ii]
  if (!item) return
  const from = `${report.id}#${si}.${ii}`
  let newId = ''
  await mutate($, s => {
    if (s.ideas.some(i => i.from === from)) return
    const now = new Date().toISOString()
    const idea = newIdea(item.title, `${item.note} (from the ${report.title} report of ${report.date}, section "${report.sections[si]?.name ?? ''}")`, 'advisor', from, now, s.ideas.length)
    s.ideas.push(idea)
    newId = idea.id
    enqueue(s, { v: 1, kind: 'idea', scope: `idea:${idea.id}`, at: now, stage: idea.stage, idea: ideaSnapshot(idea) })
    addLog(s, 'triagem', 'ideas', `Sent "${item.title}" from the ${report.date} report to pre-validation.`)
    addLog(s, 'prevalid', 'ideas', `Received "${item.title}" from the advisor report of ${report.date}.`)
  })
  $.ui.toast(`Sent to pre-validation: ${item.title}`)
}

async function saveHook($: any, report: Report, item: ReportItem): Promise<void> {
  await mutate($, s => {
    const list = s.knowledge.thumb ?? []
    const text = `Hook "${item.title}": ${item.note}`
    if (list.some(k => k.text === text)) return
    list.push({ id: `hook-${Date.now().toString(36)}-${list.length}`, kind: 'pattern', text, source: `Weekly thumbnail report ${report.date}`, tag: 'F', at: new Date().toISOString() })
    s.knowledge.thumb = list
    addLog(s, 'thumb', 'knowledge', `Saved hook "${item.title}" from the ${report.date} report.`)
  })
  $.ui.toast(`Saved to the Thumbnail repository: ${item.title}`)
}

async function setStatus($: any, ideaId: string, status: IdeaStatus): Promise<void> {
  await mutate($, s => {
    const idea = s.ideas.find(i => i.id === ideaId)
    if (!idea) return
    setIdeaStatus(idea, status, new Date().toISOString())
    addLog(s, idea.stage, 'ideas', `"${idea.title}" set to ${status}.`)
    enqueue(s, { v: 1, kind: 'idea', scope: `idea:${idea.id}`, at: idea.updated, stage: idea.stage, idea: ideaSnapshot(idea) })
  })
  void flushOutbox($)
}

async function promote($: any, ideaId: string, stages: Stage[]): Promise<void> {
  let msg = ''
  await mutate($, s => {
    const idea = s.ideas.find(i => i.id === ideaId)
    if (!idea) return
    const from = idea.stage
    const taken = s.ideas.map(i => i.proto_id).filter((x): x is string => !!x)
    if (!promoteIdea(idea, taken, new Date().toISOString())) return
    const name = stages.find(x => x.id === idea.stage)?.name ?? idea.stage
    msg = `"${idea.title}" moved to ${name}${idea.proto_id ? ` as ${idea.proto_id}` : ''}.`
    addLog(s, from, 'ideas', msg)
    addLog(s, idea.stage, 'ideas', `Received "${idea.title}".`)
    enqueue(s, { v: 1, kind: 'handoff', scope: `idea:${idea.id}`, at: idea.updated, stage: idea.stage, memory: idea.memory ?? '', idea: ideaSnapshot(idea) })
  })
  if (msg) $.ui.toast(msg)
  void flushOutbox($)
}

// "Yes" on a quick scan: the idea moves to the brief stage and the brief agent starts on it.
async function briefIdea($: any, ideaId: string, stages: Stage[]): Promise<void> {
  await promote($, ideaId, stages)
  const s = await loadStore($)
  const i = s.ideas.find(x => x.id === ideaId)
  if (i && i.stage === 'brief') await startIdeaJob($, ideaId, 'brief', '')
}

async function addIdea($: any, raw: string): Promise<void> {
  const title = raw.trim()
  if (!title) return
  let newId = ''
  await mutate($, s => {
    const now = new Date().toISOString()
    const idea = newIdea(title.slice(0, 120), title.length > 120 ? title : '', 'own', null, now, s.ideas.length)
    s.ideas.push(idea)
    newId = idea.id
    addLog(s, 'prevalid', 'ideas', `Added your idea "${title.slice(0, 60)}".`)
    enqueue(s, { v: 1, kind: 'idea', scope: `idea:${idea.id}`, at: now, stage: idea.stage, idea: ideaSnapshot(idea) })
  })
}

async function addKnowledge($: any, stageId: string, raw: string): Promise<void> {
  const k = parseTyped(raw)
  if (!k) return
  await mutate($, s => {
    const list = s.knowledge[stageId] ?? []
    list.push({ id: `u-${Date.now().toString(36)}-${list.length}`, kind: k.kind, text: k.text, source: 'you', tag: 'unrated', at: new Date().toISOString() })
    s.knowledge[stageId] = list
    addLog(s, stageId, 'knowledge', `Added a ${k.kind}.`)
  })
}

async function removeKnowledge($: any, stageId: string, id: string): Promise<void> {
  await mutate($, s => {
    s.knowledge[stageId] = (s.knowledge[stageId] ?? []).filter(k => k.id !== id)
    addLog(s, stageId, 'knowledge', 'Removed an entry.')
  })
}

function findStage(data: Data, query: string): Stage | undefined {
  const q = query.trim().toLowerCase()
  if (!q) return undefined
  return (
    data.stages.find(s => s.id === q) ||
    data.stages.find(s => s.name.toLowerCase().includes(q)) ||
    data.stages.find(s => s.id.startsWith(q))
  )
}

type Tone = { label: string; color: string; glyph: string }

function toneOf(s: Stage): Tone {
  if (s.build === 'not_built') return { label: 'NOT BUILT', color: SAND, glyph: '○' }
  const lv = liveOf(s).level
  if ((s.flag && s.flag.level === 'err') || lv === 2) return { label: 'ERROR', color: RUST, glyph: '●' }
  if (s.build === 'partial' || s.flag || lv === 1) return { label: 'ATTENTION', color: AMBER, glyph: '●' }
  return { label: 'OK', color: OLIVE, glyph: '●' }
}

function openCount(s: Stage): number {
  return s.pendencies.filter(p => !p.done).length
}

function stateColor(state: string): string {
  const x = state.toLowerCase()
  if (x === 'installed') return OLIVE
  if (x === 'proposed' || x === 'deferred') return AMBER
  if (x === 'does not exist') return SAND
  return SKY
}

/* ---------- diagnostics ---------- */

const diag: Record<string, unknown> = {}

async function note($: any, key: string, value: unknown): Promise<void> {
  diag[key] = value
  diag.writtenAt = new Date().toISOString()
  try {
    await $.fs.write(`${$.plugin.root}/diag.json`, JSON.stringify(diag, null, 1))
  } catch {
    // diagnostics are best effort
  }
}

/* ---------- stage chats ---------- */

async function rollover($: any, stageId: string, reason: string): Promise<void> {
  const before = await loadStore($)
  const old = before.threads[stageId]
  if (!old || old.messages.length === 0) return
  let summary = ''
  try {
    const r = await $.model.complete({ model: 'haiku', prompt: summarizerPrompt(old.summary, old.messages), maxTokens: 700 })
    summary = r.isAnswered ? String(r.text).trim() : ''
  } catch {
    summary = ''
  }
  if (!summary) summary = crudeSummary(old.summary, old.messages)
  await mutate($, s => {
    const cur = s.threads[stageId]
    if (!cur) return
    const now = new Date().toISOString()
    const arch = s.archive[stageId] ?? []
    arch.push({
      id: cur.id,
      n: cur.n,
      startedAt: cur.startedAt,
      endedAt: now,
      reason,
      summary,
      messageCount: cur.messages.length,
    })
    s.archive[stageId] = arch.slice(-30)
    const next = newThread(cur.n + 1, summary, now)
    next.messages.push({ role: 'system', text: `New chat #${next.n} started (${reason}). Carried over: ${clip(summary, 500)}`, at: now })
    s.threads[stageId] = next
    addLog(s, stageId, 'chat', `Chat #${cur.n} closed (${reason}, ${cur.messages.length} messages) and chat #${next.n} started with a summary.`)
  })
}

async function suggestStage($: any, current: string, text: string, data: Data): Promise<void> {
  if (text.length < 25) return
  try {
    const list = data.stages.map(s => `${s.id}: ${s.name}. ${s.desc}`).join('\n')
    const hit = (await $.model.classify(
      `Pipeline stages:\n${list}\n\nWhich single stage is the message below mainly about?\nMessage: ${text}`,
      data.stages.map(s => s.id),
    )) as string | undefined
    const target = hit ? data.stages.find(s => s.id === hit) : undefined
    if (!target || target.id === current) return
    await mutate($, s => {
      const t = threadOf(s, current)
      t.messages.push({ role: 'system', text: `This looks like it belongs to "${target.name}".`, at: new Date().toISOString(), moveTo: target.id })
    })
  } catch {
    // the suggestion is optional
  }
}

async function sendMessage($: any, stageId: string, raw: string): Promise<void> {
  const text = raw.trim()
  if (!text) return
  const data = await load($)
  const stage = data ? data.stages.find(s => s.id === stageId) : undefined
  if (!data || !stage) {
    $.ui.toast('Could not read the stage data.')
    return
  }
  const s0 = await loadStore($)
  const t0 = threadOf(s0, stageId)
  if (t0.busy && !isBusyStale(t0, Date.now())) {
    $.ui.toast('The stage agent is still answering the previous message.')
    return
  }
  const summary = t0.summary
  const history = recentHistory(t0.messages, HISTORY_CHARS)
  const prompt = buildPrompt(
    stage,
    data.updated,
    s0.instructions[stageId] ?? [],
    summary,
    history,
    text,
    !!stage.extra_tabs?.some(t => t.id === 'knowledge'),
    stageContext(data, s0, stageId),
  )
  await mutate($, s => {
    const t = threadOf(s, stageId)
    t.messages.push({ role: 'user', text, at: new Date().toISOString() })
    t.busy = { agentId: 'pending', at: new Date().toISOString() }
  })
  try {
    let agentId = ''
    try {
      const started = await $.agent.spawn({ prompt, description: `Radar: ${stage.name}`, subagentType: 'general-purpose' })
      if (started.deny) throw new Error(String(started.deny))
      agentId = String(started.agentId)
    } catch (err: any) {
      const msg = String((err && err.message) || err)
      if (!refusedByMode(msg)) throw err
      agentId = await submitMain($, { kind: 'stage', scope: stageId, purpose: 'chat' }, prompt, `message for the ${stage.name} stage`)
    }
    await mutate($, s => {
      const t = threadOf(s, stageId)
      t.busy = { agentId, at: new Date().toISOString() }
      s.jobs[agentId] = { kind: 'stage', scope: stageId, purpose: 'chat' }
      addLog(s, stageId, 'agent', `Agent started (${agentId.slice(0, 12)}).`)
    })
  } catch (err: any) {
    await mutate($, s => {
      const t = threadOf(s, stageId)
      t.busy = null
      t.messages.push({ role: 'system', text: `Could not start the stage agent: ${String((err && err.message) || err).slice(0, 200)}`, at: new Date().toISOString() })
      addLog(s, stageId, 'error', `Agent failed to start: ${String((err && err.message) || err).slice(0, 120)}`)
    })
    return
  }
  void suggestStage($, stageId, text, data)
}

async function onAgentDone($: any, agentId: string, answer: string, reason: string): Promise<void> {
  const s0 = await loadStore($)
  const job = s0.jobs[agentId]
  if (job && job.kind === 'idea') return onIdeaDone($, agentId, job, answer, reason)
  const stageId = job ? job.scope : Object.keys(s0.threads).find(k => s0.threads[k]?.busy?.agentId === agentId)
  if (!stageId) return
  let shouldRoll = false
  let said = ''
  let asked = ''
  await mutate($, s => {
    delete s.jobs[agentId]
    const t = threadOf(s, stageId)
    t.busy = null
    const now = new Date().toISOString()
    if (reason !== 'answer') {
      t.messages.push({ role: 'system', text: `The stage agent stopped (${reason}). Send the message again.`, at: now })
      addLog(s, stageId, 'error', `Agent ended with ${reason}.`)
      return
    }
    const ex1 = extractInstructions(answer)
    const ex2 = extractTagged(ex1.clean, KNOWLEDGE_TAG)
    const clean = ex2.clean
    const found = ex1.found
    asked = [...t.messages].reverse().find(m => m.role === 'user')?.text ?? ''
    said = clean || '(empty answer)'
    t.messages.push({ role: 'assistant', text: said, at: now })
    addLog(s, stageId, 'agent', `Agent answered (${clean.length} chars).`)
    if (found.length > 0) {
      const list = s.instructions[stageId] ?? []
      for (const rule of found) {
        if (!list.includes(rule)) list.push(rule)
        addLog(s, stageId, 'instruction', `Standing instruction saved: ${rule}`)
        t.messages.push({ role: 'system', text: `Saved as a standing instruction for this stage: ${rule}`, at: now })
      }
      s.instructions[stageId] = list.slice(-20)
    }
    for (const line of ex2.found) {
      const k = parseKnowledge(line)
      if (!k) continue
      const list = s.knowledge[stageId] ?? []
      list.push({ id: `a-${Date.now().toString(36)}-${list.length}`, kind: k.kind, text: k.text, source: 'stage agent', tag: 'unrated', at: now })
      s.knowledge[stageId] = list
      addLog(s, stageId, 'knowledge', `Saved a ${k.kind} from the stage agent.`)
      t.messages.push({ role: 'system', text: `Saved to the repository as a ${k.kind}: ${clip(k.text, 160)}`, at: now })
    }
    shouldRoll = needsRollover(t)
  })
  if (said) {
    const old = (await loadStore($)).memory[stageId]?.text ?? ''
    const memText = await rewriteMemory($, `the "${stageId}" stage`, old, asked, said)
    const at = new Date().toISOString()
    await mutate($, s => {
      s.memory[stageId] = { text: memText, at }
      enqueue(s, { v: 1, kind: 'exchange', scope: stageId, at, stage: stageId, user: asked, answer: said, purpose: 'chat', memory: memText })
    })
    void flushOutbox($)
  }
  if (shouldRoll) await rollover($, stageId, 'chat got long')
}

/* ---------- register ---------- */

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'panel', description: 'Open the Roblox Radar panel' })
    await $.command.register({ name: 'stage', description: 'Focus a stage: /stage <name or id>, or /stage clear' })
    const opened = await $.ui.open({ id: PANE, title: 'Roblox Radar', rows: 50, columns: 170 })
    await note($, 'open_at_session_start', opened)
    await note($, 'surfaces_at_session_start', await $.session.surfaces())
    void ensureSeed($)
    void fetchLive($)
    void fetchReceipts($)
    void restoreMemory($).then(() => flushOutbox($))
    $.clock.every(60 * 1000, () => void flushOutbox($))
    $.clock.every(5 * 60 * 1000, () => void syncChats($))
    $.clock.every(FETCH_MS, () => void fetchLive($))
    $.clock.every(FETCH_MS, () => void fetchReceipts($))
    $.clock.every(REDRAW_MS, () => void update($, rev, n => n + 1))
    return next(e)
  })

  on('session.attach', async ($, e, next) => {
    const opened = await $.ui.open({ id: PANE, title: 'Roblox Radar', rows: 50, columns: 170 })
    await note($, 'open_at_attach', opened)
    await note($, 'surfaces_at_attach', await $.session.surfaces())
    return next(e)
  })

  on('command.run', { command: 'panel' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Roblox Radar', rows: 50, columns: 170 })
    void syncChats($)
    void fetchLive($)
    void fetchReceipts($)
    return { text: 'Roblox Radar panel opened.' }
  })

  on('command.run', { command: 'stage' }, async ($, e) => {
    const data = await load($)
    if (!data) return { text: `Could not read ${dataPath($)}.` }
    const arg = e.args.trim().toLowerCase()
    if (arg === 'clear' || arg === 'none') {
      await update($, selected, () => null)
      return { text: 'No stage in focus.' }
    }
    const found = findStage(data, arg)
    if (!found) return { text: `Stage not found. Ids: ${data.stages.map(s => s.id).join(', ')}.` }
    await update($, selected, () => found.id)
    await update($, tab, () => 'chat')
    return { text: `Stage in focus: ${found.name}.` }
  })

  // Plain-text selector that works where slash commands and clicks do not: "#brief how are we?".
  // The focused stage rides along as hidden context in the main chat.
  // Watch the main chat start a Radar conversation and keep its id on the card or stage.
  on('tool.call', { tool: /^mcp__ccd_session__start_session$/ }, async ($: any, e: any, next: any) => {
    const r: any = await next(e)
    try {
      const title = String((e as any).title ?? '')
      const p = [...pendingChats.values()].find(x => x.title === title)
      const id = p ? parseSessionId(textOf(r)) : null
      if (p && id) await saveStartedChat($, p, id)
    } catch {
      // the conversation still exists; the next click can only start another one
    }
    return r
  })

  on('prompt.submit', async ($, e, next) => {
    const mk = e.text.match(CHAT_MARK)
    const typed = e.text.trim().toLowerCase().replace(/[.!]+$/, '')
    const pending = mk && mk[1] ? pendingChats.get(mk[1]) : OPEN_WORDS.includes(typed) && lastPending ? pendingChats.get(lastPending) : undefined
    if (pending) {
      const ctx = [
        `ROBLOX RADAR PANEL: Lucas asked to open the conversation "${pending.title}". Do exactly this and nothing else:`,
        `1. Call mcp__ccd_session__start_session with initiation "user_asked", context "fresh", use_worktree false, title ${JSON.stringify(pending.title)}, and the prompt and background below, verbatim.`,
        '2. Call mcp__ccd_window__open_session_in with the new session id and target "split".',
        '3. File it in the sidebar group "Roblox Radar" with the ccd_sidebar tools: list_groups, create_group only if that group does not exist, then move_sessions.',
        '4. Reply in one short line in Portuguese saying the chat is open.',
        `PROMPT:\n${pending.prompt}`,
        `BACKGROUND:\n${pending.background}`,
      ].join('\n\n')
      return next({ ...e, context: [...(e.context ?? []), ctx] })
    }
    const origin: any = (e as any).origin
    if (origin && origin.kind === 'plugin' && origin.name === PLUGIN_NAME && e.text.startsWith('[Roblox Radar panel:')) {
      currentMain = mainQueue.shift() ?? null
      return next(e)
    }
    if (!e.turnId) currentMain = null
    if (e.command || e.text.trim().startsWith('/')) return next(e)
    const tag = e.text.match(/^\s*#([\p{L}0-9_-]+)\s*([\s\S]*)$/u)
    if (tag) {
      const all = await load($)
      const word = (tag[1] ?? '').toLowerCase()
      const rest = tag[2] ?? ''
      if (all && (word === 'clear' || word === '0')) {
        await update($, selected, () => null)
        $.ui.toast('No stage in focus')
        if (!rest.trim()) return { drop: 'stage cleared' }
        return next({ ...e, text: rest })
      }
      const hit = all ? findStage(all, word) : undefined
      if (hit) {
        await update($, selected, () => hit.id)
        await update($, tab, () => 'chat')
        $.ui.toast(`Stage in focus: ${hit.name}`)
        if (!rest.trim()) return { drop: 'stage selected' }
        e = { ...e, text: rest }
      }
    }
    const id = await read($, selected)
    if (!id) return next(e)
    const data = await load($)
    const stage = data ? data.stages.find(s => s.id === id) : undefined
    if (!data || !stage) return next(e)
    const ctx = [
      `ROBLOX RADAR PANEL: Lucas focused the stage "${stage.name}" (id ${stage.id}). Treat his message as being about this stage unless he says otherwise.`,
      `Snapshot of the stage from ${dataPath($)} (${data.note}):`,
      JSON.stringify(stage),
      'Do not state a live status or error without verifying it live. If a tool is missing in this session, say which.',
    ].join('\n')
    return next({ ...e, context: [...(e.context ?? []), ctx] })
  })

  // A stage agent finished: put its answer into the stage chat.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId) await onAgentDone($, e.agentId, e.answer, e.reason)
    else if (currentMain) {
      const key = currentMain
      currentMain = null
      await onAgentDone($, key, e.answer, e.reason)
    }
    await update($, rev, n => n + 1)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    await note($, 'last_render', { surface: e.surface, viewport: e.viewport ?? null })
    await read($, rev)
    if (e.surface === 'mobile' || e.surface === 'vscode') {
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box flexDirection="column">
          <Text color={FG}>The Roblox Radar panel needs the terminal or desktop surface.</Text>
        </Box>
      )
    }
    const { Box, Text, Button, Input, Svg, Link } = $.ui.resolve(e) as any
    const data = await load($)
    const ver = await loadVersion($)
    const sel = await read($, selected)
    const rawTab = await read($, tab)
    const openList = await read($, openIds)

    if (!data) {
      return (
        <Box flexDirection="column">
          <Text color={RUST}>Could not read {dataPath($)}.</Text>
        </Box>
      )
    }

    const store = await loadStore($)
    if (!store.seeded) void ensureSeed($)
    // First draw of a session that did not fire session.start: read the receipts once.
    if (!rcp && !rcpBusy) void fetchReceipts($)
    const snapSources = await loadSources($)
    const snapReports = await loadReports($)
    const receipts: Receipt[] = rcp ? rcp.receipts : []
    const latestCollection = receiptsFor(receipts, 'coleta').find(r => r.task_key === 'coleta') ?? null
    // Live receipts win; the snapshot files only fill what no receipt has said yet.
    const sources = sourcesFromReceipt(latestCollection, snapSources) ?? snapSources
    const reports = mergeReports(reportsFromReceipts(receipts), snapReports)
    const current = data.stages.find(s => s.id === sel)
    const totalOpen = data.stages.reduce((n, s) => n + openCount(s), 0)
    const columns = (e.props as { bodyColumns?: number }).bodyColumns ?? e.viewport?.columns ?? 80

    const perRow = columns >= 100 ? 4 : columns >= 60 ? 2 : 1
    const nodeW = Math.max(18, Math.min(60, Math.floor((columns - 4 - (perRow - 1) * 3) / perRow)))
    const select = (id: string) => Promise.all([update($, selected, () => id), update($, tab, () => 'chat')])
    const pick = (id: string, name: string) => {
      $.ui.toast(`Opening ${name}`)
      return select(id)
    }

    /* header */
    const header = (
      <Box flexDirection="column">
        <Box gap={1} alignItems="center">
          {Svg ? <Svg source={ICON_SVG} alt="Roblox Radar" width={28} height={28} /> : null}
          <Text bold color={CLAY}>
            {Svg ? 'Roblox Radar' : '▣ Roblox Radar'}
          </Text>
          <Text color={MUTED}>pipeline control</Text>
          <Text bold color={SKY}>{`v${ver}`}</Text>
        </Box>
        <Text color={MUTED}>
          {live && !('error' in live)
            ? `Scheduled tasks read live at ${live.at.slice(11, 16)} UTC. Stage descriptions come from the data file (${data.updated}).`
            : `Task list not available in this session (needs the Claude Code Remote connector). Stage health comes from receipts. Stage descriptions come from the data file (${data.updated}).`}
        </Text>
        <Text color={rcp ? (rcp.ok ? OLIVE : AMBER) : MUTED}>
          {!rcp
            ? 'Receipts: reading Drive...'
            : rcp.ok
              ? `Receipts: ${receipts.length} read from Drive at ${rcp.at.slice(11, 16)} UTC, newest ${receipts[0] ? `${receipts[0].task_key} ${receipts[0].finished_utc.slice(0, 16).replace('T', ' ')} UTC` : 'none yet'}.`
              : `Receipts: Drive check failed (${rcp.error}). Showing ${receipts.length} read earlier.`}
        </Text>
        <Text color={memError ? AMBER : store.outbox.length > 0 ? MUTED : OLIVE}>
          {memError
            ? `Memory: ${store.memSaved} saved to Drive, ${store.outbox.length} waiting. Last error: ${memError}`
            : `Memory: ${store.memSaved} events saved to Drive${store.outbox.length > 0 ? `, ${store.outbox.length} waiting` : ''}${store.restoredAt ? '' : ', checking Drive for earlier memory'}.`}
        </Text>
        <Box gap={2}>
          <Text color={OLIVE}>● OK</Text>
          <Text color={AMBER}>● ATTENTION</Text>
          <Text color={RUST}>● ERROR</Text>
          <Text color={SAND}>○ NOT BUILT</Text>
          <Text color={FG}>◆ your call</Text>
          <Text color={MUTED}>{totalOpen} open items</Text>
          <Button key="refresh" label="Refresh live status" onPress={() => Promise.all([fetchLive($), fetchReceipts($)])} />
        </Box>
      </Box>
    )

    /* flow map: rows of clickable nodes joined by arrows, registry bar, learning loop */
    const flowStages = data.stages.filter(s => s.id !== 'registro')
    const registry = data.stages.find(s => s.id === 'registro')
    const rows: Stage[][] = []
    for (let i = 0; i < flowStages.length; i += perRow) rows.push(flowStages.slice(i, i + perRow))
    const rowNotes = ['brief approved, proto_id born', 'prototype built and named, ready for art']
    const rowWidth = perRow * nodeW + (perRow - 1) * 3
    const nodeOf = (s: Stage) => {
      const tone = toneOf(s)
      const open = openCount(s)
      const isSel = s.id === sel
      const n = flowStages.findIndex(x => x.id === s.id) + 1
      const lastR = STAGES_WITH_RECEIPTS.includes(s.id) ? stageHealth(receipts, s.id, Date.now()).last : null
      const lastColor = !lastR ? MUTED : lastR.outcome === 'ok' ? OLIVE : lastR.outcome === 'failed' ? RUST : AMBER
      return (
        <Box
          key={`node-${s.id}`}
          flexDirection="column"
          borderStyle={isSel ? 'double' : 'round'}
          borderColor={isSel ? NEON : tone.color}
          backgroundColor={isSel ? NEON_BG : PANEL}
          paddingX={1}
          width={nodeW}
        >
          <Button key={`stage-${s.id}`} hotkey={HOTKEYS[n - 1]} onPress={() => pick(s.id, s.name)}>
            <Text bold color={isSel ? BG : FG} backgroundColor={isSel ? NEON : CLAY}>
              {` ${n} `}
            </Text>
            <Text bold color={isSel ? NEON : FG}>
              {' '}
              {s.gate ? '◆ ' : ''}
              {clip(s.name, nodeW - 14).padEnd(Math.max(0, nodeW - 14), '\u00a0')}
            </Text>
          </Button>
          <Text color={isSel ? FG : MUTED}>{clip(s.sub, nodeW - 4)}</Text>
          {lastR ? <Text color={lastColor}>{clip(`${lastR.task_key} ${ago(lastR.finished_utc, Date.now())}`, nodeW - 4)}</Text> : null}
          <Text bold={isSel} color={tone.color}>
            {tone.glyph} {tone.label}
            {open > 0 ? `  ${open} open` : ''}
          </Text>
        </Box>
      )
    }
    const flow = (
      <Box flexDirection="column">
        {rows.map((row, ri) => {
          const rev = ri % 2 === 1
          const shown = rev ? [...row].reverse() : row
          return (
            <Box key={`row-${ri}`} flexDirection="column">
              <Box flexDirection="row" width={rowWidth}>
                {shown.map((s, i) => (
                  <Box key={`cell-${s.id}`} flexDirection="row">
                    {nodeOf(s)}
                    {i < shown.length - 1 ? (
                      <Box flexDirection="column" justifyContent="center" paddingX={1}>
                        <Text color={CLAY}>{rev ? '←' : '→'}</Text>
                      </Box>
                    ) : null}
                  </Box>
                ))}
              </Box>
              {ri < rows.length - 1 ? (
                <Box width={rowWidth} justifyContent={rev ? 'flex-start' : 'flex-end'}>
                  <Text color={CLAY}>
                    {rev ? '↓ ' : ''}
                    {perRow === 4 ? (rowNotes[ri] ?? '') : ''}
                    {rev ? '' : ' ↓'}
                  </Text>
                </Box>
              ) : null}
            </Box>
          )
        })}
        {registry ? (
          <Box
            key="registry-bar"
            borderStyle={registry.id === sel ? 'double' : 'round'}
            borderColor={registry.id === sel ? NEON : toneOf(registry).color}
            backgroundColor={registry.id === sel ? NEON_BG : PANEL}
            paddingX={1}
            marginTop={1}
            gap={1}
          >
            <Button key={`stage-${registry.id}`} onPress={() => select(registry.id)}>
              <Text bold color={registry.id === sel ? NEON : FG}>
                Registry (proto_id)
              </Text>
            </Button>
            <Text color={MUTED}>one line per prototype ties trend, brief, doc, listing, metrics and post mortem</Text>
            <Text color={toneOf(registry).color}>
              {toneOf(registry).glyph} {toneOf(registry).label}
            </Text>
          </Box>
        ) : null}
        <Text color={SKY}>↺ learning feeds back: screening weights, validator, templates, listing, thresholds</Text>
      </Box>
    )

    /* detail */
    let detail
    if (!current) {
      const c = { pending: 0, promising: 0, rejected: 0 }
      for (const i of store.ideas) c[i.status] += 1
      detail = (
        <Box flexDirection="column">
          <Text bold color={FG}>Pick a stage</Text>
          <Text color={MUTED}>
            Click a stage to open it full screen, with its own chat and the tabs that belong to it. Each stage keeps a separate
            context, so no single conversation has to carry the whole project.
          </Text>
          <Text color={MUTED}>
            Ideas in the pipeline: {store.ideas.length} ({c.pending} pending, {c.promising} promising, {c.rejected} rejected).
          </Text>
        </Box>
      )
    } else {
      const tone = toneOf(current)
      const thread = store.threads[current.id]
      const logs: LogEntry[] = store.log[current.id] ?? []
      const showLog = current.trigger_ids.length > 0 || logs.length > 0
      const instructions = store.instructions[current.id] ?? []
      const archive = store.archive[current.id] ?? []
      const openPend = current.pendencies.filter(p => !p.done)

      const tabs = tabsFor(current, showLog)
      const activeTab = tabs.some(t => t.id === rawTab) ? rawTab : 'chat'
      const stageIdeas = ideasAt(store.ideas, current.id).length
      const countOf = (id: string): string => {
        if (id === 'pending' && openPend.length > 0) return ` (${openPend.length})`
        if ((id === 'ideas' || id === 'protos') && stageIdeas > 0) return ` (${stageIdeas})`
        if (id === 'reports' && reports) return ` (${reports.reports.length})`
        if (id === 'receipts') return ` (${receiptsFor(receipts, current.id).length})`
        if (id === 'knowledge') return ` (${(store.knowledge[current.id] ?? []).length})`
        if (id === 'registry') return ` (${store.ideas.filter(i => i.proto_id).length})`
        return ''
      }
      const tabBar = (
        <Box gap={2} paddingX={1} flexWrap="wrap">
          {tabs.map(t => (
            <Button key={`tab-${t.id}`} onPress={() => update($, tab, () => t.id)}>
              <Text bold={t.id === activeTab} underline={t.id === activeTab} color={t.id === activeTab ? NEON : MUTED}>
                {t.label}
                {countOf(t.id)}
              </Text>
            </Button>
          ))}
        </Box>
      )
      const vctx: Ctx = {
        C: { Box, Text, Button, Input, Link },
        columns,
        now: Date.now(),
        store,
        stages: data.stages,
        sources,
        reports,
        receipts,
        rcp: rcp ? { at: rcp.at, ok: rcp.ok, error: rcp.error } : null,
        open: openList,
        toggle: id => toggleOpen($, id),
        go: id => select(id),
        sendItem: (r, si, ii) => sendItem($, r, si, ii),
        saveHook: (r, it) => saveHook($, r, it),
        setStatus: (id, st) => setStatus($, id, st),
        promote: id => promote($, id, data.stages),
        scanIdea: id => startIdeaJob($, id, 'scan', ''),
        ideaSay: (id, v) => startIdeaJob($, id, 'chat', v),
        briefIdea: id => briefIdea($, id, data.stages),
        openChat: (kind, scope) => openChat($, kind, scope),
        ideaYes: id => ideaYes($, id, data.stages),
        chatError: key => chatError[key] ?? null,
        chatBusy: key => chatBusy.has(key),
        addIdea: v => addIdea($, v),
        addKnowledge: (sid, v) => addKnowledge($, sid, v),
        removeKnowledge: (sid, id) => removeKnowledge($, sid, id),
      }
      let extra: any = null
      if (activeTab === 'sources') extra = sourcesView(vctx)
      else if (activeTab === 'reports') extra = reportsView(vctx)
      else if (activeTab === 'receipts') extra = receiptsView(vctx, current)
      else if (activeTab === 'ideas') extra = ideasView(vctx, current, true)
      else if (activeTab === 'protos') extra = ideasView(vctx, current, false)
      else if (activeTab === 'knowledge') extra = knowledgeView(vctx, current)
      else if (activeTab === 'registry') extra = registryView(vctx)

      let body
      if (extra) {
        body = (
          <Box flexDirection="column" paddingX={1}>
            {extra}
          </Box>
        )
      } else if (activeTab === 'chat') {
        body = (
          <Box flexDirection="column" paddingX={1}>
            {chatPanel(vctx, 'stage', current.id, store.stageChats[current.id] ?? null, store.memory[current.id]?.text ?? '', `Chat with the ${current.name} stage`)}
          </Box>
        )
      } else if (activeTab === 'overview') {
        body = (
          <Box flexDirection="column" paddingX={1}>
            <Box gap={1}>
              <Text color={tone.color}>{tone.glyph}</Text>
              <Text bold color={FG}>{current.name}</Text>
              <Text color={MUTED}>{tone.label}</Text>
            </Box>
            <Text color={FG}>{current.desc}</Text>
            <Text color={MUTED}>In: {current.inputs}</Text>
            <Text color={MUTED}>Out: {current.outputs}</Text>
            <Text color={FG}>Build: {current.build_note || current.build}</Text>
            {current.flag ? <Text color={current.flag.level === 'err' ? RUST : AMBER}>{current.flag.text}</Text> : null}
            {current.gate_note ? <Text color={SKY}>Your call: {current.gate_note}</Text> : null}
            <Text bold color={FG}>Standing instructions</Text>
            {instructions.length === 0 ? <Text color={MUTED}>None yet. Rules you give in the chat are saved here.</Text> : null}
            {instructions.map((r, i) => (
              <Box key={`ins-${i}`} gap={1}>
                <Text color={FG}>- {r}</Text>
                <Button
                  key={`rm-${i}`}
                  label="Remove"
                  onPress={() =>
                    mutate($, s => {
                      s.instructions[current.id] = (s.instructions[current.id] ?? []).filter((_, k) => k !== i)
                      addLog(s, current.id, 'instruction', `Standing instruction removed: ${r}`)
                    })
                  }
                />
              </Box>
            ))}
            <Text color={MUTED}>{current.checked_at ? `Checked live on ${current.checked_at}` : 'Never checked live.'}</Text>
          </Box>
        )
      } else if (activeTab === 'tasks') {
        const lines = liveOf(current).lines
        body = (
          <Box flexDirection="column" paddingX={1}>
            {current.trigger_ids.length === 0 ? <Text color={MUTED}>{current.no_task_note || 'No automated task.'}</Text> : null}
            {lines.map(l => (
              <Text key={l} dimColor>
                {l}
              </Text>
            ))}
            {current.status_doc ? <Text color={MUTED}>Daily report: {current.status_doc} (Drive).</Text> : null}
          </Box>
        )
      } else if (activeTab === 'pending') {
        body = (
          <Box flexDirection="column" paddingX={1}>
            {openPend.length === 0 ? <Text color={MUTED}>Nothing open.</Text> : null}
            {openPend.map(p => (
              <Box key={`p-${p.id}`} gap={1}>
                <Text color={p.owner === 'Lucas' ? CLAY : SAND}>[{p.owner}]</Text>
                <Text color={FG}>{p.text}</Text>
                <Text color={MUTED}>since {p.since}</Text>
              </Box>
            ))}
            <Text color={MUTED}>Ask the chat to mark an item done or to add one.</Text>
          </Box>
        )
      } else if (activeTab === 'assets') {
        const items = [...current.skills.map(i => ({ ...i, kind: 'skill' })), ...current.docs.map(i => ({ ...i, kind: 'doc' }))]
        body = (
          <Box flexDirection="column" paddingX={1}>
            {items.length === 0 ? <Text color={MUTED}>Nothing registered.</Text> : null}
            {items.map(i => (
              <Box key={`a-${i.kind}-${i.name}`} gap={1}>
                <Text color={stateColor(i.state)}>●</Text>
                <Text color={FG}>{i.name}</Text>
                <Text color={MUTED}>
                  {i.kind}, {i.state}
                </Text>
              </Box>
            ))}
            <Text color={MUTED}>Ask the chat to update a skill or a doc.</Text>
          </Box>
        )
      } else {
        body = (
          <Box flexDirection="column" paddingX={1}>
            {liveOf(current).lines.map(l => (
              <Text key={`lv-${l}`} dimColor>
                {l}
              </Text>
            ))}
            {logs.length === 0 ? <Text color={MUTED}>No events yet.</Text> : null}
            {[...logs]
              .reverse()
              .slice(0, 40)
              .map((l, i) => (
                <Box key={`lg-${i}`} gap={1}>
                  <Text color={MUTED}>{l.at.slice(5, 16).replace('T', ' ')}</Text>
                  <Text color={l.kind === 'error' ? RUST : l.kind === 'instruction' ? SKY : FG}>{l.text}</Text>
                </Box>
              ))}
            {archive.length > 0 ? <Text bold color={FG}>Earlier chats</Text> : null}
            {[...archive].reverse().map(a => (
              <Box key={`ar-${a.id}`} flexDirection="column">
                <Text color={MUTED}>
                  Chat #{a.n}, {a.messageCount} messages, closed {a.endedAt.slice(0, 10)} ({a.reason})
                </Text>
                <Text color={FG}>{clip(a.summary, 400)}</Text>
              </Box>
            ))}
          </Box>
        )
      }
      detail = (
        <Box flexDirection="column" gap={1} borderStyle="round" borderColor={LINE} backgroundColor={PANEL} paddingY={1}>
          {tabBar}
          {body}
        </Box>
      )
    }

    if (!current) {
      return (
        <Box flexDirection="column" gap={1} backgroundColor={BG} paddingX={1} paddingY={1}>
          {header}
          {flow}
          {detail}
        </Box>
      )
    }

    /* full screen stage view */
    const idx = data.stages.findIndex(x => x.id === current.id)
    const prevStage = idx > 0 ? data.stages[idx - 1] : undefined
    const nextStage = idx >= 0 && idx < data.stages.length - 1 ? data.stages[idx + 1] : undefined
    const numOf = (id: string): string => {
      const n = flowStages.findIndex(x => x.id === id) + 1
      return n > 0 ? String(n) : 'R'
    }
    const cTone = toneOf(current)
    const topBar = (
      <Box gap={2} flexWrap="wrap">
        <Button key="back" label="← Pipeline" onPress={() => update($, selected, () => null)} />
        <Text bold color={CLAY}>
          ▣ Roblox Radar
        </Text>
        {prevStage ? <Button key="prev" label={`‹ ${prevStage.name}`} onPress={() => select(prevStage.id)} /> : null}
        {nextStage ? <Button key="next" label={`${nextStage.name} ›`} onPress={() => select(nextStage.id)} /> : null}
      </Box>
    )
    const stepper = (
      <Box gap={1} flexWrap="wrap">
        {data.stages.map(x => {
          const isHere = x.id === current.id
          return (
            <Button key={`jump-${x.id}`} onPress={() => select(x.id)}>
              <Text bold color={isHere ? BG : toneOf(x).color} backgroundColor={isHere ? NEON : PANEL}>
                {` ${numOf(x.id)} `}
              </Text>
            </Button>
          )
        })}
      </Box>
    )
    const titleRow = (
      <Box gap={1} flexWrap="wrap">
        <Text bold color={BG} backgroundColor={NEON}>
          {` ${numOf(current.id)} `}
        </Text>
        <Text bold color={NEON}>
          {current.name}
        </Text>
        <Text color={MUTED}>{current.sub}</Text>
        <Text bold color={cTone.color}>
          {cTone.glyph} {cTone.label}
        </Text>
        {current.gate ? (
          <Text bold color={CLAY}>
            ◆ YOUR CALL
          </Text>
        ) : null}
      </Box>
    )
    return (
      <Box flexDirection="column" gap={1} backgroundColor={BG} paddingX={1} paddingY={1}>
        {topBar}
        {stepper}
        {titleRow}
        {detail}
      </Box>
    )
  })
}
