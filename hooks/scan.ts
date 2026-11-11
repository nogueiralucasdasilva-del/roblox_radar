// The pre-validation scan: reads the key lines of an `@@OUTPUT stage=prevalid kind=scan` block. Pure, never throws.
// The format itself is defined by the Drive skill (prevalid/skill_prevalid_scan.md); this reads what that skill produces.
import { clip } from './model'

export type EvTag = 'F' | 'I' | 'H' | 'V'
export type Tagged = { text: string; tag: EvTag | null }
export type Potential = 'ALTO' | 'MEDIO' | 'BAIXO'
export type Confidence = 'baixa' | 'media' | 'alta'
export type Competitor = { game: string; numbers: string; implication: Tagged; peakPct: number | null; deadClone: boolean }
export type Knockout = { name: string; fix: string | null }

export type Scan = {
  potential: Potential
  reason: Tagged
  noun: string
  verb: string
  wedge: Tagged
  engine: string | null
  works: Tagged
  fails: Tagged
  competitors: Competitor[]
  noKo: boolean
  knockouts: Knockout[]
  confidence: Confidence
  evidence: string
}

export type ScanParse = { ok: boolean; scan?: Scan; errors: string[]; raw: string }

export const REQUIRED_KEYS = ['POTENCIAL', 'NOUN_VERB', 'WEDGE', 'FUNCIONA', 'FALHA', 'CONFIANCA'] as const
const KNOWN_KEYS = [...REQUIRED_KEYS, 'ENGINE', 'CONCORRENTE', 'KO', 'EVIDENCIA']
export const DEAD_CLONE_PCT = 5

const fold = (s: string): string => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()

// A trailing [F], [I], [H] or [V] is an evidence tag, parsed out of the text.
export function splitTag(value: string): Tagged {
  const m = /^(.*?)\s*\[([FIHV])\]\s*$/.exec(value.trim())
  return m && m[1] !== undefined ? { text: m[1].trim(), tag: m[2] as EvTag } : { text: value.trim(), tag: null }
}

const num = (s: string): number | null => {
  const m = /^(\d+(?:[.,]\d+)?)\s*([kKmM]?)$/.exec(s.trim())
  if (!m || !m[1]) return null
  const base = Number(m[1].replace(',', '.'))
  return m[2]?.toLowerCase() === 'k' ? base * 1000 : m[2]?.toLowerCase() === 'm' ? base * 1000000 : base
}

// Players now as a percent of the peak: the "(14%)" the chat wrote, else now divided by peak ("12k agora, pico 85k").
export function peakPercent(numbers: string): number | null {
  const direct = /\((\d+(?:[.,]\d+)?)\s*%\)/.exec(numbers)
  if (direct && direct[1]) return Number(direct[1].replace(',', '.'))
  const now = /(\d+(?:[.,]\d+)?\s*[kKmM]?)\s*(?:agora|jogando|now)/i.exec(numbers)
  const peak = /pico\s*(\d+(?:[.,]\d+)?\s*[kKmM]?)/i.exec(numbers)
  const a = now && now[1] ? num(now[1]) : null
  const b = peak && peak[1] ? num(peak[1]) : null
  return a !== null && b !== null && b > 0 ? Math.round((a / b) * 1000) / 10 : null
}

const parts = (value: string): string[] => value.split(' | ').map(p => p.trim())

export function parseScan(content: string): ScanParse {
  const raw = content.split(String.fromCharCode(13)).join('').split(String.fromCharCode(10)).map(l => l.trimEnd()).join(String.fromCharCode(10))
  try {
    const kv = new Map<string, string[]>()
    for (const line of content.replace(/\r/g, '').split(String.fromCharCode(10))) {
      const m = /^\s*([A-Z_]+)\s*:\s*(.*?)\s*$/.exec(line)
      if (!m || !m[1] || !KNOWN_KEYS.includes(m[1])) continue
      kv.set(m[1], [...(kv.get(m[1]) ?? []), m[2] ?? ''])
    }
    const errors: string[] = []
    const missing = REQUIRED_KEYS.filter(k => !(kv.get(k) ?? []).some(v => v.length > 0))
    if (missing.length > 0) errors.push(`missing ${missing.join(', ')}`)

    const first = (k: string) => (kv.get(k) ?? [])[0] ?? ''
    const pot = parts(first('POTENCIAL'))
    const potential = fold(pot[0] ?? '').toUpperCase()
    if (kv.has('POTENCIAL') && !['ALTO', 'MEDIO', 'BAIXO'].includes(potential)) errors.push('POTENCIAL must be ALTO, MEDIO or BAIXO')
    const conf = fold(first('CONFIANCA')).toLowerCase()
    if (kv.has('CONFIANCA') && !['baixa', 'media', 'alta'].includes(conf)) errors.push('CONFIANCA must be baixa, media or alta')
    if (errors.length > 0) return { ok: false, errors, raw }

    const nv = parts(first('NOUN_VERB'))
    const competitors: Competitor[] = (kv.get('CONCORRENTE') ?? []).slice(0, 3).map(v => {
      const p = parts(v)
      const numbers = p[1] ?? ''
      const pct = peakPercent(numbers)
      return { game: p[0] ?? '', numbers, implication: splitTag(p.slice(2).join(' | ')), peakPct: pct, deadClone: pct !== null && pct < DEAD_CLONE_PCT }
    })
    const koRaw = first('KO')
    const noKo = fold(koRaw).toLowerCase() === 'nenhum' || koRaw === ''
    const knockouts: Knockout[] = noKo
      ? []
      : koRaw.split(' ; ').map(k => {
          const m = /^(.*?)(?:\s*[|,]?\s*fixable by:\s*(.*))?$/i.exec(k.trim())
          return { name: (m?.[1] ?? k).trim(), fix: m?.[2] ? m[2].trim() : null }
        })
    const scan: Scan = {
      potential: potential as Potential,
      reason: splitTag(pot.slice(1).join(' | ')),
      noun: nv[0] ?? '',
      verb: nv[1] ?? '',
      wedge: splitTag(first('WEDGE')),
      engine: first('ENGINE') || null,
      works: splitTag(first('FUNCIONA')),
      fails: splitTag(first('FALHA')),
      competitors,
      noKo,
      knockouts,
      confidence: conf as Confidence,
      evidence: first('EVIDENCIA'),
    }
    return { ok: true, scan, errors: [], raw }
  } catch (err) {
    return { ok: false, errors: [`could not read the block: ${String((err as Error)?.message ?? err).slice(0, 80)}`], raw }
  }
}

// What the 2-page brief request receives so it reuses the evidence: potential, wedge, the main failure and the competitors.
export function scanContext(scan: Scan, max = 600): string {
  const parts = [
    `POTENCIAL ${scan.potential}`,
    `WEDGE ${scan.wedge.text}`,
    `FALHA ${scan.fails.text}`,
    ...scan.competitors.map(c => `CONCORRENTE ${c.game}: ${c.numbers}`),
  ]
  return clip(parts.join('; '), max)
}
