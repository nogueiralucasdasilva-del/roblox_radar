// Classifying and numbering the extraction files Lucas uploads. Pure: it works on file names and text, never on disk.
import { docName } from './docnames'

export const MAX_FILE_BYTES = 2 * 1024 * 1024

export type LenientResult = { ok: true; value: unknown } | { ok: false; error: string }

// Characters a Markdown export may escape with a backslash. JSON's own escapes (quote, backslash, slash, b f n r t u) are left alone.
const MD_ESCAPED = /\\([_\[\]*#`{}()<>~|+.!-])/g

// Loads JSON the way a Google Doc export or a chat paste leaves it: code fences, a BOM, Markdown escapes, text around the JSON.
export function lenientParse(raw: string): LenientResult {
  let t = raw.replace(/^﻿/, '').trim()
  const fence = /```[a-zA-Z]*\s*([\s\S]*?)```/.exec(t)
  if (fence && fence[1] && fence[1].trim()) t = fence[1].trim()
  else t = t.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '').trim()
  const attempts = [t, t.replace(MD_ESCAPED, '$1')]
  for (const a of attempts) {
    try {
      return { ok: true, value: JSON.parse(a) }
    } catch {
      // try the next form
    }
  }
  const cleaned = attempts[1] ?? t
  const open = Math.min(...['{', '['].map(c => cleaned.indexOf(c)).filter(k => k >= 0))
  const close = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'))
  if (Number.isFinite(open) && close > open) {
    try {
      return { ok: true, value: JSON.parse(cleaned.slice(open, close + 1)) }
    } catch {
      // fall through
    }
  }
  return { ok: false, error: 'not valid JSON' }
}

export type FileKind = 'chunk' | 'audit' | 'unknown'

// The last number in the file name before the extension: chunk_02.json gives 2.
export function numberFromName(name: string): number | null {
  const stem = name.replace(/\.[A-Za-z0-9]+$/, '')
  const all = stem.match(/\d+/g)
  const last = all ? all[all.length - 1] : undefined
  return last ? Number(last) : null
}

export function classify(name: string, value: unknown): { kind: FileKind; index: number | null } {
  const lower = name.toLowerCase()
  if (Array.isArray(value)) {
    const looksAudit = value.length > 0 && value.every(x => x && typeof x === 'object' && 'verdict' in (x as object))
    if (looksAudit || lower.includes('audit')) return { kind: 'audit', index: numberFromName(name) }
    return { kind: 'unknown', index: null }
  }
  if (value && typeof value === 'object') {
    const seg = (value as { segment?: { index?: unknown } }).segment
    if (seg && typeof seg === 'object') {
      const idx = Number((seg as { index?: unknown }).index)
      return { kind: lower.includes('audit') ? 'audit' : 'chunk', index: Number.isFinite(idx) && idx > 0 ? idx : numberFromName(name) }
    }
  }
  return { kind: 'unknown', index: null }
}

export type RawFile = { path: string; name: string; bytes: number; text: string }
export type PlannedFile = { path: string; name: string; kind: 'chunk' | 'audit'; index: number; stdName: string; text: string }
export type UploadPlan = { accepted: PlannedFile[]; rejected: { name: string; reason: string }[] }

// Splits the path box into paths: newlines or semicolons, quotes stripped, empty entries dropped.
export function splitPaths(raw: string): string[] {
  return raw
    .split(/[\n;]+/)
    .map(p => p.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean)
}

export function expandHome(p: string, home: string): string {
  return p === '~' ? home : p.startsWith('~/') || p.startsWith('~\\') ? `${home}${p.slice(1)}` : p
}

// Decides what to upload: classifies, numbers (segment index, then the number in the name, then sorted order),
// gives the standard name for the batch, and lists what was rejected and why.
export function planUpload(protoId: string, gen: number, files: RawFile[]): UploadPlan {
  const accepted: PlannedFile[] = []
  const rejected: { name: string; reason: string }[] = []
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name))
  const seen = new Set<string>()
  let order = { chunk: 0, audit: 0 }
  for (const f of sorted) {
    if (!/\.json$/i.test(f.name) && !/\.txt$/i.test(f.name)) {
      rejected.push({ name: f.name, reason: 'not a .json file' })
      continue
    }
    if (f.bytes > MAX_FILE_BYTES) {
      rejected.push({ name: f.name, reason: 'larger than 2 MB' })
      continue
    }
    const parsed = lenientParse(f.text)
    if (!parsed.ok) {
      rejected.push({ name: f.name, reason: parsed.error })
      continue
    }
    const c = classify(f.name, parsed.value)
    if (c.kind === 'unknown') {
      rejected.push({ name: f.name, reason: 'not a chunk (no segment) and not an audit (no verdicts)' })
      continue
    }
    order = { ...order, [c.kind]: order[c.kind] + 1 }
    const index = c.index ?? order[c.kind]
    const key = `${c.kind}:${index}`
    if (seen.has(key)) {
      rejected.push({ name: f.name, reason: `another ${c.kind} for segment ${index} is already in this batch` })
      continue
    }
    seen.add(key)
    const suffix = `_${c.kind}${String(index).padStart(2, '0')}.json`
    accepted.push({ path: f.path, name: f.name, kind: c.kind, index, stdName: docName(protoId, 'template', 'reveng-input', gen, suffix), text: f.text })
  }
  accepted.sort((a, b) => (a.kind === b.kind ? a.index - b.index : a.kind === 'chunk' ? -1 : 1))
  return { accepted, rejected }
}

export function summarizePlan(plan: UploadPlan, gen: number): string {
  const chunks = plan.accepted.filter(f => f.kind === 'chunk').length
  const audits = plan.accepted.filter(f => f.kind === 'audit').length
  const parts = [`${chunks} chunk${chunks === 1 ? '' : 's'}`]
  if (audits > 0) parts.push(`${audits} audit${audits === 1 ? '' : 's'}`)
  return `Uploaded ${parts.join(', ')}, batch ${gen}`
}
