// Tagged output protocol, chat to panel. Pure parsing, so it can be tested without the app.
//   @@OUTPUT stage=<id> kind=<kind> gen=<n>   ...text...   @@END
//   @@DOC stage=<id> | <title> | <url>
//   @@CHOSEN stage=<id> | <text>
//   @@SCORES {"criteria":{...}}
//   @@GATE stage=<id> verdict=<PASS|PASS WITH RISKS|BLOCK> | <reason>
//   @@REFS stage=<id> | <JSON array of reference candidates>
//   @@VERDICT stage=<id> kind=<kind> verdict=<PASS|PASS WITH GAPS|FAIL> | <reason>
//   @@FAIL stage=<id> | <what failed>
import type { GateVerdict, RefCandidate } from './model'

export const KINDS = ['scan', 'brief', 'refs', 're_packet', 'reveng_validation', 'template_doc', 'fulldoc', 'titles', 'thumb_prompts', 'build_plan', 'launch', 'results']
export const OUTPUT_STAGES = ['prevalid', 'brief', 'template', 'doccompleto', 'build', 'titulo', 'thumb', 'publicar', 'metricas']
// Which output kind completes which stage. refs and re_packet are steps inside the template stage.
export const DONE_KIND: Record<string, string> = {
  prevalid: 'scan',
  brief: 'brief',
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
  refs: { stage: string; items: RefCandidate[] }[]
  verdicts: { stage: string; kind: string; verdict: 'PASS' | 'PASS WITH GAPS' | 'FAIL'; reason: string; pos: number }[]
  fails: { stage: string; reason: string; pos: number }[]
  // Where the panel's own requests start in the transcript, so a verdict or failure counts only after its request.
  headers: { action: string; gen: number; pos: number }[]
}

const NL = String.fromCharCode(10)

