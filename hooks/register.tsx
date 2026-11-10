import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Data, Report, ReportItem, ReportsFile, SeedFile, SourcesFile, Stage } from '../types'
import { AMBER, BG, CLAY, FG, LINE, MUTED, NEON, NEON_BG, OLIVE, PANEL, RUST, SAND, SKY, USER_BG } from './theme'
import { ago, knowledgeView, openChatButton, receiptsView, reportsView, sourcesView, templatesView } from './views'
import { factoryView, skillsRow } from './ui/factory'
import { factoryNoteBar, inboxBox } from './ui/radar'
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
  nextStageOf,
  needsRollover,
  newThread,
  recentHistory,
  summarizerPrompt,
} from './model'
import { STALE_BUSY_MS } from './model'
import type { Idea, Job, Knowledge, LogEntry, Msg, Store, Thread } from './model'
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
import { AUTO_OPEN_CHAT_ON_SEND, advanceIdea, anyPending, applyParsed, archiveIdea, createPrototype, ensureProto, markAsked, markDone, migrateStore, newInbox, renameAbbr, resolveGates, sendInboxToFactory } from './factory'
import { actionByKey, buildActionPrompt, gatePrompt, researchMessage } from './prompts'
import type { PromptCtx } from './prompts'
import { parseTags, splitItems } from './outputs'
import type { Parsed } from './outputs'
import { DEFAULT_SCORING, parseScoring, safetyBlocked } from './scoring'
import type { ScoringConfig } from './scoring'
import { SKILLS_ROOT_ID, refreshSkills, seedSkills, skillFiles, skillFolders } from './skills'
import type { SkillsState } from './skills'
import { TEMPLATE_FOLDER_ID, TEMPLATE_PREFIX, parseTemplate } from './templates'
import type { Template } from './templates'
import { ideaBackground, ideaChatTitle, ideaOpening, parseLink, parseSessionId, stageBackground, stageChatTitle, stageOpening } from './chats'
import type { ChatLink } from './model'
import {
  RECEIPT_DAYS,
  RECEIPT_FOLDER_ID,
  STAGES_WITH_RECEIPTS,
  jsonOf,
  unwrapDoc,
  mergeReports,
  parseReceipt,
  receiptsFor,
  isLate,
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
const statusOpen = atom({ plugin: 'radar-panel', key: 'statusOpen' } as const, false)
const modeAtom = atom({ plugin: 'radar-panel', key: 'mode' } as const, 'radar')
const protoAtom = atom({ plugin: 'radar-panel', key: 'proto' } as const, null as string | null)
const moreAtom = atom({ plugin: 'radar-panel', key: 'more' } as const, false)
const archivedAtom = atom({ plugin: 'radar-panel', key: 'archived' } as const, false)
const filterAtom = atom({ plugin: 'radar-panel', key: 'filter' } as const, null as string | null)
const fstageAtom = atom({ plugin: 'radar-panel', key: 'fstage' } as const, null as string | null)
const tabsAtom = atom({ plugin: 'radar-panel', key: 'tabs' } as const, {} as Record<string, string>)
const openIds = atom({ plugin: 'radar-panel', key: 'open' } as const, [] as string[])

type TabDef = { id: string; label: string }
const SYNC_EVENTS = 120

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
      migrateStore(s, true)
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
type PendingChat = { key: string; kind: 'idea' | 'stage'; scope: string; title: string; prompt: string; background: string; noOpen?: boolean }
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
  void fileInGroup($, id)
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

// Shows a conversation beside the panel. The app only does this for conversations this session started, so an
// older one (started from another session) is opened from the card's link or the sidebar instead.
async function showChat($: any, chat: ChatLink, key?: string): Promise<boolean> {
  // Always beside the panel (split view), never in a separate window.
  for (const target of ['split']) {
    try {
      await ccdCall($, 'ccd_window', 'open_session_in', { session_id: chat.id, target })
      if (key) delete chatError[key]
      return true
    } catch {
      // try the next way to show it
    }
  }
  const how = chat.link ? 'Click "open in app" on the card' : 'Open it from the sidebar'
  if (key) chatError[key] = `${how}: "${chat.title}". The app only opens beside the panel the conversations started from this same session; this one was started from another session.`
  $.ui.toast(`${how}.`)
  return false
}

// Finds an app conversation by its exact title: how the panel recovers a conversation the main chat started,
// whatever way it was started, and how it never starts a second one for the same card.
let listError = ''
const norm = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').trim()

// The rows of a list_sessions answer, whatever wraps them: a JSON array, {sessions: [...]}, or an array inside text.
function sessionRows(text: string): any[] {
  const tryParse = (t: string): any => {
    try {
      return JSON.parse(t)
    } catch {
      return null
    }
  }
  let o: any = tryParse(text) ?? jsonOf(text)
  if (!o) {
    const a = text.indexOf('[')
    const b = text.lastIndexOf(']')
    if (a >= 0 && b > a) o = tryParse(text.slice(a, b + 1))
  }
  return Array.isArray(o) ? o : Array.isArray(o?.sessions) ? o.sessions : Array.isArray(o?.data) ? o.data : []
}

// Every app conversation by normalized title, from one list_sessions call.
async function sessionsByTitle($: any): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  try {
    const rows = sessionRows(await ccdCall($, 'ccd_session_mgmt', 'list_sessions', { limit: 100 }))
    listError = rows.length === 0 ? 'the app listed no conversation' : ''
    for (const r of rows) {
      const t = norm(String(r?.title ?? r?.name ?? ''))
      const id = r?.sessionId ?? r?.session_id ?? r?.id
      if (t && typeof id === 'string' && !out.has(t)) out.set(t, id)
    }
  } catch (err: any) {
    listError = String((err && err.message) || err).slice(0, 300)
  }
  return out
}

async function findSessionByTitle($: any, title: string): Promise<{ id: string; link: string | null } | null> {
  try {
    const rows = sessionRows(await ccdCall($, 'ccd_session_mgmt', 'list_sessions', { limit: 100 }))
    listError = rows.length === 0 ? 'the app listed no conversation' : ''
    const want = norm(title)
    for (const r of rows) {
      const t = norm(String(r?.title ?? r?.name ?? ''))
      const id = r?.sessionId ?? r?.session_id ?? r?.id
      if (typeof id === 'string' && (t === want || t.startsWith(want))) return { id, link: typeof r?.link === 'string' ? r.link : null }
    }
  } catch (err: any) {
    listError = String((err && err.message) || err).slice(0, 300)
  }
  return null
}

