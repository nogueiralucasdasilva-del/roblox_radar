// Potential score of a prototype. Pure: the weights come from data/scoring.json, the criteria from the chat.
// The overall percentage is always computed here, never read from the chat.
import type { Confidence, Criterion, EvidenceTag, ScoreEntry } from './model'

export type ScoringConfig = { weights: Record<string, number>; safety_gate: number }

export const DEFAULT_SCORING: ScoringConfig = {
  weights: { demand: 14, timing: 12, whitespace: 12, clickability: 14, virality: 12, social_coplay: 10, core_loop: 8, retention: 8, feasibility: 6, monetization: 4 },
  safety_gate: 40,
}

export const SAFETY = 'safety'

export function parseScoring(raw: unknown): ScoringConfig {
  const o = raw as { weights?: Record<string, unknown>; safety_gate?: unknown } | null
  const weights: Record<string, number> = {}
  if (o && o.weights && typeof o.weights === 'object') {
    for (const [k, v] of Object.entries(o.weights)) if (typeof v === 'number' && v > 0 && k !== SAFETY) weights[k] = v
  }
  if (Object.keys(weights).length === 0) return DEFAULT_SCORING
  return { weights, safety_gate: typeof o?.safety_gate === 'number' ? o.safety_gate : 40 }
}

const CONF: Confidence[] = ['low', 'medium', 'high']
const TAGS: EvidenceTag[] = ['F', 'H', 'V']

// Reads the criteria of an @@SCORES block. Unknown criteria are kept (shown, not weighted); values are clamped to 0..100.
export function parseCriteria(raw: unknown, stage: string): Record<string, Criterion> {
  const out: Record<string, Criterion> = {}
  const src = (raw as { criteria?: Record<string, any> } | null)?.criteria
  if (!src || typeof src !== 'object') return out
  for (const [k, r] of Object.entries(src)) {
    if (!r || typeof r !== 'object' || typeof r.v !== 'number' || !Number.isFinite(r.v)) continue
    out[k] = {
      v: Math.max(0, Math.min(100, Math.round(r.v))),
      c: CONF.includes(r.c) ? r.c : 'low',
      e: typeof r.e === 'string' ? r.e.slice(0, 240) : '',
      t: TAGS.includes(r.t) ? r.t : 'H',
      stage,
    }
  }
  return out
}

// Weighted average over the weighted criteria that have a value. Missing criteria do not count as zero.
export function overall(criteria: Record<string, Criterion>, cfg: ScoringConfig): { pct: number; scored: number; total: number } {
  let sum = 0
  let wsum = 0
  let scored = 0
  for (const [k, w] of Object.entries(cfg.weights)) {
    const c = criteria[k]
    if (!c) continue
    sum += w * c.v
    wsum += w
    scored += 1
  }
  return { pct: wsum > 0 ? Math.round(sum / wsum) : 0, scored, total: Object.keys(cfg.weights).length }
}

export function latestCriteria(history: readonly ScoreEntry[] | undefined): Record<string, Criterion> {
  const h = history ?? []
  return h.length > 0 ? (h[h.length - 1]?.criteria ?? {}) : {}
}

// Overall now, and the change versus the previous stage's entry (null when there is no previous entry).
export function potential(history: readonly ScoreEntry[] | undefined, cfg: ScoringConfig): { pct: number | null; delta: number | null; scored: number; total: number } {
  const h = history ?? []
  if (h.length === 0) return { pct: null, delta: null, scored: 0, total: Object.keys(cfg.weights).length }
  const now = overall(latestCriteria(h), cfg)
  const prev = h.length > 1 ? overall(h[h.length - 2]?.criteria ?? {}, cfg).pct : null
  return { pct: now.pct, delta: prev === null ? null : now.pct - prev, scored: now.scored, total: now.total }
}

export function safetyBlocked(history: readonly ScoreEntry[] | undefined, cfg: ScoringConfig): boolean {
  const c = latestCriteria(history)[SAFETY]
  return !!c && c.v < cfg.safety_gate
}

export function bar(v: number, width = 10): string {
  const n = Math.max(0, Math.min(width, Math.round((v / 100) * width)))
  return '█'.repeat(n) + '░'.repeat(width - n)
}

export function hashScores(c: Record<string, Criterion>): string {
  return Object.keys(c)
    .sort()
    .map(k => `${k}:${c[k]?.v}:${c[k]?.c}`)
    .join('|')
}

// Adds a history entry when the incoming criteria differ from the latest ones. Incoming values win per criterion;
// criteria not mentioned carry forward. Returns true when an entry was added.
export function addScores(history: ScoreEntry[], incoming: Record<string, Criterion>, stage: string, at: string): boolean {
  if (Object.keys(incoming).length === 0) return false
  const merged = { ...latestCriteria(history), ...incoming }
  const h = hashScores(merged)
  if (history.length > 0 && history[history.length - 1]?.h === h) return false
  history.push({ at, stage, criteria: merged, h })
  return true
}
