import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import { DOC_KINDS, docName, fileIdOf, kindOfName, parseDocName, stageNN } from '../hooks/docnames'
import { applyParsed, createPrototype, docLinks, ensureReveng, markAsked, newestDocs, templateDone } from '../hooks/factory'
import { emptyStore } from '../hooks/model'
import { parseRefs, parseTags } from '../hooks/outputs'
import { ensureProtoFolders } from '../hooks/protos'
import { buildRequest } from '../hooks/request'
import { MAX_SEGMENTS, clampSegment, fillPrompt, fmtTime, segmentLabel, segmentWindow } from '../hooks/segments'
import { MAX_FILE_BYTES, classify, expandHome, lenientParse, numberFromName, planUpload, splitPaths, summarizePlan } from '../hooks/upload'
import type { RawFile } from '../hooks/upload'

const NOW = '2026-11-11T10:00:00.000Z'
const FIX = path.join(import.meta.dirname, 'fixtures', 'reveng')

function load(dir: string): RawFile[] {
  const d = path.join(FIX, dir)
  return readdirSync(d)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      const text = readFileSync(path.join(d, f), 'utf8')
      return { path: path.join(d, f), name: f, bytes: statSync(path.join(d, f)).size, text }
    })
}

/* ---------- document names ---------- */

test('standard document names follow <proto>_<NN>_<kind>_v<gen><suffix>', () => {
  assert.equal(docName('P003-MONSTER', 'brief', 'brief', 1), 'P003-MONSTER_02_brief_v1')
  assert.equal(docName('P003-MONSTER', 'template', 'reveng-report', 1), 'P003-MONSTER_03_reveng-report_v1')
  assert.equal(docName('P003-MONSTER', 'template', 'template-doc', 2), 'P003-MONSTER_03_template-doc_v2')
  assert.equal(docName('P003-MONSTER', 'template', 'reveng-input', 1, '_chunk01.json'), 'P003-MONSTER_03_reveng-input_g1_chunk01.json')
  assert.equal(docName('P001-X', 'metricas', 'results', 3), 'P001-X_09_results_v3')
  assert.deepEqual(['prevalid', 'brief', 'template', 'doccompleto', 'build', 'titulo', 'thumb', 'publicar', 'metricas'].map(stageNN), ['01', '02', '03', '04', '05', '06', '07', '08', '09'])
})

test('a document name can be read back, and its kind derived', () => {
  const p = parseDocName('P003-MONSTER_03_template-doc_v2')
  assert.deepEqual(p, { protoId: 'P003-MONSTER', nn: '03', kind: 'template-doc', gen: 2, suffix: '' })
  assert.equal(kindOfName('P003-MONSTER_03_reveng-input_g1_chunk01.json'), 'reveng-input')
  assert.equal(parseDocName('P003-MONSTER_03_reveng-input_g1_chunk01.json')?.suffix, '_chunk01.json')
  assert.equal(kindOfName('random name'), null)
  assert.ok(DOC_KINDS.includes('reveng-merged'))
  assert.equal(fileIdOf('https://docs.google.com/document/d/1AbC_defGHIjk-lmn/edit'), '1AbC_defGHIjk-lmn')
  assert.equal(fileIdOf('https://drive.google.com/drive/folders/1XduWjErt3wDKfUz9mLOn5B'), '1XduWjErt3wDKfUz9mLOn5B')
  assert.equal(fileIdOf('https://x.test/nothing'), null)
})

/* ---------- the request builder ---------- */

const base = {
  protoId: 'P003-MONSTER',
  title: 'Monster Truck',
  stageId: 'brief',
  stageName: '2-page brief',
  actionId: 'brief',
  actionLabel: 'Write 2-page brief',
  gen: 2,
  skills: { folder: 'brief', stageFolderId: 'FOLD1', allId: 'ALL1' },
  protoFolder: { name: 'P003-MONSTER', id: 'PF1' },
  expectedDocName: 'P003-MONSTER_02_brief_v2',
  docs: [{ stage: 'prevalid', name: 'P003-MONSTER_01_scan_v1', url: 'https://x.test/a' }],
}