// Pending requests whose conversation now exists get tied to their card or stage.
async function resolvePending($: any): Promise<void> {
  for (const p of [...pendingChats.values()]) {
    const hit = await findSessionByTitle($, p.title)
    if (hit) await saveStartedChat($, p, hit.id)
  }
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
async function openChat($: any, kind: 'idea' | 'stage', scope: string, task?: string, opts: { show?: boolean } = {}): Promise<void> {
  const show = opts.show !== false
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
      if (show) await showChat($, existing, key)
      void resolvePending($).then(() => syncChats($))
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
      prompt = ideaOpening(idea, !task && idea.stage === 'prevalid' && !idea.scan, task)
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
    pendingChats.set(key, { key, kind, scope, title, prompt, background, noOpen: !show })
    lastPending = key
    // The conversation may already exist (an earlier click, another session): reuse it, never start a second one.
    const known = await findSessionByTitle($, title)
    if (known) {
      await saveStartedChat($, pendingChats.get(key)!, known.id)
      const saved = (await loadStore($))
      const chat = kind === 'idea' ? saved.ideas.find(i => i.id === scope)?.chat : saved.stageChats[scope]
      if (chat && show) await showChat($, chat, key)
      return
    }
    const label = kind === 'idea' ? `the idea "${title.replace(/^Radar idea: /, '')}"` : `the ${title.replace(/^Radar stage: /, '')} stage`
    const request = `Open the Roblox Radar chat for ${label} [radar:${key}]`
    // The click sends the request as a message of the main chat, so the app judges a real request.
    // Direct start, only on Lucas's click: works when he allowed start_session in his settings. Otherwise the
    // request goes through the main chat below.
    const direct = await startDirect($, pendingChats.get(key)!)
    if (direct) {
      const chat = (await loadStore($)).ideas.find(i => i.id === scope)?.chat ?? (await loadStore($)).stageChats[scope]
      if (chat && show) await showChat($, chat, key)
      return
    }
    // Fire and forget: the panel never waits for the main chat's whole turn.
    void Promise.resolve($.prompt.submit({ text: request }))
      .then((r: any) => {
        if (r && r.drop) chatError[key] = 'The main chat refused the request. Type "abrir chat" in the Claude message box at the bottom of the window.'
      })
      .catch(() => {
        chatError[key] = 'Could not start it from here. Type "abrir chat" in the Claude message box at the bottom of the window.'
      })
    chatError[key] = `Starting the chat in the main conversation (first time only; later clicks are instant).${listError ? ` Could not look for an existing one: ${listError}` : ''}`
  } catch (err: any) {
    chatError[key] = String((err && err.message) || err).slice(0, 700)
  } finally {
    chatBusy.delete(key)
    await update($, rev, n => n + 1)
  }
}

// Starts a conversation straight from the click, without the main chat. Returns false when the app refuses
// (no allow rule for start_session), so the caller falls back to the main chat.
async function startDirect($: any, p: PendingChat): Promise<boolean> {
  try {
    const raw = await ccdCall($, 'ccd_session', 'start_session', {
      initiation: 'user_asked',
      title: p.title,
      prompt: p.prompt,
      background: p.background,
      context: 'fresh',
      use_worktree: false,
    })
    const id = parseSessionId(raw)
    if (!id) return false
    await saveStartedChat($, p, id)
    return true
  } catch {
    return false
  }
}

/* ---------- Factory: prototypes, requests, gates ---------- */

let factoryNote: { ideaId: string; text: string } | null = null
let skillsState: SkillsState | null = null
let skillsBusy = false
let scoringCfg: ScoringConfig = DEFAULT_SCORING

async function loadScoring($: any): Promise<void> {
  try {
    scoringCfg = parseScoring(JSON.parse(String(await $.fs.read(`${$.plugin.root}/data/scoring.json`))))
  } catch {
    scoringCfg = DEFAULT_SCORING
  }
}

// Lists the Drive skill folders (never reads the files: the chat does). Used for the Skills row and to record versions.
async function fetchSkills($: any): Promise<void> {
  if (skillsBusy) return
  skillsBusy = true
  try {
    skillsState = await refreshSkills((tool, args) => driveCall($, tool, args), SKILLS_ROOT_ID, skillsState, new Date().toISOString())
  } finally {
    skillsBusy = false
    await update($, rev, n => n + 1)
  }
}

function promptCtx(data: Data, s: Store, stageId: string): PromptCtx {
  const next = nextStageOf(stageId)
  return {
    stageName: data.stages.find(x => x.id === stageId)?.name ?? stageId,
    folders: skillFolders(skillsState, stageId),
    criteria: Object.keys(scoringCfg.weights),
    knowledge: s.knowledge[stageId] ?? [],
    nextStage: next,
    nextStageName: next ? (data.stages.find(x => x.id === next)?.name ?? next) : null,
  }
}

function ideaEvent(s: Store, i: Idea, at: string): void {
  enqueue(s, { v: 1, kind: 'idea', scope: `idea:${i.id}`, at, stage: i.stage, idea: ideaSnapshot(i) })
}

// Sends a request to the prototype's own chat (creating the chat first when it does not exist) and shows it beside the panel.
async function sendToProtoChat($: any, ideaId: string, text: string, done: string): Promise<void> {
  const key = `idea:${ideaId}`
  const i = (await loadStore($)).ideas.find(x => x.id === ideaId)
  if (!i) return
  let chat = i.chat ?? null
  if (!chat) {
    const hit = await findSessionByTitle($, ideaChatTitle(i))
    if (hit) {
      await saveStartedChat($, { key, kind: 'idea', scope: ideaId, title: ideaChatTitle(i), prompt: '', background: '' }, hit.id)
      chat = (await loadStore($)).ideas.find(x => x.id === ideaId)?.chat ?? null
    }
  }
  if (!chat) {
    // First time: the conversation is started with this request as its first task.
    await openChat($, 'idea', ideaId, text)
    return
  }
  let sent = false
  try {
    const r: any = await $.session.send({ to: { sessionId: chat.id }, text })
    sent = !!(r && r.isDelivered)
  } catch {
    sent = false
  }
  const shown = await showChat($, chat, key)
  chatError[key] = sent ? `${done}${shown ? '' : ' Open it from "open in app" or the Roblox Radar group in the sidebar.'}` : 'Could not send it to the chat. Open the chat and paste the request again from the card.'
  await update($, rev, n => n + 1)
}

