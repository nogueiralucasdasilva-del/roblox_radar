// Factory logic, pure: proto IDs, ABBR, creating a prototype, migrating an old store, applying tagged chat output.
import { IDEA_STAGES, clip, nextStageOf } from './model'
import type { Idea, InboxIdea, Output, Requested, SkillRef, Store } from './model'
import { DONE_KIND } from './outputs'
import type { Parsed } from './outputs'
import { addScores, parseCriteria } from './scoring'

// Lucas prefers the new chat to open beside the panel right after "Send to Factory". Switch off here.
export const AUTO_OPEN_CHAT_ON_SEND = true

export const STOP_WORDS = new Set(['the', 'a', 'an', 'of', 'and', 'or', 'to', 'for', 'in', 'on', 'my', 'your', 'with', 'by', 'at', 'is', 'it', 'vs'])

const letters = (w: string): string =>
  w
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z]/g, '')
    .toUpperCase()

export function significantWords(title: string): string[] {
  const all = title.split(/[\s\-_/]+/).map(letters).filter(Boolean)
  const sig = all.filter(w => !STOP_WORDS.has(w.toLowerCase()) && w.length > 0)
  return sig.length > 0 ? sig : all
}

// First significant word, uppercase letters only, max 7. On collision, append the initial of the second word.
export function abbrOf(title: string, taken: readonly string[]): string {
  const words = significantWords(title)
  const used = new Set(taken.map(t => t.toUpperCase()))
  const base = (words[0] ?? 'IDEA').slice(0, 7) || 'IDEA'
  if (!used.has(base)) return base
  const second = words[1]?.[0]
  if (second) {
    const withInitial = (base.slice(0, 6) + second).slice(0, 7)
    if (!used.has(withInitial)) return withInitial
  }
  for (let i = 2; i < 1000; i++) {
    const suffix = String(i)
    const cand = base.slice(0, Math.max(1, 7 - suffix.length)) + suffix
    if (!used.has(cand)) return cand
  }
  return base
}

export const cleanAbbr = (raw: string): string => letters(raw).slice(0, 7)

export function protoIdOf(seq: number, abbr: string): string {
  return `P${String(seq).padStart(3, '0')}-${abbr}`
}

export function chatTitleOf(protoId: string, title: string): string {
  return clip(`${protoId} | ${title}`, 58)
}

export function stageIndex(stage: string): number {
  return IDEA_STAGES.indexOf(stage)
}

// Prototypes: ideas that live in the Factory. Archived ones are rejected.
export const isArchived = (i: Idea): boolean => i.status === 'rejected'

export type NewProto = { title: string; note: string; origin: 'advisor' | 'own'; from: string | null; now: string }

// Allocates the next proto ID (the counter never goes back, even after an archive) and pushes the idea at prevalid.
export function createPrototype(s: Store, p: NewProto): Idea {
  const seq = s.protoSeq + 1
  s.protoSeq = seq
  const abbr = abbrOf(p.title, s.ideas.map(i => i.abbr ?? ''))
  const idea: Idea = {
    id: `${seq}-${Date.parse(p.now).toString(36)}`,
    title: p.title.trim(),
    note: p.note,
    origin: p.origin,
    from: p.from,
    stage: 'prevalid',
    status: 'pending',
    proto_id: protoIdOf(seq, abbr),
    created: p.now,
    updated: p.now,
    history: [{ stage: 'prevalid', at: p.now, status: 'pending' }],
    abbr,
    checks: {},
    askedAt: {},
    scores: [],
    outputs: {},
    gate: {},
  }
  s.ideas.push(idea)
  return idea
}

export function newInbox(title: string, note: string, origin: 'advisor' | 'own', from: string | null, now: string, salt: number): InboxIdea {
  return { id: `in-${Date.parse(now).toString(36)}${salt}`, title: title.trim().slice(0, 120), note, origin, from, created: now }
}

// Moves an inbox idea into the Factory. The legacy chat of a migrated idea travels with it.
export function sendInboxToFactory(s: Store, inboxId: string, now: string): Idea | null {
  const k = s.inbox.findIndex(x => x.id === inboxId)
  const item = s.inbox[k]
  if (!item) return null
  const idea = createPrototype(s, { title: item.title, note: item.note, origin: item.origin, from: item.from, now })
  if (item.chat) idea.chat = item.chat
  if (item.memory) idea.memory = item.memory
  if (item.scan) idea.scan = item.scan
  s.inbox.splice(k, 1)
  return idea
}