test('the request has the same structure for every action', () => {
  const lines = (s: string) => s.split(String.fromCharCode(10))
  const a = lines(buildRequest(base))
  const b = lines(buildRequest({ ...base, stageId: 'template', stageName: 'Reverse engineering', actionId: 'reveng_validate', actionLabel: 'Validate doc', skills: { folder: 'reveng', stageFolderId: 'R1', allId: 'ALL1' }, params: { batch: 3, no_economy: false } }))
  for (const k of [0, 1, 2]) assert.equal(a[k]!.split(' ')[0], b[k]!.split(' ')[0])
  assert.ok(a[0]!.startsWith('Prototype P003-MONSTER (Monster Truck). Stage: 2-page brief (brief). Action: Write 2-page brief (brief). Generation: 2.'))
  assert.ok(a[1]!.startsWith('Skills: before starting, list the Drive folder brief (id FOLD1) and the folder _all (id ALL1). Read every file in both (ignore subfolders)'))
  assert.ok(a[1]!.includes('use the installed skill of the same name if one exists.'))
  assert.ok(a[2]!.includes('Drive folder P003-MONSTER (id PF1), using exactly the name P003-MONSTER_02_brief_v2'))
  assert.ok(a[2]!.includes('defined in _all/skill_output_protocol.md.'))
  assert.equal(a[3], 'Context:')
  assert.equal(a[4], '- prevalid | P003-MONSTER_01_scan_v1 | https://x.test/a')
  assert.ok(b.some(l => l === 'Params: batch=3; no_economy=false'))
})

test('the request carries no work instructions and no tag syntax, and no dashes', () => {
  const t = buildRequest({ ...base, chosenReference: 'Game, https://g.test', params: { x: 'y' } })
  assert.ok(!t.includes('@@'))
  assert.ok(!t.includes(String.fromCharCode(0x2013)) && !t.includes(String.fromCharCode(0x2014)))
  assert.ok(t.includes('Chosen reference: Game, https://g.test'))
  assert.equal(buildRequest({ ...base, docs: [] }).split(String.fromCharCode(10)).pop(), 'Context: none.')
})

test('missing Drive ids still give a usable request', () => {
  const t = buildRequest({ ...base, skills: { folder: 'brief', stageFolderId: null, allId: null }, protoFolder: { name: 'P003-MONSTER', id: null } })
  assert.ok(t.includes('find it inside the Drive folder roblox_radar_skills'))
  assert.ok(t.includes('create it if it is missing'))
})

/* ---------- tag parser: REFS, VERDICT, FAIL ---------- */

const REFS_JSON = JSON.stringify([
  { name: 'Game A', url: 'https://roblox.com/games/1', universe_id: '11', visits: '9.3B', approval_pct: '87%', ccu: '120K', as_of: '2026-11-10', why_fit: 'loop match', risk: 'fading', tag: 'F' },
  { name: 'Game B', url: 'https://roblox.com/games/2', visits: 500, tag: 'H' },
  { url: 'https://nameless.test' },
])

test('@@REFS parses an array, tolerates missing keys and numbers, drops entries without a name', () => {
  const p = parseTags(['Brief done.', `@@REFS stage=brief | ${REFS_JSON}`].join(String.fromCharCode(10)))
  assert.equal(p.refs.length, 1)
  assert.equal(p.refs[0]!.items.length, 2)
  assert.equal(p.refs[0]!.items[1]!.visits, '500')
  assert.equal(p.refs[0]!.items[1]!.risk, undefined)
  assert.equal(parseRefs('not json'), null)
  assert.deepEqual(parseRefs('[]'), [])
})