// Best effort: keep the app conversation title equal to "<proto id> | <title>" (needs the rename tool of the app).
async function syncChatTitle($: any, ideaId: string): Promise<void> {
  const i = (await loadStore($)).ideas.find(x => x.id === ideaId)
  if (!i || !i.chat || !i.proto_id) return
  const want = ideaChatTitle(i)
  if (i.chat.title === want) return
  try {
    await ccdCall($, 'ccd_session_mgmt', 'set_session_title', { session_id: i.chat.id, title: want })
    await mutate($, s => {
      const x = s.ideas.find(y => y.id === ideaId)
      if (x && x.chat) x.chat = { ...x.chat, title: want }
    })
  } catch {
    // renaming is tidy-up only
  }
}

// One action: allocate the proto ID, create the idea at pre-validation, create its chat, queue the memory event, give feedback.
type SendSrc = { kind: 'inbox'; id: string } | { kind: 'advisor'; report: Report; si: number; ii: number }

async function sendToFactory($: any, src: SendSrc): Promise<void> {
  let ideaId = ''
  let protoId = ''
  let title = ''
  const now = new Date().toISOString()
  await mutate($, s => {
    let idea: Idea | null = null
    if (src.kind === 'inbox') {
      idea = sendInboxToFactory(s, src.id, now)
    } else {
      const item = src.report.sections[src.si]?.items[src.ii]
      const from = `${src.report.id}#${src.si}.${src.ii}`
      if (!item || s.ideas.some(i => i.from === from) || s.inbox.some(i => i.from === from)) return
      idea = createPrototype(s, {
        title: item.title,
        note: `${item.note} (from the ${src.report.title} report of ${src.report.date}, section "${src.report.sections[src.si]?.name ?? ''}")`,
        origin: 'advisor',
        from,
        now,
      })
    }
    if (!idea) return
    ideaId = idea.id
    protoId = idea.proto_id ?? ''
    title = idea.title
    ideaEvent(s, idea, now)
    addLog(s, 'prevalid', 'ideas', `Created ${protoId} "${clip(idea.title, 40)}" in the Factory.`)
  })
  if (!ideaId) {
    $.ui.toast('Nothing to send (already in the Factory?).')
    return
  }
  factoryNote = { ideaId, text: `Created ${protoId} and its chat` }
  await update($, protoAtom, () => ideaId)
  $.ui.toast(`Created ${protoId} and its chat`)
  void flushOutbox($)
  const idea = (await loadStore($)).ideas.find(x => x.id === ideaId)
  if (idea?.chat) {
    // A migrated idea brings its old chat: keep it, rename it when the app lets us.
    await syncChatTitle($, ideaId)
    if (AUTO_OPEN_CHAT_ON_SEND) await showChat($, idea.chat, `idea:${ideaId}`)
  } else {
    await openChat($, 'idea', ideaId, undefined, { show: AUTO_OPEN_CHAT_ON_SEND })
  }
  await update($, rev, n => n + 1)
}

async function addInbox($: any, raw: string): Promise<void> {
  const [t, ...rest] = raw.split(/\s*\|\s*|\n/)
  const title = (t ?? '').trim()
  if (!title) return
  if (OPEN_WORDS.includes(title.toLowerCase().replace(/[.!]+$/, ''))) {
    $.ui.toast('That box adds ideas. Use the Open chat button on a stage or prototype instead.')
    return
  }
  await mutate($, s => {
    s.inbox.push(newInbox(title, rest.join(' ').trim(), 'own', null, new Date().toISOString(), s.inbox.length))
    addLog(s, 'triagem', 'ideas', `Added the loose idea "${title.slice(0, 60)}".`)
  })
}

async function discardInbox($: any, id: string): Promise<void> {
  await mutate($, s => {
    s.inbox = s.inbox.filter(x => x.id !== id)
  })
}

async function archiveProto($: any, ideaId: string, on: boolean): Promise<void> {
  await mutate($, s => {
    const i = s.ideas.find(x => x.id === ideaId)
    if (!i) return
    const now = new Date().toISOString()
    archiveIdea(i, on, now)
    addLog(s, i.stage, 'ideas', `${on ? 'Archived' : 'Unarchived'} ${i.proto_id}.`)
    ideaEvent(s, i, now)
  })
  void flushOutbox($)
}

async function renameProtoAbbr($: any, ideaId: string, raw: string): Promise<void> {
  let ok = false
  await mutate($, s => {
    ok = renameAbbr(s, ideaId, raw)
    const i = s.ideas.find(x => x.id === ideaId)
    if (ok && i) ideaEvent(s, i, new Date().toISOString())
  })
  if (!ok) {
    $.ui.toast('That ABBR is empty or already used.')
    return
  }
  await syncChatTitle($, ideaId)
  void flushOutbox($)
}

// "Open chat" on a Factory stage: opens the prototype's chat and sends a one-line focus message.
async function openProtoChat($: any, ideaId: string, stageId: string): Promise<void> {
  const data = await load($)
  const i = (await loadStore($)).ideas.find(x => x.id === ideaId)
  if (!i || !data) return
  const name = data.stages.find(x => x.id === stageId)?.name ?? stageId
  const focus = `Focus: ${name}`
  if (!i.chat) {
    await openChat($, 'idea', ideaId, focus)
    return
  }
  const key = `idea:${ideaId}`
  await syncChatTitle($, ideaId)
  await showChat($, i.chat, key)
  try {
    await $.session.send({ to: { sessionId: i.chat.id }, text: focus })
  } catch {
    // the chat opens either way
  }
  await update($, rev, n => n + 1)
}

async function runFactory($: any, ideaId: string, key: string): Promise<void> {
  const a = actionByKey(key)
  const data = await load($)
  const s0 = await loadStore($)
  const i = s0.ideas.find(x => x.id === ideaId)
  if (!a || !i || !data) return
  const blocked = a.needs ? a.needs(i) : null
  if (blocked) {
    chatError[`idea:${ideaId}`] = blocked
    await update($, rev, n => n + 1)
    return
  }
  const { text, gen } = buildActionPrompt(a, i, promptCtx(data, s0, a.stage))
  const refs = skillFiles(skillsState, a.stage)
  await mutate($, s => {
    const x = s.ideas.find(y => y.id === ideaId)
    if (!x) return
    const now = new Date().toISOString()
    markAsked(x, a.stage, a.kind, gen, refs, now)
    x.lastAction = { stage: a.stage, label: a.label, at: now }
    addLog(s, a.stage, 'ideas', `${a.label}: requested for ${x.proto_id}.`)
    ideaEvent(s, x, now)
  })
  await sendToProtoChat($, ideaId, text, a.done)
}

async function markStageDone($: any, ideaId: string, stageId: string): Promise<void> {
  await mutate($, s => {
    const i = s.ideas.find(x => x.id === ideaId)
    if (!i) return
    const now = new Date().toISOString()
    markDone(i, stageId, now)
    addLog(s, stageId, 'ideas', `${i.proto_id}: ${stageId} marked done by hand.`)
    ideaEvent(s, i, now)
  })
  void flushOutbox($)
}

