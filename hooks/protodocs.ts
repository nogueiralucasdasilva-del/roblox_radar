// The two standing documents of a prototype (status and potential) and the standard prompts. Pure: no host calls here.
// The chat keeps both documents up to date in Drive; the panel only reads them. See seed/_all/template_*_doc.md.
import { fileIdOf, kindOfName } from './docnames'
import type { Criterion, Idea } from './model'
import { addScores, parseCriteria } from './scoring'

export const STATUS_STAGES = ['prevalid', 'brief', 'template', 'titulo', 'thumb', 'doccompleto', 'build', 'publicar', 'metricas'] as const
export const STAGE_LABELS: Record<string, string> = {
  prevalid: 'Pre-validation',
  brief: '2-page brief',
  template: 'Reverse engineering',
  titulo: 'Title',
  thumb: 'Thumbnail',
  doccompleto: 'Full doc',
  build: 'Build',
  publicar: 'Publish and traffic',
  metricas: 'Metrics and learning',
}
export type StatusName = 'not started' | 'asked' | 'done' | 'failed'
export type StatusRow = { status: StatusName; doc: string | null; url: string | null; updated: string | null }
export type ParsedStatus = { chat: string | null; folder: string | null; current: string | null; rows: Record<string, StatusRow>; ok: boolean }
export type ParsedPotential = { label: 'HIGH' | 'MEDIUM' | 'LOW' | null; pct: number | null; confidence: string | null; criteria: Record<string, Criterion>; ok: boolean }

export const docNameFor = (protoId: string, which: 'status' | 'potential'): string => `${protoId}_00_${which}`

// The first text of both documents, written when the prototype is created. Same layout as the Drive templates.
export function statusDocText(protoId: string, idea: string, folderUrl: string | null, chatLink: string | null, now: string): string {
  const rows = STATUS_STAGES.map((s, n) => `${n + 1} ${STAGE_LABELS[s]!.padEnd(22)} not started`)
  return [
    `STATUS | ${protoId} | ${idea} | updated ${now.slice(0, 16).replace('T', ' ')}`,
    '',
    `IDEA: ${idea}`,
    `CHAT: ${chatLink ?? 'not linked yet'}`,
    `FOLDER: ${folderUrl ?? 'not created yet'}`,
    `CURRENT STAGE: ${STAGE_LABELS.prevalid}`,
    '',
    'STAGE                  STATUS       DOCUMENT       UPDATED',
    ...rows,
    '',
    'DECISIONS: none yet',
    'OPEN QUESTIONS: none',
    '',
  ].join(String.fromCharCode(10))
}

export function potentialDocText(protoId: string, idea: string, now: string): string {
  return [
    `POTENTIAL | ${protoId} | ${idea} | updated ${now.slice(0, 10)}`,
    '',
    'POTENTIAL: not assessed yet',
    'CONFIDENCE: not assessed yet',
    'SET BY: nothing yet',
    '',
    'Not assessed: all criteria',
    '',
    'HISTORY (newest first):',
    '',
  ].join(String.fromCharCode(10))
}

const lines = (t: string): string[] => t.split(String.fromCharCode(13)).join('').split(String.fromCharCode(10))
const STATUS_WORDS: [RegExp, StatusName][] = [
  [/\bnot started\b/i, 'not started'],
  [/\basked\b/i, 'asked'],
  [/\bdone\b/i, 'done'],
  [/\bfailed\b/i, 'failed'],
]
const DOC_NAME = /P\d{3,}-[A-Z0-9]+_\d{2}_[a-z-]+_v\d+/
const URL = /https?:\/\/[^\s)>\]]+/

// Reads the status document. Never throws; ok is false when no stage row was found.
export function parseStatus(text: string): ParsedStatus {
  const out: ParsedStatus = { chat: null, folder: null, current: null, rows: {}, ok: false }
  try {
    for (const raw of lines(text)) {
      const line = raw.trim()
      let m = /^CHAT:\s*(\S.*)$/i.exec(line)
      if (m && m[1]) out.chat = URL.exec(m[1])?.[0] ?? null
      m = /^FOLDER:\s*(\S.*)$/i.exec(line)
      if (m && m[1]) out.folder = URL.exec(m[1])?.[0] ?? null
      m = /^CURRENT STAGE:\s*(\S.*)$/i.exec(line)
      if (m && m[1]) out.current = m[1].trim()
      const row = /^(\d)\s+(.*)$/.exec(line)
      if (!row || !row[1] || !row[2]) continue
      const id = STATUS_STAGES[Number(row[1]) - 1]
      if (!id || !row[2].toLowerCase().startsWith(STAGE_LABELS[id]!.toLowerCase().slice(0, 8))) continue
      const rest = row[2].slice(STAGE_LABELS[id]!.length)
      const status = STATUS_WORDS.find(([re]) => re.test(rest))?.[1] ?? 'not started'
      out.rows[id] = {
        status,
        doc: DOC_NAME.exec(rest)?.[0] ?? null,
        url: URL.exec(rest)?.[0] ?? null,
        updated: /\d{4}-\d{2}-\d{2}/.exec(rest)?.[0] ?? null,
      }
    }
    out.ok = Object.keys(out.rows).length > 0
  } catch {
    out.ok = false
  }
  return out
}

