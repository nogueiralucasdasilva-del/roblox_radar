// The self-test: feeds fictional replies (data/selftest) through the real tag parser and the real state code, in a scratch
// store that is never the real one, and checks the result against the expectations of each fixture's README.
import { applyParsed, createPrototype, docLinks, markAsked } from './factory'
import { IDEA_STAGES, emptyStore } from './model'
import type { Idea } from './model'
import { parseTags, splitItems } from './outputs'
import { parseScan } from './scan'
import { parseCriteria } from './scoring'

export type SelfFile = { name: string; text: string }
export type SelfResult = { file: string; ok: boolean; detail: string }

const NOW = '2026-11-11T12:00:00.000Z'

function scratch(): Idea {
  const s = emptyStore()
  return createPrototype(s, { title: 'Anomaly Test', note: '', origin: 'own', from: null, now: NOW })
}

// Each golden file: how to prepare the scratch prototype, and the first wrong field (or null when everything is right).
const GOLDEN: Record<string, { prepare?: (i: Idea) => void; check: (i: Idea) => string | null }> = {
  'reply_brief.txt': {
    check: i => (i.outputs?.brief?.[0]?.kind !== 'brief' ? 'output kind brief missing' : docLinks(i, 'brief').length !== 1 ? `docs ${docLinks(i, 'brief').length}, expected 1` : (i.scores ?? []).length === 0 || Object.keys(i.scores![i.scores!.length - 1]!.criteria).length !== 6 ? 'expected 6 scores applied' : null),
  },
  'reply_refs.txt': {
    check: i => (i.outputs?.brief?.[0]?.kind !== 'refs' ? 'output kind refs missing' : (i.refs?.candidates.length ?? 0) !== 3 ? `references ${i.refs?.candidates.length ?? 0}, expected 3` : docLinks(i, 'brief').length !== 1 ? 'expected 1 doc' : null),
  },
  'reply_reveng_validation.txt': {
    check: i => (i.outputs?.template?.[0]?.kind !== 'reveng_validation' ? 'output missing' : docLinks(i, 'template').length !== 1 ? 'expected 1 doc' : i.reveng?.verdict !== 'PASS WITH GAPS' ? `verdict ${i.reveng?.verdict ?? 'none'}, expected PASS WITH GAPS` : null),
  },
  'reply_template_doc.txt': { check: i => (i.outputs?.template?.[0]?.kind !== 'template_doc' ? 'output missing' : docLinks(i, 'template').length !== 1 ? 'expected 1 doc' : null) },
  'reply_fulldoc.txt': { check: i => (i.outputs?.doccompleto?.[0]?.kind !== 'fulldoc' ? 'output missing' : docLinks(i, 'doccompleto').length !== 1 ? 'expected 1 doc' : i.checks?.doccompleto !== 'done' ? 'check not done' : null) },
  'reply_titles.txt': { check: i => (splitItems(i.outputs?.titulo?.[0]?.content ?? '').length !== 5 ? `titles ${splitItems(i.outputs?.titulo?.[0]?.content ?? '').length}, expected 5` : i.checks?.titulo !== 'done' ? 'check not done' : null) },
  'reply_titles_chosen.txt': {
    prepare: i => {
      i.outputs = { titulo: [{ at: NOW, kind: 'titles', gen: 1, content: '1. Soup Dash, short' + String.fromCharCode(10) + '2. Spill Run', skill: [], chosen: [], discarded: [] }] }
    },
    check: i => (i.outputs?.titulo?.[0]?.chosen.includes('Soup Dash') ? null : 'chosen title "Soup Dash" not stored'),
  },
  'reply_thumb_prompts.txt': { check: i => (splitItems(i.outputs?.thumb?.[0]?.content ?? '').length !== 5 ? `prompts ${splitItems(i.outputs?.thumb?.[0]?.content ?? '').length}, expected 5` : null) },
  'reply_build_plan.txt': { check: i => (i.outputs?.build?.[0]?.kind !== 'build_plan' ? 'output missing' : docLinks(i, 'build').length !== 1 ? 'expected 1 doc' : null) },
  'reply_launch.txt': { check: i => (i.outputs?.publicar?.[0]?.kind !== 'launch' ? 'output missing' : docLinks(i, 'publicar').length !== 0 ? 'launch must not register a doc' : null) },
  'reply_results.txt': { check: i => (i.outputs?.metricas?.[0]?.kind !== 'results' ? 'output missing' : null) },
  'reply_gate.txt': { check: i => (i.gate?.brief?.verdict !== 'PASS WITH RISKS' ? `gate ${i.gate?.brief?.verdict ?? 'none'}, expected PASS WITH RISKS on brief` : null) },
  'reply_fail.txt': {
    prepare: i => markAsked(i, 'prevalid', 'scan', 1, [], NOW, 'scan'),
    check: i => (i.failed?.prevalid?.reason ? (i.checks?.prevalid === 'asked' ? 'action did not return to not started' : null) : 'failure reason not stored'),
  },
}