async function pickItem($: any, ideaId: string, stageId: string, item: string, mode: 'choose' | 'discard'): Promise<void> {
  let chat: ChatLink | null = null
  await mutate($, s => {
    const i = s.ideas.find(x => x.id === ideaId)
    if (!i) return
    ensureProto(i)
    const list = i.outputs![stageId] ?? []
    if (mode === 'choose' && stageId === 'titulo') for (const o of list) o.chosen = []
    for (const o of list) {
      if (!splitItems(o.content).includes(item)) continue
      if (mode === 'choose') {
        if (!o.chosen.includes(item)) o.chosen.push(item)
      } else {
        if (!o.discarded.includes(item)) o.discarded.push(item)
        o.chosen = o.chosen.filter(c => c !== item)
      }
    }
    i.updated = new Date().toISOString()
    chat = i.chat ?? null
    ideaEvent(s, i, i.updated)
  })
  if (mode === 'choose' && chat) {
    try {
      await $.session.send({ to: { sessionId: (chat as ChatLink).id }, text: `Lucas marked this as chosen for ${stageId}: ${clip(item, 600)}` })
    } catch {
      // the choice is on the card either way
    }
  }
  void flushOutbox($)
}

async function registerResearch($: any, ideaId: string, text: string): Promise<void> {
  const t = text.trim()
  if (!t) return
  let chat: ChatLink | null = null
  let msg = ''
  await mutate($, s => {
    const i = s.ideas.find(x => x.id === ideaId)
    if (!i) return
    i.research = t.slice(0, 20000)
    i.updated = new Date().toISOString()
    chat = i.chat ?? null
    msg = researchMessage(i, t)
    addLog(s, 'template', 'ideas', `${i.proto_id}: research registered.`)
    ideaEvent(s, i, i.updated)
  })
  if (chat) {
    try {
      await $.session.send({ to: { sessionId: (chat as ChatLink).id }, text: msg })
    } catch {
      // the research is on the card either way
    }
  }
  void flushOutbox($)
}

async function setTemplateMode($: any, ideaId: string, mode: 'library' | 'custom'): Promise<void> {
  await mutate($, s => {
    const i = s.ideas.find(x => x.id === ideaId)
    if (i) i.template_mode = mode
  })
}

// "Advance": the chat runs the principles gate first. PASS advances on its own when the answer arrives.
async function requestAdvance($: any, ideaId: string, force: boolean): Promise<void> {
  const data = await load($)
  const s0 = await loadStore($)
  const i = s0.ideas.find(x => x.id === ideaId)
  if (!i || !data) return
  const next = nextStageOf(i.stage)
  if (!next) return
  if (safetyBlocked(i.scores, scoringCfg) && !force) {
    chatError[`idea:${ideaId}`] = 'Safety is below the gate. Use "Advance anyway" to confirm.'
    await update($, rev, n => n + 1)
    return
  }
  const from = data.stages.find(x => x.id === i.stage)?.name ?? i.stage
  const to = data.stages.find(x => x.id === next)?.name ?? next
  const text = gatePrompt(i, from, to, promptCtx(data, s0, i.stage))
  await mutate($, s => {
    const x = s.ideas.find(y => y.id === ideaId)
    if (!x) return
    ensureProto(x)
    x.gateAsked![x.stage] = new Date().toISOString()
    addLog(s, x.stage, 'ideas', `${x.proto_id}: principles gate requested for ${from} to ${to}.`)
  })
  await sendToProtoChat($, ideaId, text, 'Principles gate requested in its chat.')
}

async function forceAdvance($: any, ideaId: string, record: (i: Idea, now: string) => void): Promise<void> {
  let stage = ''
  await mutate($, s => {
    const i = s.ideas.find(x => x.id === ideaId)
    if (!i) return
    const now = new Date().toISOString()
    ensureProto(i)
    record(i, now)
    delete i.gateAsked![i.stage]
    if (advanceIdea(i, now)) {
      stage = i.stage
      addLog(s, i.stage, 'ideas', `${i.proto_id} advanced to ${i.stage}.`)
      ideaEvent(s, i, now)
    }
  })
  if (stage) await update($, fstageAtom, () => stage)
  void flushOutbox($)
}

const overrideAdvance = ($: any, ideaId: string) =>
  forceAdvance($, ideaId, (i, now) => {
    const g = i.gate![i.stage]
    if (g) g.override = true
    else i.gate![i.stage] = { verdict: 'BLOCK', reason: 'overridden by Lucas', at: now, override: true }
  })

const advanceNoGate = ($: any, ideaId: string) =>
  forceAdvance($, ideaId, (i, now) => {
    i.gate![i.stage] = { verdict: 'PASS WITH RISKS', reason: 'advanced without the gate (Lucas chose to skip it)', at: now }
  })

// What the chat tagged is read from its transcript. A long output that did not fit is read from its Drive file instead.
async function readTruncated($: any, idea: Idea, parsed: Parsed): Promise<void> {
  const fixes: Parsed['outputs'] = []
  for (const t of parsed.outputs.filter(o => o.truncated).slice(0, 3)) {
    try {
      const raw = await driveCall($, 'search_files', { query: `title contains '${idea.proto_id}_${t.stage}_${t.gen}'`, pageSize: 5, excludeContentSnippets: true })
      const f = (Array.isArray(jsonOf(raw)?.files) ? jsonOf(raw).files : []).find((x: any) => x && typeof x.id === 'string')
      if (!f) continue
      const content = unwrapDoc(await driveCall($, 'read_file_content', { fileId: f.id })).trim()
      if (content) fixes.push({ ...t, content, truncated: false })
    } catch {
      // the next sync tries again
    }
  }
  parsed.outputs = [...parsed.outputs.filter(o => !o.truncated), ...fixes]
}