test('@@REFS survives JSON-wrapped transcripts and multi-line arrays, and ignores quoted examples', () => {
  const nl = String.fromCharCode(10)
  const text = ['@@OUTPUT stage=brief kind=brief gen=1', 'Three candidates.', '@@END', `@@REFS stage=brief | ${REFS_JSON}`].join(nl)
  assert.equal(parseTags(JSON.stringify(text)).refs.length, 1)
  assert.equal(parseTags(text.split(nl).join('\\n')).refs.length, 1)
  const pretty = JSON.stringify(JSON.parse(REFS_JSON), null, 1)
  assert.equal(parseTags(`@@REFS stage=brief | ${pretty}`).refs[0]!.items.length, 2)
  assert.equal(parseTags(`> @@REFS stage=brief | ${REFS_JSON}`).refs.length, 0)
  assert.equal(parseTags(['```', `@@REFS stage=brief | ${REFS_JSON}`, '```'].join(nl)).refs.length, 0)
  assert.equal(parseTags(`@@REFS stage=<stageId> | ${REFS_JSON}`).refs.length, 0)
})

test('@@VERDICT and @@FAIL parse with stage and kind validated', () => {
  const nl = String.fromCharCode(10)
  const p = parseTags(['@@VERDICT stage=template kind=reveng_validation verdict=PASS WITH GAPS | 2 fields missing', '@@FAIL stage=template | the validator could not run', '@@VERDICT stage=nope kind=x verdict=PASS | x'].join(nl))
  assert.equal(p.verdicts.length, 1)
  assert.deepEqual([p.verdicts[0]!.verdict, p.verdicts[0]!.kind, p.verdicts[0]!.reason], ['PASS WITH GAPS', 'reveng_validation', '2 fields missing'])
  assert.equal(p.fails.length, 1)
  assert.equal(p.fails[0]!.reason, 'the validator could not run')
  assert.equal(parseTags('@@VERDICT stage=template kind=reveng_validation verdict=FAIL | coverage').verdicts[0]!.verdict, 'FAIL')
})

test('reveng_validation is an accepted output kind and request headers are located', () => {
  const nl = String.fromCharCode(10)
  const p = parseTags(['Prototype P1-A (x). Stage: Reverse engineering (template). Action: Validate doc (reveng_validate). Generation: 2.', '@@OUTPUT stage=template kind=reveng_validation gen=2', 'report', '@@END'].join(nl))
  assert.equal(p.outputs[0]!.kind, 'reveng_validation')
  assert.deepEqual(p.headers, [{ action: 'reveng_validate', gen: 2, pos: 0 }])
})

/* ---------- applying the new tags ---------- */

function proto() {
  const s = emptyStore()
  const i = createPrototype(s, { title: 'Truck', note: '', origin: 'own', from: null, now: NOW })
  return i
}
const J = (...l: string[]) => l.join(String.fromCharCode(10))

test('@@DOC registers documents, keeps older ones, links legacy output docs, and completes a stage', () => {
  const i = proto()
  const r1 = applyParsed(i, parseTags('@@DOC stage=brief | P001-TRUCK_02_brief_v1 | https://docs.google.com/document/d/AAAAAAAAAAAA/edit'), NOW)
  assert.equal(r1.added, 1)
  assert.equal(i.docs!.brief![0]!.kind, 'brief')
  assert.equal(i.docs!.brief![0]!.fileId, 'AAAAAAAAAAAA')
  assert.equal(i.checks!.brief, 'done')
  applyParsed(i, parseTags('@@DOC stage=brief | P001-TRUCK_02_brief_v2 | https://docs.google.com/document/d/BBBBBBBBBBBB/edit'), '2026-11-11T11:00:00.000Z')
  assert.equal(i.docs!.brief!.length, 2)
  assert.equal(newestDocs(i.docs!.brief!)[0]!.gen, 2)
  assert.equal(applyParsed(i, parseTags('@@DOC stage=brief | P001-TRUCK_02_brief_v2 | https://docs.google.com/document/d/BBBBBBBBBBBB/edit'), NOW).added, 0)
  i.outputs!.build = [{ at: NOW, kind: 'build_plan', gen: 1, content: 'x', skill: [], chosen: [], discarded: [], doc: { title: 'old plan', url: 'https://legacy.test/plan' } }]
  assert.deepEqual(docLinks(i, 'build'), [{ name: 'old plan', url: 'https://legacy.test/plan' }])
  assert.equal(docLinks(i, 'brief').length, 2)
})

