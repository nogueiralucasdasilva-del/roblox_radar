import type { Report, ReportsFile, Source, SourceStatus, SourcesFile } from '../types'

// Every scheduled task ends its run by writing one small receipt (a Google Doc holding one JSON object)
// into this Drive folder. The panel reads those receipts to show what really happened, as it happened.
export const RECEIPT_FOLDER_ID = '1RA7Wma0p6NoN_YvwZBTPPJkzz-V2QL9p'
export const RECEIPT_DAYS = 8
export const LATE_MS = 2 * 60 * 60 * 1000

export type RItem = { name: string; status: string; rows: number | null; note: string }
export type RReportItem = { name: string; note: string; flags: string[] }
export type RReport = { date: string; kind: string; title: string; channel: string; sections: { title: string; items: RReportItem[] }[] }
export type ROutput = { kind: string; name: string; ref: string | null }
export type Outcome = 'ok' | 'attention' | 'failed' | 'partial'
export type Receipt = {
  fileId: string
  task_key: string
  stage: string
  run_id: string
  started_utc: string | null
  finished_utc: string
  outcome: Outcome
  summary: string
  counts: Record<string, number | null>
  items: RItem[]
  report: RReport | null
  outputs: ROutput[]
  problems: string[]
  next_run_utc: string | null
}

const OUTCOMES: Outcome[] = ['ok', 'attention', 'failed', 'partial']

const str = (v: unknown, max = 600): string => (typeof v === 'string' ? v.slice(0, max) : '')
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
const isIso = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v))