// A transcript may arrive as a JSON string or JSON events with escaped newlines. Turn that into plain text.
export function normalizeTranscript(raw: string): string {
  let t = raw.replace(/\r\n/g, NL)
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

// The first balanced {...} of a text, respecting strings.
function balancedObject(text: string): string | null {
  let depth = 0
  let inStr = false
  for (let k = 0; k < text.length; k++) {
    const c = text[k]
    if (inStr) {
      if (c === '\\') k++
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === '{') depth++
    else if (c === '}' && --depth === 0) return text.slice(0, k + 1)
  }
  return null
}

const REF_KEYS = ['name', 'url', 'universe_id', 'visits', 'approval_pct', 'ccu', 'as_of', 'why_fit', 'risk', 'tag'] as const

// The JSON array of an @@REFS tag. Tolerates missing keys and numbers where text is expected; drops entries without a name.
export function parseRefs(text: string): RefCandidate[] | null {
  let v: unknown
  try {
    v = JSON.parse(text.trim())
  } catch {
    return null
  }
  if (!Array.isArray(v)) return null
  const out: RefCandidate[] = []
  for (const x of v) {
    if (!x || typeof x !== 'object') continue
    const rec = x as Record<string, unknown>
    if (typeof rec.name !== 'string' || !rec.name.trim()) continue
    const c: RefCandidate = { name: rec.name.trim() }
    for (const k of REF_KEYS) {
      if (k === 'name') continue
      const val = rec[k]
      if (typeof val === 'string' && val.trim()) c[k] = val.trim()
      else if (typeof val === 'number' && Number.isFinite(val)) c[k] = String(val)
    }
    out.push(c)
  }
  return out
}

// Tags count only at the start of a line, outside code fences and quote lines, and only with a real stage id and kind.
export function parseTags(raw: string): Parsed {
  const out: Parsed = { outputs: [], docs: [], chosen: [], scores: [], gates: [], refs: [], verdicts: [], fails: [], headers: [] }
  const lines = normalizeTranscript(raw).split(NL)
  let cur: { stage: string; kind: string; gen: number; buf: string[] } | null = null
  const flush = (truncated: boolean) => {
    if (cur) out.outputs.push({ stage: cur.stage, kind: cur.kind, gen: cur.gen, content: cur.buf.join(NL).trim(), truncated })
    cur = null
  }
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li] as string
    const hm = /Action:\s.*\(([A-Za-z0-9_]+)\)\.\s*Generation:\s*(\d+)\./.exec(line)
    if (hm && hm[1]) out.headers.push({ action: hm[1], gen: Number(hm[2]), pos: li })
    // A code fence line is not content and not a tag: tags inside a fence are read like any other (the chat sometimes fences them).
    if (/^\s*```/.test(line)) continue
    if (cur && /^\s*@@END\b/.test(line)) {
      flush(false)
      continue
    }
    if (cur && /^\s*@@OUTPUT\s/.test(line)) flush(true)
    if (cur) {
      cur.buf.push(line)
      continue
    }
    if (/^\s*>/.test(line)) continue
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
    const sc = /^\s*@@SCORES\s+(\{.*)$/.exec(line)
    if (sc && sc[1]) {
      // The JSON object ends where its braces balance, so text after it (a JSON-wrapped transcript) does not matter.
      const obj = balancedObject(sc[1])
      if (obj) {
        try {
          out.scores.push(JSON.parse(obj))
        } catch {
          // a malformed block is ignored
        }
      }
      continue
    }
    const rf = /^\s*@@REFS\s+stage=(\S+)\s*\|\s*(.*)$/.exec(line)
    if (rf && rf[1] && OUTPUT_STAGES.includes(rf[1])) {
      // The JSON normally sits on one line; accept it spread over a few lines until it parses.
      let buf = rf[2] ?? ''
      let items = parseRefs(buf)
      for (let k = 1; !items && k <= 40 && li + k < lines.length; k++) {
        const next = lines[li + k] as string
        if (/^\s*@@/.test(next)) break
        buf += NL + next
        items = parseRefs(buf)
        if (items) li += k
      }
      if (items) out.refs.push({ stage: rf[1], items })
      continue
    }
    const vd = /^\s*@@VERDICT\s+stage=(\S+)\s+kind=(\S+)\s+verdict=(PASS WITH GAPS|PASS|FAIL)\s*\|\s*(.*)$/.exec(line)
    if (vd && vd[1] && OUTPUT_STAGES.includes(vd[1])) {
      out.verdicts.push({ stage: vd[1], kind: vd[2] ?? '', verdict: vd[3] as 'PASS' | 'PASS WITH GAPS' | 'FAIL', reason: (vd[4] ?? '').trim(), pos: li })
      continue
    }
    const fl = /^\s*@@FAIL\s+stage=(\S+)\s*\|\s*(.*)$/.exec(line)
    if (fl && fl[1] && OUTPUT_STAGES.includes(fl[1])) {
      out.fails.push({ stage: fl[1], reason: (fl[2] ?? '').trim(), pos: li })
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

// The transcript of list_events is plain text: blocks that start with a line such as [assistant] or [user].
export type Block = { role: string; text: string }

export function transcriptBlocks(text: string): Block[] {
  const blocks: Block[] = []
  for (const line of text.split(NL)) {
    const m = /^\[([a-zA-Z_ -]+)(?:[^\]]*)\]\s?(.*)$/.exec(line)
    if (m && m[1]) blocks.push({ role: m[1].trim().toLowerCase(), text: m[2] ?? '' })
    else if (blocks.length > 0) blocks[blocks.length - 1]!.text += NL + line
  }
  return blocks
}

const TAG_LINE = /^\s*@@(OUTPUT|END|DOC|CHOSEN|SCORES|GATE|REFS|VERDICT|FAIL)\b/

// True when the chat answered the panel's request (the request header is in a user block) with a real reply that has no tag
// line at all. Needs the role markers; without them it cannot tell and says false.
export function repliedWithoutTags(text: string, action: string, gen: number): boolean {
  const blocks = transcriptBlocks(text)
  if (blocks.length === 0 || !blocks.some(b => b.role === 'assistant')) return false
  const want = new RegExp(`Action:\\s.*\\(${action}\\)\\.\\s*Generation:\\s*${gen}\\.`)
  let at = -1
  blocks.forEach((b, k) => {
    if (b.role !== 'assistant' && want.test(b.text)) at = k
  })
  if (at < 0) return false
  const reply = blocks.slice(at + 1).filter(b => b.role === 'assistant')
  if (reply.length === 0) return false
  const body = reply.map(b => b.text).join(NL)
  if (body.split(NL).some(l => TAG_LINE.test(l))) return false
  return body.replace(/\s+/g, ' ').trim().length >= 200
}