// Reads the linked conversations that changed and files them as memory: the note of the idea or stage, and the
// transcript as a new file in Drive. For a prototype, the tagged blocks of the chat become outputs, checks, scores and gates.
// `only` limits it to some prototypes (the 30 second sync while a request waits); `force` ignores the unchanged check.
async function syncChats($: any, only?: string[], force = false): Promise<void> {
  if (syncBusy) return
  syncBusy = true
  try {
    if (pendingChats.size > 0) await resolvePending($)
    const s0 = await loadStore($)
    const targets: { kind: 'idea' | 'stage'; scope: string; chat: ChatLink; label: string; old: string }[] = []
    for (const i of s0.ideas) if (i.chat && (!only || only.includes(i.id))) targets.push({ kind: 'idea', scope: i.id, chat: i.chat, label: `the prototype "${i.title}"`, old: i.memory ?? '' })
    if (!only) for (const [sid, chat] of Object.entries(s0.stageChats)) targets.push({ kind: 'stage', scope: sid, chat, label: `the "${sid}" stage`, old: s0.memory[sid]?.text ?? '' })
    for (const t of targets.slice(0, 20)) {
      let text = ''
      try {
        text = await ccdCall($, 'ccd_session_mgmt', 'list_events', { session_id: t.chat.id, limit: SYNC_EVENTS })
      } catch {
        continue
      }
      const h = hashText(text)
      if (h === t.chat.seen && !force) continue
      const tail = text.slice(-8000)
      const parsed = t.kind === 'idea' ? parseTags(text) : null
      const idea0 = t.kind === 'idea' ? s0.ideas.find(x => x.id === t.scope) : undefined
      if (parsed && idea0 && parsed.outputs.some(o => o.truncated)) await readTruncated($, idea0, parsed)
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
          let changed = false
          if (parsed) {
            const r = applyParsed(i, parsed, at)
            changed = r.added > 0 || r.scored || r.gates > 0
            if (resolveGates(i, at)) {
              changed = true
              addLog(s, i.stage, 'ideas', `${i.proto_id} advanced to ${i.stage} after the principles gate.`)
            }
            if (changed) addLog(s, i.stage, 'ideas', `Read tagged output from the chat of ${i.proto_id}.`)
          }
          enqueue(s, { v: 1, kind: 'exchange', scope: `idea:${i.id}`, at, stage: i.stage, user: 'transcript', answer: tail, purpose: 'chat', memory: memText, idea: ideaSnapshot(i) })
          if (changed) ideaEvent(s, i, at)
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

// Every 30 seconds: only the prototypes with a request still waiting for its answer.
async function syncPending($: any): Promise<void> {
  const s = await loadStore($)
  const ids = s.ideas.filter(i => i.chat && anyPending(i, Date.now())).map(i => i.id)
  if (ids.length > 0) await syncChats($, ids)
}

/* ---------- template library (Drive) ---------- */

type TState = { at: string; ok: boolean; error?: string; list: Template[] }
let tpl: TState | null = null
let tplBusy = false
const tplCache = new Map<string, Template>()

// Lists the template docs in the Drive folder and reads only the new or edited ones.
async function fetchTemplates($: any): Promise<void> {
  if (tplBusy) return
  tplBusy = true
  const at = new Date().toISOString()
  try {
    const o: any = jsonOf(
      await driveCall($, 'search_files', {
        query: `parentId = '${TEMPLATE_FOLDER_ID}' and title contains '${TEMPLATE_PREFIX}'`,
        pageSize: 100,
        excludeContentSnippets: true,
      }),
    )
    const files: any[] = (Array.isArray(o?.files) ? o.files : []).filter(
      (f: any) => f && typeof f.id === 'string' && String(f.title ?? '').startsWith(TEMPLATE_PREFIX) && !f.trashed,
    )
    const list: Template[] = []
    for (const f of files) {
      const cached = tplCache.get(f.id)
      if (cached && cached.modified === f.modifiedTime) {
        list.push(cached)
        continue
      }
      try {
        const t = parseTemplate(await driveCall($, 'read_file_content', { fileId: f.id }), f)
        tplCache.set(f.id, t)
        list.push(t)
      } catch {
        // an unreadable doc is skipped this cycle
      }
    }
    list.sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === 'ready' ? -1 : 1))
    tpl = { at, ok: true, list }
  } catch (err: any) {
    tpl = { at, ok: false, error: String((err && err.message) || err).slice(0, 400), list: tpl ? tpl.list : [] }
  } finally {
    tplBusy = false
    await update($, rev, n => n + 1)
  }
}

// "Run now" on a stage's scheduled task: asked of the main chat, which fires it.
async function runTask($: any, triggerId: string): Promise<void> {
  try {
    await $.prompt.submit({
      text: `Run the Roblox Radar scheduled task ${triggerId} now with the fire_trigger tool, then reply with one short line in Portuguese. Do nothing else.`,
    })
    $.ui.toast('Asked the main chat to run the task now.')
  } catch {
    $.ui.toast('Could not ask the main chat. Run it from the scheduled tasks list.')
  }
}

async function chooseTemplate($: any, ideaId: string, templateId: string | null): Promise<void> {
  const t = templateId ? (tpl?.list ?? []).find(x => x.id === templateId) : null
  await mutate($, s => {
    const i = s.ideas.find(x => x.id === ideaId)
    if (!i) return
    const now = new Date().toISOString()
    i.template = t ? { id: t.id, name: t.name, family: t.family, at: now } : null
    if (t) {
      ensureProto(i)
      i.template_mode = 'library'
      i.checks!.template = 'done'
    }
    i.updated = now
    addLog(s, i.stage, 'ideas', t ? `"${i.title}" uses the template ${t.name}.` : `Template cleared on "${i.title}".`)
    enqueue(s, { v: 1, kind: 'idea', scope: `idea:${i.id}`, at: now, stage: i.stage, idea: ideaSnapshot(i) })
  })
  const i = (await loadStore($)).ideas.find(x => x.id === ideaId)
  // The idea's own conversation learns the choice right away, without a hop through the main chat.
  if (t && i && i.chat) {
    try {
      await $.session.send({
        to: { sessionId: i.chat.id },
        text: `Lucas picked the template "${t.name}" (family ${t.family}) for this idea. Its doc: ${t.link ?? `https://docs.google.com/document/d/${t.id}`}. Read it when you work on the next stage.`,
      })
    } catch {
      // the template is on the card either way
    }
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
  if ('error' in live) return { level, lines: [...lines, `Live task status unavailable (optional connector).`] }
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
  const s: Store = raw && raw.threads ? { ...emptyStore(), ...raw } : emptyStore()
  if (!s.migrated070) {
    // One-time 0.7.0 migration: old ideas become prototypes with new IDs, or go to the inbox. Chat links are kept.
    migrateStore(s)
    await $.store.set(KEY, s)
  }
  return s
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
      s.inbox.push(newInbox(x.title, x.note, x.origin, null, now, n))
    })
    for (const [stage, list] of Object.entries(seed.knowledge)) {
      const cur = s.knowledge[stage] ?? []
      list.forEach((k, n) => {
        cur.push({ id: `seed-${stage}-${n}`, kind: k.kind as Knowledge['kind'], text: k.text, source: k.source, tag: k.tag, at: now })
      })
      s.knowledge[stage] = cur
    }
    s.seeded = true
    addLog(s, 'triagem', 'ideas', `Imported ${seed.ideas.length} ideas from the project docs into the loose ideas.`)
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

// A stage with receipts takes its colour from what its runs said (late counts as attention). The data file's
// flags and pendencies only colour stages that have no receipts yet.
function toneOf(s: Stage): Tone {
  if (s.build === 'not_built') return { label: 'NOT BUILT', color: SAND, glyph: '○' }
  const list = rcp ? rcp.receipts : []
  if (STAGES_WITH_RECEIPTS.includes(s.id) && receiptsFor(list, s.id).length > 0) {
    const h = stageHealth(list, s.id, Date.now()).level
    if (h === 2) return { label: 'ERROR', color: RUST, glyph: '●' }
    if (h === 1) return { label: 'ATTENTION', color: AMBER, glyph: '●' }
    return { label: 'OK', color: OLIVE, glyph: '●' }
  }
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
    await $.command.register({ name: 'panel', description: 'Open the Roblox Radar panel: /panel radar or /panel factory' })
    await $.command.register({ name: 'seed-skills', description: 'Create the missing Drive skill folders and seed files (never overwrites)' })
    await $.command.register({ name: 'stage', description: 'Focus a stage: /stage <name or id>, or /stage clear' })
    // The pane is not opened here: it belongs to Lucas, so only /panel opens it.
    await note($, 'surfaces_at_session_start', await $.session.surfaces())
    void ensureSeed($)
    void fetchLive($)
    void fetchReceipts($)
    void fetchTemplates($)
    void loadScoring($)
    void fetchSkills($)
    void restoreMemory($).then(() => flushOutbox($))
    $.clock.every(60 * 1000, () => void flushOutbox($))
    $.clock.every(5 * 60 * 1000, () => void syncChats($))
    $.clock.every(30 * 1000, () => void syncPending($))
    $.clock.every(FETCH_MS, () => void fetchSkills($))
    $.clock.every(FETCH_MS, () => void fetchLive($))
    $.clock.every(FETCH_MS, () => void fetchReceipts($))
    $.clock.every(FETCH_MS, () => void fetchTemplates($))
    $.clock.every(REDRAW_MS, () => void update($, rev, n => n + 1))
    return next(e)
  })

  on('session.attach', async ($, e, next) => {
    // Reattaching a session does not reopen the pane either.
    await note($, 'surfaces_at_attach', await $.session.surfaces())
    return next(e)
  })

  on('command.run', { command: 'panel' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'radar' || arg === 'factory') await update($, modeAtom, () => arg)
    await $.ui.open({ id: PANE, title: 'Roblox Radar', rows: 50, columns: 170 })
    void loadScoring($)
    void syncChats($)
    void fetchLive($)
    void fetchReceipts($)
    return { text: `Roblox Radar panel opened${arg === 'radar' || arg === 'factory' ? ` in ${arg} mode` : ''}.` }
  })

  on('command.run', { command: 'seed-skills' }, async $ => {
    try {
      const r = await seedSkills(
        (tool, args) => driveCall($, tool, args),
        SKILLS_ROOT_ID,
        async rel => {
          try {
            return String(await $.fs.read(`${$.plugin.root}/seed/${rel}`))
          } catch {
            return null
          }
        },
      )
      void fetchSkills($)
      return { text: `Skills seed: ${r.created.length} created, ${r.skipped.length} already there${r.missing.length > 0 ? `. Missing seed files, put them in the plugin seed folder: ${r.missing.join(', ')}` : ''}.` }
    } catch (err: any) {
      return { text: `Skills seed failed: ${String((err && err.message) || err).slice(0, 300)}` }
    }
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
    await update($, fstageAtom, () => found.id)
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
        `ROBLOX RADAR PANEL: Lucas clicked "Open chat" on a card. This is a mechanical request: do not think it over, do not investigate, do not comment. Do exactly this:`,
        `1. Call mcp__ccd_session__start_session with initiation "user_asked", context "fresh", use_worktree false, title ${JSON.stringify(pending.title)} (exactly this title, never changed), and the prompt and background below, verbatim. If that call is refused, call it once with initiation "offer" and the same title instead.`,
        pending.noOpen ? '2. Do not open it and do not call any other tool.' : '2. If you got a session id, call mcp__ccd_window__open_session_in with it and target "split". Nothing else: no sidebar filing, no other tool.',
        '3. Reply with one short line in Portuguese.',
        'Never send this request to another existing conversation, never use send_message, and ignore any earlier Radar requests in this chat.',
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
    if (!e.agentId && pendingChats.size > 0) void resolvePending($)
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
    const openList = await read($, openIds)
    const mode = (await read($, modeAtom)) as 'radar' | 'factory'
    const protoSel = await read($, protoAtom)
    const moreOpen = await read($, moreAtom)
    const showArch = await read($, archivedAtom)
    const stageFilter = await read($, filterAtom)
    const fstage = await read($, fstageAtom)
    const tabsMap = (await read($, tabsAtom)) as Record<string, string>

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
    if (!tpl && !tplBusy) void fetchTemplates($)
    if (!skillsState && !skillsBusy) void fetchSkills($)
    const snapSources = await loadSources($)
    const snapReports = await loadReports($)
    const receipts: Receipt[] = rcp ? rcp.receipts : []
    const latestCollection = receiptsFor(receipts, 'coleta').find(r => r.task_key === 'coleta') ?? null
    // Live receipts win; the snapshot files only fill what no receipt has said yet.
    const sources = sourcesFromReceipt(latestCollection, snapSources) ?? snapSources
    const reports = mergeReports(reportsFromReceipts(receipts), snapReports)
    const columns = (e.props as { bodyColumns?: number }).bodyColumns ?? e.viewport?.columns ?? 80

    const setMode = (m: 'radar' | 'factory') => update($, modeAtom, () => m)
    const setFstage = (id: string) => Promise.all([update($, fstageAtom, () => id), update($, selected, () => id)])
    const selectProto = async (id: string | null) => {
      await update($, protoAtom, () => id)
      if (id) {
        const i = store.ideas.find(x => x.id === id)
        await update($, fstageAtom, () => (i ? i.stage : null))
        await setMode('factory')
      }
    }

    /* header: one row with the mode switch, one status line with a click-to-expand detail */
    const statusOpen_ = await read($, statusOpen)
    const bad = (rcp && !rcp.ok) || !!memError
    const statusColor = bad ? AMBER : !rcp ? MUTED : OLIVE
    const statusLine = bad ? 'Drive or memory needs attention (click for detail)' : !rcp ? 'Reading Drive...' : 'Drive and memory OK'
    const header = (
      <Box flexDirection="column">
        <Box gap={2} alignItems="center" flexWrap="wrap">
          {Svg ? <Svg source={ICON_SVG} alt="Roblox Radar" width={28} height={28} /> : null}
          <Text bold color={CLAY}>
            {Svg ? 'Roblox Radar' : '▣ Roblox Radar'}
          </Text>
          <Button key="mode-radar" onPress={() => setMode('radar')}>
            <Text bold color={mode === 'radar' ? BG : FG} backgroundColor={mode === 'radar' ? NEON : PANEL}>{' Radar '}</Text>
          </Button>
          <Button key="mode-factory" onPress={() => setMode('factory')}>
            <Text bold color={mode === 'factory' ? BG : FG} backgroundColor={mode === 'factory' ? NEON : PANEL}>{' Factory '}</Text>
          </Button>
          <Text bold color={SKY}>{`v${ver}`}</Text>
        </Box>
        <Box gap={2}>
          <Button key="status-toggle" onPress={() => update($, statusOpen, (v: boolean) => !v)}>
            <Text color={statusColor}>{statusOpen_ ? '▾ ' : '▸ '}●</Text>
            <Text color={MUTED}>{` ${statusLine}`}</Text>
          </Button>
          <Button key="refresh" label="Refresh" onPress={() => Promise.all([fetchLive($), fetchReceipts($), fetchTemplates($), fetchSkills($)])} />
        </Box>
        {statusOpen_ ? (
          <Box flexDirection="column" paddingLeft={2}>
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
            <Text color={MUTED}>{`Stage descriptions come from the data file (${data.updated}).`}</Text>
          </Box>
        ) : null}
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
      go: id => setFstage(id),
      sendItem: (r, si, ii) => sendToFactory($, { kind: 'advisor', report: r, si, ii }),
      saveHook: (r, it) => saveHook($, r, it),
      openChat: (kind, scope) => openChat($, kind, scope),
      runTask: tid => runTask($, tid),
      templates: tpl ? { at: tpl.at, ok: tpl.ok, error: tpl.error, list: tpl.list } : null,
      chooseTemplate: (ideaId, tid) => chooseTemplate($, ideaId, tid),
      refreshTemplates: () => fetchTemplates($),
      chatError: key => chatError[key] ?? null,
      chatBusy: key => chatBusy.has(key),
      addKnowledge: (sid, v) => addKnowledge($, sid, v),
      removeKnowledge: (sid, id) => removeKnowledge($, sid, id),
      scoring: scoringCfg,
      skills: skillsState,
      sendToFactory: src => sendToFactory($, src),
      addInbox: v => addInbox($, v),
      discardInbox: id => discardInbox($, id),
      factoryNote,
      selectProto,
      proto: protoSel,
      showArchived: showArch,
      toggleArchived: () => update($, archivedAtom, (v: boolean) => !v),
      stageFilter,
      setStageFilter: id => update($, filterAtom, () => id),
      fstage,
      setFstage: id => setFstage(id),
      openProtoChat: (id, st) => openProtoChat($, id, st),
      runFactory: (id, key) => runFactory($, id, key),
      markDone: (id, st) => markStageDone($, id, st),
      requestAdvance: (id, force) => requestAdvance($, id, force),
      overrideAdvance: id => overrideAdvance($, id),
      advanceNoGate: id => advanceNoGate($, id),
      refreshNow: id => syncChats($, [id], true).then(() => update($, rev, n => n + 1)),
      pickItem: (id, st, item, m) => pickItem($, id, st, item, m),
      registerResearch: (id, t) => registerResearch($, id, t),
      setTemplateMode: (id, m) => setTemplateMode($, id, m),
      renameAbbr: (id, raw) => renameProtoAbbr($, id, raw),
      archive: (id, on) => archiveProto($, id, on),
    }

    /* the body of one tab of one stage */
    const bodyFor = (current: Stage, tabId: string) => {
      const tone = toneOf(current)
      const logs: LogEntry[] = store.log[current.id] ?? []
      const instructions = store.instructions[current.id] ?? []
      const archive = store.archive[current.id] ?? []
      const openPend = current.pendencies.filter(p => !p.done)
      if (tabId === 'sources') return sourcesView(vctx)
      if (tabId === 'reports') return reportsView(vctx)
      if (tabId === 'receipts') return receiptsView(vctx, current)
      if (tabId === 'knowledge') return knowledgeView(vctx, current)
      if (tabId === 'templates') return templatesView(vctx)
      if (tabId === 'overview') {
        return (
          <Box flexDirection="column">
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
            {instructions.length === 0 ? <Text color={MUTED}>None yet. Rules you give in a stage chat are saved here.</Text> : null}
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
      }
      if (tabId === 'tasks') {
        const lines = liveOf(current).lines
        return (
          <Box flexDirection="column">
            {current.trigger_ids.length === 0 ? <Text color={MUTED}>{current.no_task_note || 'No automated task.'}</Text> : null}
            {current.trigger_ids.length > 0 && live && 'error' in live ? <Text color={MUTED}>Live task status unavailable (optional connector).</Text> : null}
            {current.trigger_ids.length > 0 ? (
              <Box gap={1} flexWrap="wrap">
                {current.trigger_ids.map(tid => {
                  const entry = live && !('error' in live) ? live.byId[tid] : undefined
                  return <Button key={`run-${tid}`} label={`Run now: ${entry ? entry.name.replace(/^Radar Roblox: /, '') : tid}`} onPress={() => runTask($, tid)} />
                })}
              </Box>
            ) : null}
            {lines.map(l => (
              <Text key={l} dimColor>
                {l}
              </Text>
            ))}
            {current.status_doc ? <Text color={MUTED}>Daily report: {current.status_doc} (Drive).</Text> : null}
          </Box>
        )
      }
      if (tabId === 'pending') {
        return (
          <Box flexDirection="column">
            {openPend.length === 0 ? <Text color={MUTED}>Nothing open.</Text> : null}
            {openPend.map(p => (
              <Box key={`p-${p.id}`} gap={1}>
                <Text color={p.owner === 'Lucas' ? CLAY : SAND}>[{p.owner}]</Text>
                <Text color={FG}>{p.text}</Text>
                <Text color={MUTED}>since {p.since}</Text>
              </Box>
            ))}
          </Box>
        )
      }
      if (tabId === 'assets') {
        const items = [...current.skills.map(i => ({ ...i, kind: 'skill' })), ...current.docs.map(i => ({ ...i, kind: 'doc' }))]
        return (
          <Box flexDirection="column">
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
          </Box>
        )
      }
      // log
      return (
        <Box flexDirection="column">
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

    const MORE_TABS: TabDef[] = [
      { id: 'overview', label: 'Overview' },
      { id: 'pending', label: 'Pending' },
      { id: 'assets', label: 'Skills and docs' },
      { id: 'log', label: 'Log' },
    ]
    const setTab = (key: string, t: string) => update($, tabsAtom, (m: Record<string, string>) => ({ ...m, [key]: t }))

    // Tab bar: the main tabs, then one "More" toggle that reveals the rarely used ones.
    const tabBarOf = (key: string, main: TabDef[], extra: TabDef[], active: string) => (
      <Box gap={2} paddingX={1} flexWrap="wrap">
        {[...main, ...(moreOpen ? extra : [])].map(t => (
          <Button key={`tab-${key}-${t.id}`} onPress={() => setTab(key, t.id)}>
            <Text bold={t.id === active} underline={t.id === active} color={t.id === active ? NEON : MUTED}>
              {t.label}
            </Text>
          </Button>
        ))}
        <Button key={`more-${key}`} onPress={() => update($, moreAtom, (v: boolean) => !v)}>
          <Text color={SKY}>{moreOpen ? 'More ▾' : 'More ▸'}</Text>
        </Button>
      </Box>
    )

    /* Radar mode: collection, screening and advisor, loose ideas, auditor bar */
    const radarStageBox = (st: Stage) => {
      const tone = toneOf(st)
      const dflt = st.default_tab ?? 'overview'
      const mainLabel = (st.extra_tabs ?? []).find(t => t.id === dflt)?.label ?? 'Main'
      const main: TabDef[] = [{ id: dflt, label: mainLabel }, { id: 'tasks', label: 'Tasks' }]
      if (STAGES_WITH_RECEIPTS.includes(st.id)) main.push({ id: 'receipts', label: `Receipts (${receiptsFor(receipts, st.id).length})` })
      const known = [...main, ...MORE_TABS].map(t => t.id)
      const active = tabsMap[st.id] && known.includes(tabsMap[st.id] as string) ? (tabsMap[st.id] as string) : dflt
      const shown = active === dflt || main.some(t => t.id === active) || moreOpen ? active : dflt
      return (
        <Box key={`rbox-${st.id}`} flexDirection="column" gap={1} borderStyle="round" borderColor={tone.color} backgroundColor={PANEL} paddingX={1} paddingY={1}>
          <Box gap={2} flexWrap="wrap" alignItems="center">
            <Text bold color={NEON}>{st.name}</Text>
            <Text bold color={tone.color}>{`${tone.glyph} ${tone.label}`}</Text>
            <Text color={MUTED}>{st.sub}</Text>
            {openChatButton(vctx, 'stage', st.id, store.stageChats[st.id] ?? null, () => openChat($, 'stage', st.id))}
          </Box>
          {tabBarOf(st.id, main, MORE_TABS, shown)}
          <Box flexDirection="column" paddingX={1}>
            {bodyFor(st, shown)}
          </Box>
        </Box>
      )
    }
    const auditor = data.stages.find(s => s.id === 'auditor')
    const auditorBar = auditor ? (
      <Box key="auditor-bar" borderStyle="round" borderColor={toneOf(auditor).color} backgroundColor={PANEL} paddingX={1} gap={1} flexWrap="wrap">
        <Text bold color={FG}>Auditor</Text>
        <Text color={MUTED}>{auditor.sub}</Text>
        {(() => {
          const last = stageHealth(receipts, 'auditor', Date.now()).last
          return last ? (
            <Text color={last.outcome === 'ok' ? OLIVE : last.outcome === 'failed' ? RUST : AMBER}>{`${clip(last.summary, 90)} (${ago(last.finished_utc, Date.now())})`}</Text>
          ) : (
            <Text color={MUTED}>no audit yet</Text>
          )
        })()}
      </Box>
    ) : null
    const skillsBlock = moreOpen ? <Box flexDirection="column" paddingX={1}>{skillsRow(vctx)}</Box> : null
    const coleta = data.stages.find(s => s.id === 'coleta')
    const triagem = data.stages.find(s => s.id === 'triagem')

    if (mode === 'radar') {
      return (
        <Box flexDirection="column" gap={1} backgroundColor={BG} paddingX={1} paddingY={1}>
          {header}
          {factoryNoteBar(vctx)}
          {coleta ? radarStageBox(coleta) : null}
          {triagem ? radarStageBox(triagem) : null}
          {inboxBox(vctx)}
          {auditorBar}
          {skillsBlock}
        </Box>
      )
    }

    /* Factory mode: prototype list, or one prototype with its stages */
    const moreFor = (stageId: string) => {
      const st = data.stages.find(x => x.id === stageId)
      if (!st) return null
      const extra: TabDef[] = [
        ...(st.extra_tabs ?? []).filter(t => t.id === 'knowledge' || t.id === 'templates'),
        ...(st.trigger_ids.length > 0 ? [{ id: 'tasks', label: 'Tasks' }] : []),
        ...(STAGES_WITH_RECEIPTS.includes(st.id) ? [{ id: 'receipts', label: 'Receipts' }] : []),
        ...MORE_TABS,
      ]
      const key = `more:${st.id}`
      const active = tabsMap[key] && extra.some(t => t.id === tabsMap[key]) ? (tabsMap[key] as string) : (extra[0]?.id ?? 'overview')
      return (
        <Box flexDirection="column" gap={1}>
          <Button key="factory-more" onPress={() => update($, moreAtom, (v: boolean) => !v)}>
            <Text color={SKY}>{moreOpen ? 'More ▾' : 'More ▸'}</Text>
          </Button>
          {moreOpen ? (
            <Box flexDirection="column" gap={1} borderStyle="round" borderColor={LINE} backgroundColor={PANEL} paddingY={1}>
              <Box gap={2} paddingX={1} flexWrap="wrap">
                {extra.map(t => (
                  <Button key={`mtab-${t.id}`} onPress={() => setTab(key, t.id)}>
                    <Text bold={t.id === active} underline={t.id === active} color={t.id === active ? NEON : MUTED}>{t.label}</Text>
                  </Button>
                ))}
              </Box>
              <Box flexDirection="column" paddingX={1}>
                {bodyFor(st, active)}
                {skillsRow(vctx)}
              </Box>
            </Box>
          ) : null}
        </Box>
      )
    }
    return (
      <Box flexDirection="column" gap={1} backgroundColor={BG} paddingX={1} paddingY={1}>
        {header}
        {factoryView(vctx, moreFor)}
      </Box>
    )
  })
}