// Runs every golden fixture. `render` (optional) builds the stage card of the result, and the self-test checks it is not empty.
export function runGolden(files: readonly SelfFile[], render?: (idea: Idea, stage: string) => unknown): SelfResult[] {
  const out: SelfResult[] = []
  for (const f of files) {
    const spec = GOLDEN[f.name]
    if (!spec) continue
    try {
      const idea = scratch()
      spec.prepare?.(idea)
      const parsed = parseTags(f.text)
      applyParsed(idea, parsed, NOW)
      let wrong = spec.check(idea)
      if (!wrong && render) {
        for (const stage of IDEA_STAGES) {
          if (!render(idea, stage)) {
            wrong = `the ${stage} card rendered empty`
            break
          }
        }
      }
      out.push({ file: f.name, ok: wrong === null, detail: wrong ?? 'ok' })
    } catch (err) {
      out.push({ file: f.name, ok: false, detail: `threw: ${String((err as Error)?.message ?? err).slice(0, 120)}` })
    }
  }
  for (const name of Object.keys(GOLDEN)) if (!files.some(f => f.name === name)) out.push({ file: name, ok: false, detail: 'fixture file not found' })
  return out
}

export const GOLDEN_FILES = Object.keys(GOLDEN)

export const PREVALID_FILES = ['reply_plain.txt', 'reply_json_wrapped.json', 'reply_fenced.txt', 'reply_trailing_spaces.txt', 'reply_malformed.txt', 'reply_no_tags.txt', 'reply_quoted_example_only.txt']
const SAME = PREVALID_FILES.slice(0, 4)

// What the parser makes of one pre-validation reply: the scan result and the scored criteria.
export function readPrevalid(text: string) {
  const parsed = parseTags(text)
  const out = parsed.outputs.find(o => o.stage === 'prevalid' && o.kind === 'scan')
  const scan = out ? parseScan(out.content) : null
  const criteria = parsed.scores.length > 0 ? Object.keys(parseCriteria(parsed.scores[0], 'prevalid')) : []
  return { found: !!out, scan, criteria }
}

// The pre-validation fixtures: the four layouts give the same valid scan; malformed is found but invalid; no tags and a quoted example find nothing.
export function runPrevalid(files: readonly SelfFile[]): SelfResult[] {
  const out: SelfResult[] = []
  const byName = new Map(files.map(f => [f.name, f.text]))
  let reference: string | null = null
  for (const name of PREVALID_FILES) {
    const text = byName.get(name)
    if (text === undefined) {
      out.push({ file: `prevalid/${name}`, ok: false, detail: 'fixture file not found' })
      continue
    }
    let wrong: string | null = null
    try {
      const r = readPrevalid(text)
      if (SAME.includes(name)) {
        if (!r.found || !r.scan?.ok || !r.scan.scan) wrong = `scan not valid: ${r.scan?.errors.join(', ') ?? 'not found'}`
        else if (r.criteria.length !== 6) wrong = `scores ${r.criteria.length}, expected 6`
        else if (r.scan.scan.competitors.length !== 2) wrong = `competitors ${r.scan.scan.competitors.length}, expected 2`
        else if (!r.scan.scan.noKo) wrong = 'expected no knockout'
        else {
          const json = JSON.stringify(r.scan.scan)
          if (reference === null) reference = json
          else if (json !== reference) wrong = 'result differs from reply_plain.txt'
        }
      } else if (name === 'reply_malformed.txt') {
        const miss = r.scan && !r.scan.ok ? r.scan.errors.join(' ') : ''
        if (!r.found) wrong = 'scan block not found'
        else if (r.scan?.ok) wrong = 'expected an invalid scan'
        else if (!miss.includes('WEDGE') || !miss.includes('CONFIANCA')) wrong = `expected missing WEDGE and CONFIANCA, got: ${miss}`
      } else if (r.found) {
        wrong = 'a scan was found, expected none'
      }
    } catch (err) {
      wrong = `threw: ${String((err as Error)?.message ?? err).slice(0, 100)}`
    }
    out.push({ file: `prevalid/${name}`, ok: wrong === null, detail: wrong ?? 'ok' })
  }
  return out
}