// One-time migration of a store saved before 0.7.0. Ideas keep their chat links. Idempotent.
export function migrateStore(s: Store, force = false): Store {
  if (s.migrated070 && !force) return s
  const ordered = [...s.ideas].sort((a, b) => a.created.localeCompare(b.created))
  const keep: Idea[] = []
  const inbox: InboxIdea[] = [...s.inbox]
  // Ideas already migrated (they carry an ABBR) keep their ID; the counter never falls below the highest one in use.
  for (const i of ordered) {
    const m = /^P(\d{3,})-/.exec(i.proto_id ?? '')
    if (i.abbr && m && m[1]) s.protoSeq = Math.max(s.protoSeq, Number(m[1]))
  }
  for (const i of ordered) {
    if (i.abbr) {
      keep.push(ensureProto(i))
      continue
    }
    const rejected = i.status === 'rejected'
    if (!i.proto_id && !rejected) {
      inbox.push({ id: i.id, title: i.title, note: i.note, origin: i.origin, from: i.from, created: i.created, chat: i.chat ?? null, memory: i.memory, scan: i.scan ?? null })
      continue
    }
    const seq = ++s.protoSeq
    const abbr = abbrOf(i.title, keep.map(x => x.abbr ?? ''))
    if (i.proto_id) i.legacyProtoId = i.proto_id
    i.abbr = abbr
    i.proto_id = protoIdOf(seq, abbr)
    i.checks = i.checks ?? {}
    i.askedAt = i.askedAt ?? {}
    i.scores = i.scores ?? []
    i.outputs = i.outputs ?? {}
    i.gate = i.gate ?? {}
    keep.push(i)
  }
  s.ideas = keep
  s.inbox = inbox
  s.migrated070 = true
  return s
}

// Fills the Factory fields an older saved idea lacks, so views never meet undefined.
export function ensureProto(i: Idea): Idea {
  i.checks = i.checks ?? {}
  i.askedAt = i.askedAt ?? {}
  i.requested = i.requested ?? {}
  i.scores = i.scores ?? []
  i.outputs = i.outputs ?? {}
  i.gate = i.gate ?? {}
  i.gateAsked = i.gateAsked ?? {}
  return i
}

export function outputsOf(i: Idea, stage: string): Output[] {
  return i.outputs?.[stage] ?? []
}

export function nextGen(i: Idea, stage: string, kind: string): number {
  return outputsOf(i, stage).filter(o => o.kind === kind).reduce((m, o) => Math.max(m, o.gen), 0) + 1
}

export function latestOf(i: Idea, stage: string, kind?: string): Output | undefined {
  return outputsOf(i, stage).find(o => !kind || o.kind === kind)
}

// A request is pending until an output newer than it arrives.
export function isPending(i: Idea, stage: string): boolean {
  const r = i.requested?.[stage]
  if (!r) return false
  const last = latestOf(i, stage)
  return !last || last.at < r.at
}

const PENDING_WINDOW_MS = 6 * 3600 * 1000

// A request or a gate still waiting for its answer, asked within the last 6 hours (older ones stop the fast sync).
export function anyPending(i: Idea, nowMs: number): boolean {
  const fresh = (at: string | undefined) => !!at && nowMs - Date.parse(at) < PENDING_WINDOW_MS
  if (IDEA_STAGES.some(st => isPending(i, st) && fresh(i.requested?.[st]?.at))) return true
  return Object.keys(i.gateAsked ?? {}).some(st => fresh(i.gateAsked?.[st]) && (!i.gate?.[st] || (i.gate[st]?.at ?? '') < (i.gateAsked?.[st] ?? '')))
}

// After a gate answer arrives: PASS and PASS WITH RISKS advance the prototype on their own, BLOCK waits for Lucas.
export function resolveGates(i: Idea, now: string): boolean {
  const st = i.stage
  const asked = i.gateAsked?.[st]
  const g = i.gate?.[st]
  if (!asked || !g || g.at < asked || g.verdict === 'BLOCK') return false
  delete i.gateAsked![st]
  return advanceIdea(i, now)
}