const CRITERIA_LABELS: [RegExp, string][] = [
  [/^emerging demand/i, 'demand'],
  [/^timing/i, 'timing'],
  [/^competition/i, 'whitespace'],
  [/^clickability/i, 'clickability'],
  [/^virality/i, 'virality'],
  [/^co-?play/i, 'social_coplay'],
  [/^feasibility/i, 'feasibility'],
  [/^safety/i, 'safety'],
]

// Reads the potential document (or the criteria table of a Pre-validation document, which has the same lines).
export function parsePotential(text: string): ParsedPotential {
  const out: ParsedPotential = { label: null, pct: null, confidence: null, criteria: {}, ok: false }
  try {
    const raw: Record<string, { v: number; c: string; e: string; t: string }> = {}
    for (const l of lines(text)) {
      const line = l.trim()
      const head = /^POTENTIAL:\s*(HIGH|MEDIUM|LOW)\b.*?(\d{1,3})\s*%/i.exec(line)
      if (head && head[1] && head[2]) {
        out.label = head[1].toUpperCase() as 'HIGH' | 'MEDIUM' | 'LOW'
        out.pct = Math.min(100, Number(head[2]))
      }
      const conf = /^CONFIDENCE:\s*(low|medium|high)\b/i.exec(line)
      if (conf && conf[1]) out.confidence = conf[1].toLowerCase()
      const hit = CRITERIA_LABELS.find(([re]) => re.test(line))
      if (!hit) continue
      const m = /\s(\d{1,3})\s+(low|medium|high)\s+(.*)$/i.exec(line)
      if (!m || !m[1] || !m[2]) continue
      const tagm = /\[([FIHV])\]\s*$/.exec(m[3] ?? '')
      raw[hit[1]] = { v: Math.min(100, Number(m[1])), c: m[2].toLowerCase(), e: (m[3] ?? '').replace(/\s*\[[FIHV]\]\s*$/, '').slice(0, 160), t: tagm?.[1] === 'F' ? 'F' : tagm?.[1] === 'V' ? 'V' : 'H' }
    }
    out.criteria = parseCriteria({ criteria: raw }, 'prevalid')
    out.ok = out.label !== null || Object.keys(out.criteria).length > 0
  } catch {
    out.ok = false
  }
  return out
}

// The next generation number for a stage: one more than the highest vN in the row's document name.
export function nextGen(row: StatusRow | undefined): number {
  const m = row?.doc ? /_v(\d+)$/.exec(row.doc) : null
  return m && m[1] ? Number(m[1]) + 1 : 1
}

// Fills {{name}} placeholders. A placeholder with no value is left visible as <name>, so a missing link is never silent.
export function fillPrompt(template: string, vars: Record<string, string | number | undefined>): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_m, k: string) => {
    const v = vars[k]
    return v === undefined || v === '' ? `<${k}>` : String(v)
  })
}

// The Drive file name of the standard prompt of a stage (and the second prompt of Reverse engineering).
export const PROMPT_FILES: Record<string, string[]> = {
  prevalid: ['prompt_prevalid.md'],
  brief: ['prompt_brief.md'],
  template: ['prompt_reveng_validate.md'],
  titulo: ['prompt_titulo.md'],
  thumb: ['prompt_thumb.md'],
  doccompleto: ['prompt_fulldoc.md'],
  build: ['prompt_build.md'],
  publicar: ['prompt_launch.md'],
  metricas: ['prompt_results.md'],
}

// Copies what the chat wrote in the two documents onto the prototype: statuses and document links of each stage, the current
// stage, and the potential scores. The Drive documents are the source of truth; nothing here talks to the host.
export function applyProtoDocs(i: Idea, status: ParsedStatus | undefined, potential: ParsedPotential | undefined, now: string): void {
  if (status?.ok) {
    i.checks = i.checks ?? {}
    i.docs = i.docs ?? {}
    for (const stage of STATUS_STAGES) {
      const row = status.rows[stage]
      if (!row) continue
      if (row.status === 'done') i.checks[stage] = 'done'
      else if (row.status === 'asked') i.checks[stage] = 'asked'
      else delete i.checks[stage]
      if (row.status === 'failed') {
        i.failed = i.failed ?? {}
        i.failed[stage] = { reason: 'The status document marks this stage as failed.', at: now }
      } else if (i.failed) delete i.failed[stage]
      if (row.doc && row.url) {
        const list = i.docs[stage] ?? []
        const hit = list.find(d => d.name === row.doc)
        const gen = Number(/_v(\d+)$/.exec(row.doc)?.[1] ?? 1)
        if (hit) hit.url = row.url
        else list.unshift({ name: row.doc, url: row.url, fileId: fileIdOf(row.url), at: now, gen, kind: kindOfName(row.doc) ?? 'doc' })
        i.docs[stage] = list
      }
    }
    const cur = status.current ? STATUS_STAGES.find(s => STAGE_LABELS[s]!.toLowerCase() === status.current!.toLowerCase()) : undefined
    if (cur) i.stage = cur
    if (status.chat && !i.chat) i.chat = { id: status.chat, title: `${i.proto_id} | ${i.title}`, link: status.chat, at: now, syncedAt: null, seen: 0 }
  }
  if (potential?.ok && Object.keys(potential.criteria).length > 0) {
    i.scores = i.scores ?? []
    addScores(i.scores, potential.criteria, i.stage, now)
  }
}
