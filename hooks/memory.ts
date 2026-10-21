// Pure logic for the panel's memory: prompts, the events written to Drive, and how a restore replays them.
// Drive files are never edited. Every exchange, idea change and handoff is a new small file, so nothing is lost
// and the newest file of each kind wins on restore.
import type { Idea, Msg, Store } from './model'
import { clip, recentHistory } from './model'
import { unwrapDoc } from './receipts'

export const MEMORY_FOLDER_ID = '1x9RZNanYNK_bG3MiWQwIHhIG1c5XAyPT'
export const MEMORY_WORDS = 220
export const IDEA_HISTORY_CHARS = 6000
export const KEEP_MESSAGES = 40

export type MemEvent = {
  v: 1
  kind: 'exchange' | 'idea' | 'handoff'
  scope: string // stage id, or "idea:<id>"
  at: string
  stage: string
  user?: string
  answer?: string
  purpose?: string
  memory?: string
  idea?: Idea
}

const STYLE = 'Write in English. Be direct, no flattery, no em dashes, no emoji. Mark what is a fact (with its source and date) and what is your inference.'

export function eventTitle(e: MemEvent): string {
  const stamp = e.at.replace(/[-:]/g, '').slice(0, 15)
  const scope = e.scope.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 40)
  return `mem_${e.kind}_${scope}_${stamp}Z`
}

export function parseMemEvent(text: string): MemEvent | null {
  try {
    const o = JSON.parse(unwrapDoc(text))
    if (!o || o.v !== 1 || typeof o.kind !== 'string' || typeof o.scope !== 'string' || typeof o.at !== 'string') return null
    return o as MemEvent
  } catch {
    return null
  }
}

// The idea as it travels, without its long chat (that lives in the exchange events).
export function ideaSnapshot(i: Idea): Idea {
  return { ...i, messages: (i.messages ?? []).slice(-6), busy: null }
}

export function memoryPrompt(scopeLabel: string, old: string, user: string, answer: string): string {
  return [
    `You keep the memory file for ${scopeLabel} in the Roblox Radar pipeline. A new chat will start from this file alone, so it must hold everything that still matters.`,
    `Update it with the new exchange. Max ${MEMORY_WORDS} words, plain text, English, these sections in this order: Decisions, Facts (with source and date), Open questions, Artifacts (links, file ids, proto_ids).`,
    'Keep every line from the old file that is still true. Drop only what the new exchange resolved or contradicted. Never invent. Return only the file.',
    `Old file:\n${old || '(empty)'}`,
    `New exchange:\nLucas: ${clip(user, 3000)}\nAgent: ${clip(answer, 5000)}`,
  ].join('\n\n')
}

// Fallback when the model cannot rewrite the memory: keep the old file and add the gist of the exchange.
export function crudeMemory(old: string, user: string, answer: string): string {
  return clip([old, `Lucas: ${clip(user, 300)}`, `Agent: ${clip(answer, 600)}`].filter(Boolean).join('\n'), 2400)
}

export function ideaFacts(i: Idea): string {
  return JSON.stringify({
    title: i.title,
    note: i.note,
    origin: i.origin,
    source: i.from,
    stage: i.stage,
    status: i.status,
    proto_id: i.proto_id,
    potential: i.scan?.level ?? null,
    template: i.template ? { name: i.template.name, family: i.template.family, doc: `https://docs.google.com/document/d/${i.template.id}` } : null,
    path: i.history,
  })
}

