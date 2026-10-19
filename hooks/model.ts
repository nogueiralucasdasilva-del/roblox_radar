import type { Stage } from '../types'

export type Msg = { role: 'user' | 'assistant' | 'system'; text: string; at: string; moveTo?: string }
export type Busy = { agentId: string; at: string }
export type Thread = { id: string; n: number; startedAt: string; summary: string; messages: Msg[]; busy: Busy | null }
export type Archived = { id: string; n: number; startedAt: string; endedAt: string; reason: string; summary: string; messageCount: number }
export type LogEntry = { at: string; kind: string; text: string }
export type IdeaStatus = 'pending' | 'promising' | 'rejected'
export type IdeaStep = { stage: string; at: string; status: IdeaStatus }
export type Idea = {
  id: string
  title: string
  note: string
  origin: 'advisor' | 'own'
  from: string | null
  stage: string
  status: IdeaStatus
  proto_id: string | null
  created: string
  updated: string
  history: IdeaStep[]
  // The card's own conversation, the quick scan verdict and the idea's memory file travel with the idea.
  messages?: Msg[]
  busy?: Busy | null
  scan?: { level: string; at: string } | null
  memory?: string
  chat?: ChatLink | null
}
// A real app conversation tied to an idea card or a stage. `seen` is how much of its transcript the panel already filed.
export type ChatLink = { id: string; title: string; link: string | null; at: string; syncedAt: string | null; seen: number }
export type MemoryNote = { text: string; at: string }
export type Outgoing = { title: string; content: string; at: string }
export type Job = { kind: 'stage' | 'idea'; scope: string; purpose: 'chat' | 'scan' | 'brief' }
export type KnowledgeKind = 'principle' | 'technique' | 'pattern' | 'pitfall' | 'result'
export type Knowledge = { id: string; kind: KnowledgeKind; text: string; source: string; tag: string; at: string }
export type Store = {
  threads: Record<string, Thread>
  archive: Record<string, Archived[]>
  instructions: Record<string, string[]>
  log: Record<string, LogEntry[]>
  ideas: Idea[]
  knowledge: Record<string, Knowledge[]>
  seeded: boolean
  // Memory: one note per stage, events waiting to be written to Drive, running agents, restore marker.
  memory: Record<string, MemoryNote>
  outbox: Outgoing[]
  memSaved: number
  restoredAt: string | null
  jobs: Record<string, Job>
  stageChats: Record<string, ChatLink>
}

// The ladder an idea climbs. Each step is a stage id.
export const IDEA_STAGES = ['prevalid', 'brief', 'template', 'doccompleto', 'build', 'titulo', 'thumb', 'publicar', 'metricas']
export const KNOWLEDGE_KINDS: KnowledgeKind[] = ['principle', 'technique', 'pattern', 'pitfall', 'result']
export const KNOWLEDGE_TAG = 'KNOWLEDGE:'

// A stage chat rolls over into a new one, carrying a summary, when it passes either limit.
export const ROLLOVER_CHARS = 24000
export const ROLLOVER_MESSAGES = 40
// Only this much recent history is sent with each message, so a prompt never grows with the chat.
export const HISTORY_CHARS = 9000
export const STALE_BUSY_MS = 10 * 60 * 1000
export const INSTRUCTION_TAG = 'INSTRUCTION:'

export function emptyStore(): Store {
  return { threads: {}, archive: {}, instructions: {}, log: {}, ideas: [], knowledge: {}, seeded: false, memory: {}, outbox: [], memSaved: 0, restoredAt: null, jobs: {}, stageChats: {} }
}

export function newThread(n: number, summary: string, now: string): Thread {
  return { id: `t${n}-${now.slice(0, 10)}`, n, startedAt: now, summary, messages: [], busy: null }
}