export function markAsked(i: Idea, stage: string, kind: string, gen: number, skill: SkillRef[], now: string): void {
  ensureProto(i)
  if (i.checks![stage] !== 'done') i.checks![stage] = 'asked'
  i.askedAt![stage] = now
  i.requested![stage] = { kind, gen, at: now, skill } as Requested
  i.updated = now
}

export function markDone(i: Idea, stage: string, now: string): void {
  ensureProto(i)
  i.checks![stage] = 'done'
  i.updated = now
}

export function advanceIdea(i: Idea, now: string): boolean {
  const next = nextStageOf(i.stage)
  if (!next || i.status === 'rejected') return false
  i.stage = next
  i.status = 'pending'
  i.updated = now
  i.history.push({ stage: next, at: now, status: 'pending' })
  return true
}

export function archiveIdea(i: Idea, archived: boolean, now: string): void {
  i.status = archived ? 'rejected' : 'pending'
  i.updated = now
  const last = i.history[i.history.length - 1]
  if (last && last.stage === i.stage) last.status = i.status
}

// Renaming the ABBR renames the proto ID (the number stays). Returns false when the ABBR is empty or taken.
export function renameAbbr(s: Store, ideaId: string, raw: string): boolean {
  const i = s.ideas.find(x => x.id === ideaId)
  const abbr = cleanAbbr(raw)
  if (!i || !abbr) return false
  if (s.ideas.some(x => x.id !== ideaId && x.abbr === abbr)) return false
  const m = /^P(\d{3,})-/.exec(i.proto_id ?? '')
  if (!m || !m[1]) return false
  i.abbr = abbr
  i.proto_id = protoIdOf(Number(m[1]), abbr)
  return true
}

export type ApplyResult = { added: number; scored: boolean; gates: number; truncated: { stage: string; kind: string; gen: number }[] }

const sameContent = (a: string, b: string) => a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim()

// Files what the chat tagged into the prototype. Safe to run on the same transcript again: nothing is added twice.
export function applyParsed(i: Idea, p: Parsed, now: string): ApplyResult {
  ensureProto(i)
  const res: ApplyResult = { added: 0, scored: false, gates: 0, truncated: [] }
  for (const o of p.outputs) {
    if (o.truncated || !o.content) {
      if (o.truncated) res.truncated.push({ stage: o.stage, kind: o.kind, gen: o.gen })
      continue
    }
    const list = i.outputs![o.stage] ?? []
    if (list.some(x => x.kind === o.kind && sameContent(x.content, o.content))) continue
    const req = i.requested![o.stage]
    list.unshift({ at: now, kind: o.kind, gen: o.gen, content: o.content, skill: req && req.kind === o.kind ? req.skill : [], chosen: [], discarded: [] })
    i.outputs![o.stage] = list
    res.added++
    if (DONE_KIND[o.stage] === o.kind) i.checks![o.stage] = 'done'
    if (o.kind === 'refs') i.refs = o.content
  }
  for (const d of p.docs) {
    const kind = DONE_KIND[d.stage] ?? 'brief'
    const list = i.outputs![d.stage] ?? []
    if (list.some(x => x.doc?.url === d.url)) continue
    const target = list.find(x => x.kind === kind && !x.doc)
    if (target) target.doc = { title: d.title, url: d.url }
    else {
      const req = i.requested![d.stage]
      list.unshift({ at: now, kind, gen: nextGen(i, d.stage, kind), content: d.title, skill: req ? req.skill : [], chosen: [], discarded: [], doc: { title: d.title, url: d.url } })
    }
    i.outputs![d.stage] = list
    res.added++
    i.checks![d.stage] = 'done'
  }
  for (const c of p.chosen) {
    const list = i.outputs![c.stage] ?? []
    if (list.length === 0) continue
    if (c.stage === 'titulo') for (const o of list) o.chosen = []
    const holder = list.find(o => o.content.includes(c.text)) ?? list[0]
    if (holder && !holder.chosen.includes(c.text)) holder.chosen.push(c.text)
  }
  for (const raw of p.scores) {
    const entry = parseCriteria(raw, i.stage)
    if (addScores(i.scores!, entry, i.stage, now)) res.scored = true
  }
  for (const g of p.gates) {
    const cur = i.gate![g.stage]
    if (cur && cur.verdict === g.verdict && cur.reason === g.reason) continue
    i.gate![g.stage] = { verdict: g.verdict, reason: g.reason, at: now }
    res.gates++
  }
  return res
}