// A Google Doc read does not return the doc body alone. The Drive connector wraps it as
// {"fileContent": "...", "title": ..., "viewUrl": ...}, and the doc text is Markdown, so punctuation
// comes back escaped (receipt\_version, \[ \], \#, \!). Undo both before parsing the JSON.
const MD_ESCAPED = /\\([\\_\[\]#!*()<>\-.+|~`{}=&])/g

export function unwrapDoc(text: string): string {
  let body = text
  const a = body.indexOf('{')
  const b = body.lastIndexOf('}')
  if (a >= 0 && b > a) {
    try {
      const env = JSON.parse(body.slice(a, b + 1))
      if (env && typeof env === 'object' && typeof env.fileContent === 'string') body = env.fileContent
    } catch {
      // Not an envelope: the text is the doc body itself.
    }
  }
  return body.replace(MD_ESCAPED, '$1')
}

// First JSON object found in a text: a Google Doc read may add a title or whitespace around the body.
export function jsonOf(text: string): any {
  const a = text.indexOf('{')
  const b = text.lastIndexOf('}')
  if (a < 0 || b <= a) throw new Error('no JSON object')
  const raw = text.slice(a, b + 1)
  try {
    return JSON.parse(raw)
  } catch {
    // Some converters turn straight quotes into curly ones.
    return JSON.parse(raw.replace(/[“”]/g, '"').replace(/[‘’]/g, "'"))
  }
}

export function parseReceipt(text: string, fileId: string): Receipt | null {
  let o: any
  try {
    o = jsonOf(unwrapDoc(text))
  } catch {
    return null
  }
  if (!o || typeof o !== 'object') return null
  if (Number(o.receipt_version) !== 1) return null
  if (typeof o.task_key !== 'string' || typeof o.run_id !== 'string' || !isIso(o.finished_utc)) return null
  const outcome = OUTCOMES.find(x => x === o.outcome)
  if (!outcome) return null
  const items: RItem[] = (Array.isArray(o.items) ? o.items : [])
    .filter((x: any) => x && typeof x.name === 'string')
    .slice(0, 80)
    .map((x: any) => ({
      name: str(x.name, 80),
      status: str(x.status, 30).toLowerCase(),
      rows: typeof x.rows === 'number' ? x.rows : null,
      note: str(x.note, 200),
    }))
  let report: RReport | null = null
  const rp = o.report
  if (rp && typeof rp === 'object' && Array.isArray(rp.sections)) {
    report = {
      date: str(rp.date, 10) || String(o.finished_utc).slice(0, 10),
      kind: str(rp.kind, 20) || 'themes',
      title: str(rp.title, 120),
      channel: str(rp.channel, 60),
      sections: rp.sections
        .filter((s: any) => s && typeof s.title === 'string' && Array.isArray(s.items))
        .slice(0, 12)
        .map((s: any) => ({
          title: str(s.title, 80),
          items: s.items
            .filter((i: any) => i && typeof i.name === 'string')
            .slice(0, 40)
            .map((i: any) => ({
              name: str(i.name, 120),
              note: str(i.note, 400),
              flags: (Array.isArray(i.flags) ? i.flags : []).filter((f: any) => typeof f === 'string').slice(0, 8).map((f: string) => f.slice(0, 40)),
            })),
        })),
    }
  }
  const counts: Record<string, number | null> = {}
  if (o.counts && typeof o.counts === 'object') {
    for (const [k, v] of Object.entries(o.counts)) {
      if (typeof v === 'number' || v === null) counts[k.slice(0, 40)] = v as number | null
    }
  }
  return {
    fileId,
    task_key: o.task_key.slice(0, 40),
    stage: str(o.stage, 30),
    run_id: o.run_id.slice(0, 80),
    started_utc: isIso(o.started_utc) ? o.started_utc : null,
    finished_utc: o.finished_utc,
    outcome,
    summary: str(o.summary, 400),
    counts,
    items,
    report,
    outputs: (Array.isArray(o.outputs) ? o.outputs : [])
      .filter((x: any) => x && typeof x === 'object')
      .slice(0, 20)
      .map((x: any) => ({ kind: str(x.kind, 20), name: str(x.name, 120), ref: strOrNull(x.ref) })),
    problems: (Array.isArray(o.problems) ? o.problems : []).filter((p: any) => typeof p === 'string').slice(0, 30).map((p: string) => p.slice(0, 240)),
    next_run_utc: isIso(o.next_run_utc) ? o.next_run_utc : null,
  }
}

// Which pipeline stages a task's receipts belong to. Status tasks report on a phase, not on one stage.
const TASK_STAGES: Record<string, string[]> = {
  free_scout: ['coleta'],
  coleta: ['coleta'],
  advisor: ['triagem'],
  thumbnails: ['triagem'],
  status_fase_1: ['coleta', 'triagem'],
  status_fase_2: ['prevalid'],
}

export function stagesOf(r: Receipt): string[] {
  return TASK_STAGES[r.task_key] ?? (r.stage && r.stage !== 'status' ? [r.stage] : [])
}

export const STAGES_WITH_RECEIPTS = ['coleta', 'triagem', 'prevalid', 'auditor']

export function receiptsFor(list: readonly Receipt[], stageId: string): Receipt[] {
  return list.filter(r => stagesOf(r).includes(stageId)).sort((a, b) => b.finished_utc.localeCompare(a.finished_utc))
}

// Newest receipt of each task.
export function latestPerTask(list: readonly Receipt[]): Receipt[] {
  const by = new Map<string, Receipt>()
  for (const r of list) {
    const cur = by.get(r.task_key)
    if (!cur || r.finished_utc > cur.finished_utc) by.set(r.task_key, r)
  }
  return [...by.values()]
}

export function isLate(r: Receipt, nowMs: number): boolean {
  return r.next_run_utc !== null && nowMs > Date.parse(r.next_run_utc) + LATE_MS
}

// Health of a stage from its tasks' newest receipts: 0 ok, 1 attention, 2 error.
export function stageHealth(list: readonly Receipt[], stageId: string, nowMs: number): { level: number; lines: string[]; last: Receipt | null } {
  const latest = latestPerTask(receiptsFor(list, stageId))
  let level = 0
  const lines: string[] = []
  let last: Receipt | null = null
  for (const r of latest.sort((a, b) => b.finished_utc.localeCompare(a.finished_utc))) {
    if (!last) last = r
    if (r.outcome === 'failed') level = Math.max(level, 2)
    else if (r.outcome !== 'ok') level = Math.max(level, 1)
    const late = isLate(r, nowMs)
    if (late) level = Math.max(level, 1)
    lines.push(`${r.task_key}: ${r.outcome} at ${r.finished_utc.slice(0, 16).replace('T', ' ')} UTC${late ? `, no receipt since the expected ${String(r.next_run_utc).slice(0, 16).replace('T', ' ')} UTC` : ''}`)
  }
  return { level, lines, last }
}

/* ---------- collection receipt to the Sources tab ---------- */

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')

export function sourceStatusOf(word: string): SourceStatus {
  if (word === 'ok') return 'working'
  if (word === 'stale') return 'stale'
  if (word === 'degraded' || word === 'degraded_size') return 'attention'
  if (word === 'dead' || word === 'missing' || word === 'failed') return 'broken'
  return 'unknown'
}

const when = (iso: string): string => `${iso.slice(0, 16).replace('T', ' ')} UTC`

// Live sources from the newest collection receipt; family and cadence come from the snapshot when the names match.
export function sourcesFromReceipt(r: Receipt | null, snap: SourcesFile | null): SourcesFile | null {
  if (!r || r.items.length === 0) return null
  const base = new Map<string, Source>()
  for (const s of snap?.sources ?? []) base.set(norm(s.name), s)
  const sources: Source[] = r.items.map((it, i) => {
    const b = base.get(norm(it.name))
    const rows = it.rows !== null ? `${it.rows} rows. ` : ''
    return {
      id: `live-${i}-${norm(it.name)}`,
      name: b?.name ?? it.name,
      family: b?.family ?? 'collection leg',
      cadence: b?.cadence ?? 'daily',
      status: sourceStatusOf(it.status),
      collected_label: when(r.finished_utc),
      collected_at: r.finished_utc,
      note: `${rows}${it.note}`.trim(),
      evidence: `receipt ${r.run_id}`,
    }
  })
  return {
    asof: r.finished_utc,
    origin: `Live from receipt ${r.run_id}, written by the collection task when it finished (${when(r.finished_utc)}). The status word is the one the task logged for each leg.`,
    summary: r.summary || `${sources.length} legs in the last collection receipt.`,
    sources,
  }
}

/* ---------- advisor and thumbnail receipts to the Reports tab ---------- */

function verdictOf(kind: string, sectionTitle: string): string {
  if (kind === 'hooks' || kind === 'alert') return 'HOOK'
  const t = sectionTitle.toLowerCase()
  if (t.startsWith('pass')) return 'PASS'
  if (t.startsWith('reject')) return 'REJECT'
  if (t.startsWith('maybe') || t.startsWith('inside')) return 'MAYBE'
  return 'MAYBE'
}

export function reportsFromReceipts(list: readonly Receipt[]): Report[] {
  const out: Report[] = []
  for (const r of list) {
    const rp = r.report
    if (!rp || rp.sections.length === 0) continue
    const kind: Report['kind'] = rp.kind === 'themes' ? 'themes' : 'hooks'
    out.push({
      id: r.run_id,
      date: rp.date,
      kind,
      title: rp.title || (kind === 'themes' ? 'Themes report' : 'Hooks report'),
      channel: rp.channel,
      posted: when(r.finished_utc),
      summary: r.summary,
      sections: rp.sections.map(s => ({
        name: s.title,
        items: s.items.map(i => ({
          title: i.name,
          verdict: verdictOf(rp.kind, s.title),
          note: i.note,
          ip: i.flags.some(f => /third.?party.?ip/i.test(f)),
        })),
      })),
    })
  }
  return out
}

// Live reports first. A snapshot report stays only when no live report covers the same date and kind.
export function mergeReports(live: readonly Report[], snap: ReportsFile | null): ReportsFile | null {
  if (live.length === 0) return snap
  const seen = new Set(live.map(r => `${r.date}|${r.kind}`))
  const old = (snap?.reports ?? []).filter(r => !seen.has(`${r.date}|${r.kind}`))
  return {
    asof: new Date().toISOString(),
    origin: `${live.length} report${live.length === 1 ? '' : 's'} read live from advisor receipts, plus ${old.length} older from the snapshot${snap ? ` (${snap.asof.slice(0, 10)})` : ''}.`,
    reports: [...live, ...old],
  }
}