test('@@REFS fills the candidates; a new list moves the old one to history and resets the choice', () => {
  const i = proto()
  applyParsed(i, parseTags(`@@REFS stage=brief | ${REFS_JSON}`), NOW)
  assert.equal(i.refs!.candidates.length, 2)
  assert.equal(i.refs!.chosenIndex, null)
  i.refs!.chosenIndex = 1
  applyParsed(i, parseTags(`@@REFS stage=brief | ${REFS_JSON}`), NOW)
  assert.equal(i.refs!.chosenIndex, 1)
  applyParsed(i, parseTags('@@REFS stage=brief | [{"name":"Game C"}]'), NOW)
  assert.equal(i.refs!.candidates[0]!.name, 'Game C')
  assert.equal(i.refs!.chosenIndex, null)
  assert.equal(i.refs!.history.length, 1)
})

test('Reverse engineering is done only with a passing verdict and a template doc; a verdict counts after its request', () => {
  const i = proto()
  i.stage = 'template'
  const rv = ensureReveng(i)
  markAsked(i, 'template', 'reveng_validation', 2, [], NOW, 'reveng_validate')
  const old = J('Action: Validate doc (reveng_validate). Generation: 2.', '@@VERDICT stage=template kind=reveng_validation verdict=FAIL | coverage')
  // an old FAIL printed before the new request header must not count
  const text = J('@@VERDICT stage=template kind=reveng_validation verdict=PASS | old run', 'Prototype P001-TRUCK (Truck). Stage: Reverse engineering (template). Action: Validate doc (reveng_validate). Generation: 2.', '@@VERDICT stage=template kind=reveng_validation verdict=PASS WITH GAPS | two gaps')
  applyParsed(i, parseTags(text), NOW)
  assert.equal(rv.verdict, 'PASS WITH GAPS')
  assert.equal(i.requested!.template, undefined)
  assert.notEqual(i.checks!.template, 'done')
  assert.equal(templateDone(i), false)
  applyParsed(i, parseTags('@@DOC stage=template | P001-TRUCK_03_template-doc_v1 | https://docs.google.com/document/d/CCCCCCCCCCCC/edit'), NOW)
  assert.equal(templateDone(i), true)
  assert.equal(i.checks!.template, 'done')
  void old
})

test('a FAIL returns a pending request to not started and shows its reason; without a pending request it is ignored', () => {
  const i = proto()
  applyParsed(i, parseTags('@@FAIL stage=brief | no connector'), NOW)
  assert.equal(i.failed!.brief, undefined)
  markAsked(i, 'brief', 'brief', 1, [], NOW, 'brief')
  assert.equal(i.checks!.brief, 'asked')
  const r = applyParsed(i, parseTags('@@FAIL stage=brief | no connector'), NOW)
  assert.equal(r.failed, 1)
  assert.equal((i.failed as Record<string, { reason: string }>)['brief']!.reason, 'no connector')
  assert.equal(i.checks!.brief, undefined)
  assert.equal(i.requested!.brief, undefined)
  assert.equal(applyParsed(i, parseTags('@@FAIL stage=brief | no connector'), NOW).failed, 0)
  markAsked(i, 'brief', 'brief', 2, [], NOW, 'brief')
  assert.equal(i.failed!.brief, undefined)
})

/* ---------- segments and prompts ---------- */

test('segment windows: 600 seconds plus a 10 second overlap, H:MM:SS from one hour', () => {
  assert.deepEqual(segmentWindow(1), { index: 1, startSec: 0, endSec: 610, start: '00:00', end: '10:10' })
  assert.equal(segmentLabel(3), '20:00 to 30:10')
  assert.equal(segmentWindow(6).end, '1:00:10')
  assert.equal(segmentWindow(12).end, '2:00:10')
  assert.equal(fmtTime(3599), '59:59')
  assert.equal(fmtTime(3600), '1:00:00')
  assert.equal(clampSegment(0), 1)
  assert.equal(clampSegment(99), MAX_SEGMENTS)
  assert.equal(clampSegment(Number.NaN), 1)
})

