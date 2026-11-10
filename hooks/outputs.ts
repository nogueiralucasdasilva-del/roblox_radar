// Tagged output protocol, chat to panel. Pure parsing, so it can be tested without the app.
//   @@OUTPUT stage=<id> kind=<kind> gen=<n>   ...text...   @@END
//   @@DOC stage=<id> | <title> | <url>
//   @@CHOSEN stage=<id> | <text>
//   @@SCORES {"criteria":{...}}
//   @@GATE stage=<id> verdict=<PASS|PASS WITH RISKS|BLOCK> | <reason>
import type { GateVerdict } from './model'

export const KINDS = ['scan', 'brief', 'refs', 're_packet', 'template_doc', 'fulldoc', 'titles', 'thumb_prompts', 'build_plan', 'launch', 'results']
export const OUTPUT_STAGES = ['prevalid', 'brief', 'template', 'doccompleto', 'build', 'titulo', 'thumb', 'publicar', 'metricas']
// Which output kind completes which stage. refs and re_packet are steps inside the template stage.
export const DONE_KIND: Record<string, string> = {
  prevalid: 'scan',
  brief: 'brief',
  template: 'template_doc',
  doccompleto: 'fulldoc',
  build: 'build_plan',
  titulo: 'titles',
  thumb: 'thumb_prompts',
  publicar: 'launch',
  metricas: 'results',
}

export type ParsedOutput = { stage: string; kind: string; gen: number; content: string; truncated: boolean }
export type Parsed = {
  outputs: ParsedOutput[]
  docs: { stage: string; title: string; url: string }[]
  chosen: { stage: string; text: string }[]
  scores: unknown[]
  gates: { stage: string; verdict: GateVerdict; reason: string }[]
}

const NL = String.fromCharCode(10)

// A transcript may arrive as a JSON string or JSON events with escaped newlines. Turn that into plain text.
export function normalizeTranscript(raw: string): string {
  let t = raw
  const trimmed = t.trim()
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const v = JSON.parse(trimmed)
      if (typeof v === 'string') t = v
    } catch {
      // keep as is
    }
  }
  // A tag that follows an escaped newline means the text is still JSON-escaped.
  if (/\\n\s*@@(OUTPUT|DOC|CHOSEN|SCORES|GATE|END)/.test(t)) {
    t = t.replace(/(?:\\r)?\\n/g, NL).replace(/\\"/g, '"').replace(/\\t/g, '\t')
  }
  return t
}

const kv = (s: string, key: string): string | null => {
  const m = new RegExp(`${key}=("[^"]*"|[^\\s|]+)`).exec(s)
  return m && m[1] ? m[1].replace(/^"|"$/g, '') : null
}

// Tags count only at the start of a line, outside code fences and quote lines, and only with a real stage id and kind.
export function parseTags(raw: string): Parsed {
  const out: Parsed = { outputs: [], docs: [], chosen: [], scores: [], gates: [] }
  const lines = normalizeTranscript(raw).split(NL)
  let fence = false
  let cur: { stage: string; kind: string; gen: number; buf: string[] } | null = null
  const flush = (truncated: boolean) => {
    if (cur) out.outputs.push({ stage: cur.stage, kind: cur.kind, gen: cur.gen, content: cur.buf.join(NL).trim(), truncated })
    cur = null
  }
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      fence = !fence
      if (cur) cur.buf.push(line)
      continue
    }
    if (cur && !fence && /^\s*@@END\b/.test(line)) {
      flush(false)
      continue
    }
    if (cur && !fence && /^\s*@@OUTPUT\s/.test(line)) flush(true)
    if (cur) {
      cur.buf.push(line)
      continue
    }
    if (fence || /^\s*>/.test(line)) continue
    const h = /^\s*@@OUTPUT\s+(.*)$/.exec(line)
    if (h && h[1]) {
      const stage = kv(h[1], 'stage')
      const kind = kv(h[1], 'kind')
      const gen = Number(kv(h[1], 'gen') ?? '1')
      if (stage && kind && OUTPUT_STAGES.includes(stage) && KINDS.includes(kind)) cur = { stage, kind, gen: Number.isFinite(gen) && gen > 0 ? gen : 1, buf: [] }
      continue
    }
    const d = /^\s*@@DOC\s+stage=(\S+)\s*\|\s*(.+?)\s*\|\s*(\S+)\s*$/.exec(line)
    if (d && d[1] && OUTPUT_STAGES.includes(d[1]) && /^https?:\/\//.test(d[3] ?? '')) {
      out.docs.push({ stage: d[1], title: d[2] ?? '', url: d[3] ?? '' })
      continue
    }
    const c = /^\s*@@CHOSEN\s+stage=(\S+)\s*\|\s*(.+?)\s*$/.exec(line)
    if (c && c[1] && OUTPUT_STAGES.includes(c[1])) {
      out.chosen.push({ stage: c[1], text: c[2] ?? '' })
      continue
    }
    const s = /^\s*@@SCORES\s+(\{.*\})\s*$/.exec(line)
    if (s && s[1]) {
      try {
        out.scores.push(JSON.parse(s[1]))
      } catch {
        // a malformed block is ignored
      }
      continue
    }
    const g = /^\s*@@GATE\s+stage=(\S+)\s+verdict=(PASS WITH RISKS|PASS|BLOCK)\s*\|\s*(.*)$/.exec(line)
    if (g && g[1] && OUTPUT_STAGES.includes(g[1])) out.gates.push({ stage: g[1], verdict: g[2] as GateVerdict, reason: (g[3] ?? '').trim() })
  }
  flush(true)
  return out
}

// Splits a generation into its items (titles, thumbnail prompts): numbered or bulleted blocks, else paragraphs.
export function splitItems(content: string): string[] {
  const lines = content.split(NL)
  const starts = lines.map((l, i) => (/^\s*(?:\d+[.)]|[-*])\s+/.test(l) ? i : -1)).filter(i => i >= 0)
  const clean = (s: string) => s.replace(/^\s*(?:\d+[.)]|[-*])\s+/, '').trim()
  if (starts.length >= 2) {
    return starts.map((st, n) => clean(lines.slice(st, starts[n + 1] ?? lines.length).join(NL))).filter(Boolean)
  }
  return content
    .split(/\n\s*\n/)
    .map(s => s.trim())
    .filter(Boolean)
}
