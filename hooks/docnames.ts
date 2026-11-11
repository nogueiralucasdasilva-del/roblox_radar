// Standard document names for everything a prototype saves in Drive. Pure.
//   <proto_id>_<NN>_<kind>_v<gen><suffix>        documents
//   <proto_id>_<NN>_reveng-input_g<gen><suffix>  uploaded input files (batch g, chunk or audit suffix)
import { IDEA_STAGES } from './model'

export const DOC_KINDS = ['scan', 'brief', 'reveng-input', 'reveng-report', 'reveng-merged', 'template-doc', 'template-config', 'fulldoc', 'titles', 'thumb-prompts', 'build-plan', 'launch', 'results'] as const
export type DocKind = (typeof DOC_KINDS)[number]

// 2-digit position of the stage in IDEA_STAGES: prevalid 01 ... metricas 09. Unknown stages give 00.
export function stageNN(stageId: string): string {
  const k = IDEA_STAGES.indexOf(stageId)
  return String(k + 1).padStart(2, '0')
}

export function docName(protoId: string, stageId: string, kind: string, gen: number, suffix = ''): string {
  const tag = kind === 'reveng-input' ? 'g' : 'v'
  return `${protoId}_${stageNN(stageId)}_${kind}_${tag}${gen}${suffix}`
}

export type ParsedName = { protoId: string; nn: string; kind: string; gen: number; suffix: string }

// Reads a standard name back. Returns null for a name that does not follow the pattern.
export function parseDocName(name: string): ParsedName | null {
  const m = /^(P\d{3,}-[A-Z0-9]+)_(\d{2})_([a-z][a-z-]*)_[vg](\d+)(.*)$/.exec(name.trim())
  if (!m || !m[1] || !m[2] || !m[3] || !m[4]) return null
  return { protoId: m[1], nn: m[2], kind: m[3], gen: Number(m[4]), suffix: m[5] ?? '' }
}

export function kindOfName(name: string): string | null {
  const p = parseDocName(name)
  return p && (DOC_KINDS as readonly string[]).includes(p.kind) ? p.kind : null
}

// The Drive file id inside a Docs, Drive file or folder url.
export function fileIdOf(url: string): string | null {
  const m = /\/(?:d|folders)\/([A-Za-z0-9_-]{10,})/.exec(url) ?? /[?&]id=([A-Za-z0-9_-]{10,})/.exec(url)
  return m && m[1] ? m[1] : null
}

// What a stage produces when a request does not say otherwise. Used for the name the chat must use.
export const DEFAULT_DOC_KIND: Record<string, DocKind> = {
  prevalid: 'scan',
  brief: 'brief',
  template: 'template-doc',
  doccompleto: 'fulldoc',
  build: 'build-plan',
  titulo: 'titles',
  thumb: 'thumb-prompts',
  publicar: 'launch',
  metricas: 'results',
}

// Whether two document names are the same (a Drive copy may add a trailing extension or a space).
export function docNameMatches(a: string, b: string): boolean {
  const norm = (t: string) => t.trim().replace(/\.(json|txt|md)$/i, '')
  return norm(a) === norm(b)
}

export const isStandardName = (name: string): boolean => parseDocName(name.trim().replace(/\.(json|txt|md)$/i, '')) !== null