test('prompt filling replaces INDEX, START and END everywhere and leaves other placeholders alone', () => {
  const extract = 'segment {INDEX} from {START} to {END}. again {INDEX}.'
  assert.equal(fillPrompt(extract, 3), 'segment 3 from 20:00 to 30:10. again 3.')
  const audit = 'JSON TO CHECK:' + String.fromCharCode(10) + '{PASTE THE JSON FROM PROMPT 1}'
  assert.equal(fillPrompt(audit, 2), audit)
})

/* ---------- upload classification and numbering ---------- */

test('lenient parse reads plain JSON, code fences and Markdown escapes, and refuses garbage', () => {
  assert.equal((lenientParse('{"a":1}') as { ok: true; value: { a: number } }).value.a, 1)
  assert.equal(lenientParse('```json' + String.fromCharCode(10) + '{"a":1}' + String.fromCharCode(10) + '```').ok, true)
  const esc = lenientParse('{"video\\_quality": {"x": \\[1, 2\\]}}')
  assert.equal(esc.ok, true)
  assert.deepEqual((esc as { ok: true; value: { video_quality: { x: number[] } } }).value.video_quality.x, [1, 2])
  assert.equal(lenientParse('here you go: {"a":2} thanks').ok, true)
  assert.equal(lenientParse('nothing here').ok, false)
})

test('file names give numbers, paths split on newlines and semicolons', () => {
  assert.equal(numberFromName('chunk_02.json'), 2)
  assert.equal(numberFromName('P1_seg03_extract.json'), 3)
  assert.equal(numberFromName('notes.json'), null)
  assert.deepEqual(splitPaths('"C:/a/b.json";~/c.json' + String.fromCharCode(10) + ' D:/d '), ['C:/a/b.json', '~/c.json', 'D:/d'])
  assert.equal(expandHome('~/x.json', '/home/u'), '/home/u/x.json')
  assert.equal(expandHome('/abs.json', '/home/u'), '/abs.json')
})

test('classification: chunk by segment key, audit by verdict items or name', () => {
  assert.deepEqual(classify('c.json', { segment: { index: 4 } }), { kind: 'chunk', index: 4 })
  assert.deepEqual(classify('chunk_07.json', { segment: {} }), { kind: 'chunk', index: 7 })
  assert.deepEqual(classify('a.json', [{ array: 'events', index: 0, verdict: 'confirmed' }]), { kind: 'audit', index: null })
  assert.equal(classify('my_audit_02.json', [])!.kind, 'audit')
  assert.equal(classify('x.json', { nothing: true }).kind, 'unknown')
})

test('six good chunks are accepted, numbered 1 to 6 and given standard names', () => {
  const plan = planUpload('P003-MONSTER', 2, load('synthetic_good'))
  assert.equal(plan.rejected.length, 0)
  assert.equal(plan.accepted.length, 6)
  assert.deepEqual(plan.accepted.map(f => f.index), [1, 2, 3, 4, 5, 6])
  assert.equal(plan.accepted[0]!.stdName, 'P003-MONSTER_03_reveng-input_g2_chunk01.json')
  assert.equal(summarizePlan(plan, 2), 'Uploaded 6 chunks, batch 2')
})

test('Markdown-escaped, code-fenced exports are accepted like plain ones', () => {
  const plan = planUpload('P003-MONSTER', 1, load('synthetic_esc'))
  assert.equal(plan.accepted.length, 6)
  assert.equal(plan.rejected.length, 0)
})

test('short and bad fixtures still upload (the validator, not the panel, judges them)', () => {
  assert.equal(planUpload('P1-A', 1, load('synthetic_short')).accepted.length, 2)
  assert.equal(planUpload('P1-A', 1, load('synthetic_bad')).accepted.length, 6)
})