export function scanPrompt(i: Idea, stageMemory: string): string {
  return [
    `You are the pre-validation agent of the Roblox Radar pipeline, working for Lucas Nogueira (Ritz Deli Games). Run a quick scan of the idea below. ${STYLE}`,
    `Idea: ${ideaFacts(i)}`,
    stageMemory ? `Memory of the pre-validation stage:\n${stageMemory}` : '',
    'How to work: use the roblox-concept-validator skill (quick scan only, concept only, never loop design) if it is available. Check the latest dated files in the roblox_trends Drive folder for radar signal, and check live Roblox numbers (concurrent players, visits, peaks, dates) for the closest existing games with the tools this session has. Use real numbers with dates. If a tool is missing, say which, and lower the confidence.',
    `Reply in exactly this format, nothing before or after:
Potential: HIGH, MEDIUM or LOW, with high, medium or low confidence. One short sentence saying what you evaluated (for example: I re-evaluated only the concept, without looking at the loop).

* Noun / verb: the noun and the verb of the fantasy. Whether the hook explains itself in one image, and who the audience is.
* Why it could work: whitespace, proof of demand with numbers, the clip moment.
* Why it could fail: weak or IP-driven demand, falling peaks, saturation, with numbers and dates.
* Radar: what the radar shows for this theme, by name. Say so plainly if it shows nothing.

To move up to the next level: the one change to the hook that would raise the potential.
Should I write the full brief (2 pages, Google Doc)? Yes, No, or Adjust the idea first.`,
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function ideaChatPrompt(i: Idea, stageName: string, stageMemory: string, history: readonly Msg[], text: string): string {
  return [
    `You are the agent for one idea card in the "${stageName}" stage of the Roblox Radar pipeline, talking with Lucas Nogueira (Ritz Deli Games). Help him explore and sharpen this idea. ${STYLE}`,
    `Idea: ${ideaFacts(i)}`,
    i.memory ? `Memory of this idea (everything decided so far, in every stage):\n${i.memory}` : '',
    stageMemory ? `Memory of the ${stageName} stage:\n${stageMemory}` : '',
    `Full transcripts are kept as files in the Drive folder roblox_radar_memory (id ${MEMORY_FOLDER_ID}). Search there if you need something older than the memory above.`,
    history.length > 0 ? `Recent messages on this card:\n${history.map(m => `${m.role === 'user' ? 'Lucas' : 'Agent'}: ${m.text}`).join('\n')}` : '',
    `Lucas now writes: ${text}`,
    'Use the tools this session has when a fact needs checking. Keep it short.',
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function briefPrompt(i: Idea): string {
  return [
    `You are the brief agent of the Roblox Radar pipeline, working for Lucas Nogueira (Ritz Deli Games). Lucas said yes to the full brief for the idea below. ${STYLE}`,
    `Idea: ${ideaFacts(i)}`,
    i.memory ? `Memory of this idea:\n${i.memory}` : '',
    `Quick scan and discussion so far:\n${(i.messages ?? []).filter(m => m.role !== 'system').slice(-6).map(m => `${m.role === 'user' ? 'Lucas' : 'Agent'}: ${clip(m.text, 2500)}`).join('\n')}`,
    `Use the roblox-concept-validator skill to write the full 2-page concept brief as a Google Doc in Lucas's Drive. Put the proto_id ${i.proto_id ?? '(none yet)'} in the title. Concept only, never loop design.`,
    'Reply with the doc link, then three lines: the fantasy, the wedge, the main risk.',
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function parsePotential(answer: string): string | null {
  const m = answer.match(/potential\s*:\s*\**\s*(high|medium|low)/i)
  return m && m[1] ? m[1].toUpperCase() : null
}

export function ideaHistory(i: Idea): Msg[] {
  return recentHistory(i.messages ?? [], IDEA_HISTORY_CHARS)
}

// Replays events read from Drive into a store, oldest first. Returns how many were applied.
export function applyEvents(s: Store, events: MemEvent[]): number {
  let n = 0
  const sorted = [...events].sort((a, b) => a.at.localeCompare(b.at))
  for (const e of sorted) {
    if ((e.kind === 'idea' || e.kind === 'handoff') && e.idea) {
      upsertIdea(s, e.idea)
      n++
    } else if (e.kind === 'exchange') {
      if (e.scope.startsWith('idea:')) {
        const id = e.scope.slice(5)
        if (e.idea && !s.ideas.some(x => x.id === id)) upsertIdea(s, e.idea)
        const i = s.ideas.find(x => x.id === id)
        if (!i) continue
        const msgs = i.messages ?? []
        if (!msgs.some(m => m.at === e.at && m.role === 'assistant')) {
          if (e.user) msgs.push({ role: 'user', text: e.user, at: e.at })
          if (e.answer) msgs.push({ role: 'assistant', text: e.answer, at: e.at })
        }
        i.messages = msgs.slice(-KEEP_MESSAGES)
        if (e.memory) i.memory = e.memory
        if (e.purpose === 'scan' && e.answer) {
          const level = parsePotential(e.answer)
          if (level) i.scan = { level, at: e.at }
        }
      } else {
        const t = s.threads[e.scope]
        if (t && !t.messages.some(m => m.at === e.at && m.role === 'assistant')) {
          if (e.user) t.messages.push({ role: 'user', text: e.user, at: e.at })
          if (e.answer) t.messages.push({ role: 'assistant', text: e.answer, at: e.at })
          t.messages = t.messages.slice(-KEEP_MESSAGES)
        }
        if (e.memory) s.memory[e.scope] = { text: e.memory, at: e.at }
      }
      n++
    }
  }
  return n
}

function upsertIdea(s: Store, snap: Idea): void {
  const byId = s.ideas.findIndex(x => x.id === snap.id)
  // A fresh install seeds the same ideas under new ids; the saved one replaces its untouched twin.
  const twin = byId >= 0 ? byId : s.ideas.findIndex(x => x.title.toLowerCase() === snap.title.toLowerCase() && !(x.messages ?? []).length)
  const keepMsgs = twin >= 0 ? (s.ideas[twin]?.messages ?? []) : []
  const merged: Idea = { ...snap, busy: null, messages: keepMsgs.length > (snap.messages ?? []).length ? keepMsgs : (snap.messages ?? []) }
  if (twin >= 0) {
    const cur = s.ideas[twin]
    if (cur && cur.updated > snap.updated && cur.id === snap.id) return
    s.ideas[twin] = merged
  } else {
    s.ideas.push(merged)
  }
}