export function clip(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`
}

export function threadChars(t: Thread): number {
  return t.messages.reduce((n, m) => n + m.text.length, 0)
}

export function needsRollover(t: Thread): boolean {
  return threadChars(t) > ROLLOVER_CHARS || t.messages.length > ROLLOVER_MESSAGES
}

export function isBusyStale(t: Thread, nowMs: number): boolean {
  return t.busy !== null && nowMs - Date.parse(t.busy.at) > STALE_BUSY_MS
}

// Newest user and assistant messages that fit the budget, in chronological order.
export function recentHistory(messages: readonly Msg[], budget: number): Msg[] {
  const out: Msg[] = []
  let used = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (!m || m.role === 'system') continue
    if (used + m.text.length > budget && out.length > 0) break
    out.push(m)
    used += m.text.length
  }
  return out.reverse()
}

export function buildPrompt(
  stage: Stage,
  updated: string,
  instructions: readonly string[],
  summary: string,
  history: readonly Msg[],
  userText: string,
  hasKnowledge = false,
  context: readonly string[] = [],
): string {
  const lines: string[] = [
    `You are the stage agent for the "${stage.name}" stage (id ${stage.id}) of the Roblox Radar pipeline, working with Lucas Nogueira (Ritz Deli Games) through a panel. Reply in English, even when he writes in Portuguese. Be direct, no flattery, no em dashes, no emoji.`,
    `Stage snapshot recorded on ${updated}. It may be stale. Do not state a live status unless you verified it in this reply:`,
    JSON.stringify(stage),
  ]
  if (instructions.length > 0) {
    lines.push('Standing instructions for this stage (always obey):', ...instructions.map(i => `- ${i}`))
  }
  if (context.length > 0) lines.push(...context)
  if (summary) lines.push('Summary of the earlier chat on this stage:', summary)
  if (history.length > 0) {
    lines.push('Recent messages:', ...history.map(m => `${m.role === 'user' ? 'Lucas' : 'Agent'}: ${m.text}`))
  }
  lines.push(
    `Lucas now writes: ${userText}`,
    'Rules: answer about this stage. When he asks for a change, make it with the tools this session has, and say plainly which tool is missing if one is. Keep it short.',
    `If his message contains a rule he wants applied from now on in this stage, end your reply with one line per rule that starts with "${INSTRUCTION_TAG}" followed by the rule in one sentence. Otherwise add no such line.`,
  )
  if (hasKnowledge) {
    lines.push(
      `This stage keeps a knowledge repository. When you establish a reusable principle, technique, pattern, pitfall or result, end your reply with one line per entry: "${KNOWLEDGE_TAG}" then the kind, a "|" and the text. Example: ${KNOWLEDGE_TAG} technique | Show the reveal in the first frame. Only add entries you can support, and say where the evidence comes from in the text.`,
    )
  }
  return lines.join('\n')
}

export function extractTagged(answer: string, tag: string): { clean: string; found: string[] } {
  const found: string[] = []
  const keep: string[] = []
  for (const line of answer.split('\n')) {
    const t = line.trim()
    if (t.startsWith(tag)) {
      const rest = t.slice(tag.length).trim()
      if (rest) found.push(rest)
    } else {
      keep.push(line)
    }
  }
  return { clean: keep.join('\n').trim(), found }
}

export function extractInstructions(answer: string): { clean: string; found: string[] } {
  return extractTagged(answer, INSTRUCTION_TAG)
}

// "technique | text" or just "text" (kind defaults to technique).
export function parseKnowledge(line: string): { kind: KnowledgeKind; text: string } | null {
  const bar = line.indexOf('|')
  const head = (bar > 0 ? line.slice(0, bar) : '').trim().toLowerCase()
  const kind = KNOWLEDGE_KINDS.find(k => k === head)
  const text = (kind ? line.slice(bar + 1) : line).trim()
  return text ? { kind: kind ?? 'technique', text } : null
}

// Typed entry in the repository input: "pattern: text" (or "pattern | text").
export function parseTyped(raw: string): { kind: KnowledgeKind; text: string } | null {
  const m = raw.trim().match(/^([a-z]+)\s*[:|]\s*([\s\S]+)$/i)
  const kind = m ? KNOWLEDGE_KINDS.find(k => k === (m[1] ?? '').toLowerCase()) : undefined
  const text = (kind && m ? (m[2] ?? '') : raw).trim()
  return text ? { kind: kind ?? 'technique', text } : null
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'idea'
  )
}

// Provisional format RB-<yyyymmdd>-<slug>, from the project premises. The format is still Lucas's call.
export function makeProtoId(now: string, title: string, taken: readonly string[]): string {
  const base = `RB-${now.slice(0, 10).replace(/-/g, '')}-${slugify(title)}`
  if (!taken.includes(base)) return base
  for (let i = 2; i < 100; i++) if (!taken.includes(`${base}-${i}`)) return `${base}-${i}`
  return `${base}-x`
}

export function newIdea(title: string, note: string, origin: 'advisor' | 'own', from: string | null, now: string, salt: number): Idea {
  return {
    id: `${slugify(title).slice(0, 12)}-${Date.parse(now).toString(36)}${salt}`,
    title: title.trim(),
    note,
    origin,
    from,
    stage: 'prevalid',
    status: 'pending',
    proto_id: null,
    created: now,
    updated: now,
    history: [{ stage: 'prevalid', at: now, status: 'pending' }],
  }
}

export function nextStageOf(stage: string): string | null {
  const i = IDEA_STAGES.indexOf(stage)
  return i >= 0 && i < IDEA_STAGES.length - 1 ? (IDEA_STAGES[i + 1] ?? null) : null
}

export function setIdeaStatus(idea: Idea, status: IdeaStatus, now: string): void {
  idea.status = status
  idea.updated = now
  const last = idea.history[idea.history.length - 1]
  if (last && last.stage === idea.stage) last.status = status
}

// Moves the idea one stage up. The brief stage is where the proto_id is born. Returns false when it cannot move.
export function promoteIdea(idea: Idea, taken: readonly string[], now: string): boolean {
  const next = nextStageOf(idea.stage)
  if (!next || idea.status === 'rejected') return false
  idea.stage = next
  idea.status = 'pending'
  idea.updated = now
  if (!idea.proto_id) idea.proto_id = makeProtoId(now, idea.title, taken)
  idea.history.push({ stage: next, at: now, status: 'pending' })
  return true
}

export function stepFor(idea: Idea, stageId: string): IdeaStep | undefined {
  for (let i = idea.history.length - 1; i >= 0; i--) {
    const h = idea.history[i]
    if (h && h.stage === stageId) return h
  }
  return undefined
}

// Ideas that are in, or have passed through, a stage. Newest activity first.
export function ideasAt(ideas: readonly Idea[], stageId: string): Idea[] {
  return ideas.filter(i => stepFor(i, stageId)).sort((a, b) => b.updated.localeCompare(a.updated))
}

export function summarizerPrompt(previous: string, messages: readonly Msg[]): string {
  const body = messages
    .filter(m => m.role !== 'system')
    .map(m => `${m.role === 'user' ? 'Lucas' : 'Agent'}: ${clip(m.text, 1500)}`)
    .join('\n')
  return [
    'Summarize this stage chat so a new chat can continue it. Max 180 words, plain text, English.',
    'Keep: decisions made, changes already done, open questions, facts the user stated. Drop pleasantries and anything already resolved.',
    previous ? `Earlier summary:\n${previous}` : '',
    `Chat:\n${body}`,
  ]
    .filter(Boolean)
    .join('\n\n')
}

// Fallback when the model cannot summarize: keep the old summary and the tail of the chat.
export function crudeSummary(previous: string, messages: readonly Msg[]): string {
  const tail = recentHistory(messages, 1500).map(m => `${m.role === 'user' ? 'Lucas' : 'Agent'}: ${clip(m.text, 300)}`)
  return clip([previous, ...tail].filter(Boolean).join('\n'), 2400)
}