test('rejections: wrong type, too large, not JSON, unknown shape, duplicate segment; audits are numbered by name', () => {
  const good = load('synthetic_good')
  const files: RawFile[] = [
    good[0]!,
    { path: 'x', name: 'dup.json', bytes: 10, text: good[0]!.text },
    { path: 'x', name: 'big.json', bytes: MAX_FILE_BYTES + 1, text: '{}' },
    { path: 'x', name: 'broken.json', bytes: 5, text: '{nope' },
    { path: 'x', name: 'shape.json', bytes: 5, text: '{"a":1}' },
    { path: 'x', name: 'photo.png', bytes: 5, text: '' },
    { path: 'x', name: 'chunk_01_audit.json', bytes: 50, text: '[{"array":"events","index":0,"verdict":"confirmed"}]' },
  ]
  const plan = planUpload('P1-A', 1, files)
  assert.equal(plan.accepted.filter(f => f.kind === 'chunk').length, 1)
  assert.equal(plan.accepted.filter(f => f.kind === 'audit').length, 1)
  assert.equal(plan.accepted.find(f => f.kind === 'audit')!.stdName, 'P1-A_03_reveng-input_g1_audit01.json')
  assert.deepEqual(plan.rejected.map(r => r.name).sort(), ['big.json', 'broken.json', 'dup.json', 'photo.png', 'shape.json'])
  assert.equal(summarizePlan(plan, 1), 'Uploaded 1 chunk, 1 audit, batch 1')
})

test('a chunk without a segment index takes the number in its name, then sorted order', () => {
  const mk = (name: string): RawFile => ({ path: name, name, bytes: 20, text: '{"segment":{}}' })
  const plan = planUpload('P1-A', 1, [mk('b.json'), mk('part_5.json'), mk('a.json')])
  const byName = Object.fromEntries(plan.accepted.map(f => [f.name, f.index]))
  assert.equal(byName['part_5.json'], 5)
  assert.deepEqual([byName['a.json'], byName['b.json']].sort(), [1, 2])
})

/* ---------- the prototype Drive folder ---------- */

// A tiny in-memory Drive: search by title, mime type and parent, and create.
function fakeDrive() {
  const files: { id: string; title: string; parentId: string | null; mime: string }[] = []
  let n = 0
  const calls = { search: 0, create: 0 }
  const drive = async (tool: string, args: Record<string, unknown>): Promise<string> => {
    if (tool === 'search_files') {
      calls.search++
      const q = String(args.query)
      const title = /title = '([^']*)'/.exec(q)?.[1]
      const parent = /parentId = '([^']+)'/.exec(q)?.[1] ?? null
      const hit = files.filter(f => f.title === title && (parent ? f.parentId === parent : true) && f.mime.includes('folder'))
      return JSON.stringify({ files: hit.map(f => ({ id: f.id, title: f.title })) })
    }
    if (tool === 'create_file') {
      calls.create++
      const f = { id: `ID${++n}`, title: String(args.title), parentId: (args.parentId as string) ?? null, mime: String(args.contentMimeType) }
      files.push(f)
      return JSON.stringify({ id: f.id, title: f.title })
    }
    throw new Error(`unexpected tool ${tool}`)
  }
  return { drive, files, calls }
}

test('creating the prototype folder twice makes no duplicate: root, <proto_id> and inputs exist once', async () => {
  const d = fakeDrive()
  const a = await ensureProtoFolders(d.drive, '', 'P003-MONSTER')
  const createdAfterFirst = d.calls.create
  assert.equal(createdAfterFirst, 3)
  const b = await ensureProtoFolders(d.drive, '', 'P003-MONSTER')
  assert.equal(d.calls.create, createdAfterFirst)
  assert.deepEqual([b.folderId, b.inputsId, b.rootId], [a.folderId, a.inputsId, a.rootId])
  assert.equal(d.files.filter(f => f.title === 'P003-MONSTER').length, 1)
  assert.equal(d.files.filter(f => f.title === 'inputs').length, 1)
  assert.equal(d.files.filter(f => f.title === 'roblox_radar_protos').length, 1)
  assert.ok(a.folderUrl.endsWith(a.folderId))
  const c = await ensureProtoFolders(d.drive, a.rootId, 'P004-OTHER')
  assert.equal(c.rootId, a.rootId)
  assert.equal(d.files.filter(f => f.title === 'roblox_radar_protos').length, 1)
  assert.equal(d.files.filter(f => f.title === 'inputs').length, 2)
})

test('a failing Drive call surfaces as an error the caller can turn into a notice', async () => {
  await assert.rejects(ensureProtoFolders(async () => { throw new Error('Drive is not reachable') }, '', 'P001-A'), /Drive is not reachable/)
})
