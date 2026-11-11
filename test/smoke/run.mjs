// Offline render smoke test: bundles the mod, renders the pane in many states and checks the element tree.
// Usage: node test/smoke/run.mjs [--dump <scenario>]
import { build } from 'esbuild'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const toolRoot = path.resolve(import.meta.dirname, '..', '..')
const root = process.env.RADAR_ROOT ? path.resolve(process.env.RADAR_ROOT) : toolRoot
const out = path.join(toolRoot, 'node_modules', '.smoke', 'bundle.mjs')
await build({
  entryPoints: [path.join(root, 'hooks', 'register.tsx')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: out,
  jsx: 'transform',
  absWorkingDir: root,
  jsxFactory: 'h',
  jsxFragment: 'Fragment',
  inject: [path.join(toolRoot, 'test', 'smoke', 'h.mjs')],
  alias: { 'claude-code': path.join(toolRoot, 'test', 'smoke', 'host-stub.mjs') },
  logLevel: 'error',
})
const stub = await import(pathToFileURL(path.join(toolRoot, 'test', 'smoke', 'host-stub.mjs')).href)
const { register } = await import(pathToFileURL(out).href + `?t=${Date.now()}`)

const handlers = []
register((event, a, b) => handlers.push({ event, filter: b ? a : null, fn: b ?? a }))
const render = handlers.find(h => h.event === 'ui.render').fn

const mem = new Map()
const $ = {
  plugin: { root },
  fs: { read: async p => readFileSync(p, 'utf8'), write: async () => {} },
  store: { get: async k => mem.get(k), set: async (k, v) => void mem.set(k, JSON.parse(JSON.stringify(v))) },
  ui: { resolve: () => ({ Box: 'Box', Text: 'Text', Button: 'Button', Input: 'Input', Link: 'Link' }), toast: () => {} },
  tool: {
    call: async a => {
      if (String(a.tool).endsWith('search_files')) return { text: JSON.stringify({ files: [{ id: 'r1', title: 'receipt_fake', createdTime: new Date().toISOString() }] }) }
      if (String(a.tool).endsWith('read_file_content')) return { text: JSON.stringify(fakeReceipt()) }
      return { isError: true, text: 'no tool in the smoke test' }
    },
    list: async () => [
      { name: 'mcp__fake__search_files', mcp: true, description: 'Google Drive search' },
      { name: 'mcp__fake__read_file_content', mcp: true, description: 'Google Drive read' },
    ],
  },
  mcp: { call: async () => { throw new Error('no mcp') } },
  model: { complete: async () => ({ isAnswered: false }) },
  session: { send: async () => ({ isDelivered: false }), surfaces: async () => [] },
  prompt: { submit: async () => ({}) },
  agent: { spawn: async () => ({ deny: 'no' }) },
  clock: { every: () => {} },
  command: { register: async () => {} },
}
const e = { surface: 'desktop', viewport: { columns: 100 }, props: { bodyColumns: 100 }, requestId: 'radar-panel', component: 'Pane' }

function fakeReceipt() {
  const now = new Date().toISOString()
  return {
    receipt_version: 1, task_key: 'coleta', stage: 'coleta', run_id: 'coleta-fake-1', started_utc: now, finished_utc: now, outcome: 'attention',
    summary: '18 legs ok, 1 stale, 1 degraded_size.', counts: { legs_ok: 18, legs_stale: 1 },
    items: [{ name: 'tiktok_trends', status: 'stale', rows: 50, note: 'identical to yesterday' }, { name: 'reddit', status: 'skipped_cost', rows: null, note: 'cost cap' }, { name: 'google_trends', status: 'ok', rows: 120, note: 'fresh' }],
    outputs: [{ kind: 'sheet', name: 'collection_log', ref: 'abc' }], problems: ['reddit shrank'], next_run_utc: '2020-01-01T00:00:00Z',
  }
}
// ---- tree helpers ----
const textOf = n => (typeof n === 'string' || typeof n === 'number' ? String(n) : n && n.children ? n.children.map(textOf).join('') : '')
function walk(n, f, parent = null) {
  if (n === null || typeof n !== 'object') return
  f(n, parent)
  for (const c of n.children || []) walk(c, f, n)
}
function lint(tree) {
  const problems = []
  walk(tree, (n, parent) => {
    if (typeof n.type !== 'string') problems.push(`non-string element type: ${String(n.type)}`)
    if (n.type === 'Text' && parent && parent.type === 'Text') problems.push(`Text inside Text: "${textOf(n).slice(0, 40)}"`)
    if (n.type === 'Button') {
      for (const c of n.children) if (typeof c === 'object' && c.type !== 'Text') problems.push(`Button with a ${c.type} child: "${textOf(n).slice(0, 40)}"`)
      if (n.children.length === 0 && !n.props.label) problems.push('Button without label or children')
    }
    if (n.type === 'Box') for (const c of n.children) if (typeof c === 'string' || typeof c === 'number') problems.push(`bare text inside Box: "${String(c).slice(0, 40)}"`)
    for (const c of n.children || []) if (Array.isArray(c)) problems.push('nested array child')
  })
  return problems
}
const keys = tree => {
  const out = []
  walk(tree, n => n.props && n.props.key && out.push(n.props.key))
  return out
}
function dump(tree) {
  const lines = []
  const rec = (n, depth) => {
    if (n === null || typeof n !== 'object') return
    if (n.type === 'Text') {
      lines.push(`${' '.repeat(depth)}${textOf(n)}`)
      return
    }
    if (n.type === 'Button') {
      lines.push(`${' '.repeat(depth)}[${n.props.label ?? textOf(n)}]`)
      return
    }
    if (n.type === 'Link') {
      lines.push(`${' '.repeat(depth)}<link ${n.props.label}>`)
      return
    }
    if (n.type === 'Input') {
      lines.push(`${' '.repeat(depth)}<input ${n.props.key}: ${n.props.placeholder}>`)
      return
    }
    for (const c of n.children) rec(c, depth + (n.type === 'Box' && n.props.borderStyle ? 1 : 0))
  }
  rec(tree, 0)
  return lines.join(String.fromCharCode(10))
}

let failures = 0
const results = []
const signatures = {}
function signature(tree) {
  const norm = t => t.replace(/[▶▸▾▴‹›←●○◐✔]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()
  const buttons = []
  const inputs = []
  const links = []
  walk(tree, n => {
    if (n.type === 'Button') buttons.push({ key: n.props.key ?? null, text: norm(n.props.label ?? textOf(n)), hotkey: n.props.hotkey ?? null, press: typeof n.props.onPress === 'function' })
    if (n.type === 'Input') inputs.push({ key: n.props.key ?? null, placeholder: n.props.placeholder ?? null, submitLabel: n.props.submitLabel ?? null, rows: n.props.rows ?? null, submit: typeof n.props.onSubmit === 'function' })
    if (n.type === 'Link') links.push({ href: n.props.href ?? null, label: n.props.label ?? null })
  })
  const by = (a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))
  return { buttons: buttons.sort(by), inputs: inputs.sort(by), links: links.sort(by) }
}
async function scenario(name, setup, check, columns = 100) {
  try {
    if (setup) await setup()
    e.viewport = { columns }
    e.props = { bodyColumns: columns }
    const tree = await render($, e)
    signatures[name] = signature(tree)
    const problems = lint(tree)
    const text = dump(tree)
    const extra = check ? check(tree, text, keys(tree)) : []
    const all = [...problems, ...extra]
    if (all.length) failures++
    results.push({ name, ok: all.length === 0, problems: all, text })
  } catch (err) {
    failures++
    results.push({ name, ok: false, problems: [`THROWN: ${String((err && err.stack) || err).slice(0, 600)}`], text: '' })
  }
}

const setAtom = async (key, v) => stub.state.set(`radar-panel:${key}`, v)
const stages = JSON.parse(readFileSync(path.join(root, 'data', 'stages.json'), 'utf8')).stages
const NOW = new Date().toISOString()
const mkIdea = (n, stage, extra = {}) => ({
  id: `p${n}`, title: `Monster Truck ${n}`, note: 'n', origin: 'own', from: null, stage, status: 'pending', proto_id: `P00${n}-MONSTER${n}`,
  created: NOW, updated: NOW, history: [{ stage: 'prevalid', at: NOW, status: 'pending' }], abbr: `MONSTER${n}`,
  checks: { prevalid: 'done', brief: 'asked' }, askedAt: {}, requested: {}, scores: [], outputs: {}, gate: {}, gateAsked: {}, ...extra,
})
const base = () => ({ threads: {}, archive: {}, instructions: {}, log: {}, ideas: [], knowledge: {}, seeded: true, memory: {}, outbox: [], memSaved: 0, restoredAt: NOW, jobs: {}, stageChats: {}, protoSeq: 0, inbox: [], migrated070: true })
const putStore = s => mem.set('rr1', s)
const out1 = { at: NOW, kind: 'titles', gen: 1, content: '1. Truck Rush' + String.fromCharCode(10) + '2. Mud Kings', skill: [{ name: 's.md', modified: NOW }], chosen: ['Mud Kings'], discarded: [] }
const outThumb = { at: NOW, kind: 'thumb_prompts', gen: 1, content: '1. Close up: a truck jumps' + String.fromCharCode(10) + '2. Wide: crowd', skill: [], chosen: [], discarded: ['Wide: crowd'] }
const crit = { demand: { v: 80, c: 'high', e: 'e', t: 'F', stage: 'prevalid' }, safety: { v: 20, c: 'high', e: 'e', t: 'F', stage: 'prevalid' } }
const rich = () => {
  const s = base()
  s.protoSeq = 3
  s.ideas = [
    mkIdea(1, 'prevalid'),
    mkIdea(2, 'titulo', { outputs: { titulo: [out1] }, scores: [{ at: NOW, stage: 'prevalid', criteria: crit, h: 'x' }, { at: NOW, stage: 'brief', criteria: { ...crit, demand: { ...crit.demand, v: 60 } }, h: 'y' }], chat: { id: 'sess', title: 't', link: 'claude://x', at: NOW, syncedAt: null, seen: 0 } }),
    mkIdea(3, 'thumb', { status: 'rejected', outputs: { thumb: [outThumb] } }),
  ]
  s.inbox = [{ id: 'in1', title: 'Skate park', note: 'note', origin: 'own', from: null, created: NOW }]
  return s
}

await render($, e)
await new Promise(r => setTimeout(r, 400))
const reset = async () => {
  stub.state.clear()
  mem.clear()
  putStore(base())
}

// Case and padding insensitive: the look changes, the words must not.
const squash = t => t.toLowerCase().replace(/\[\s+/g, '[').replace(/\s+\]/g, ']').replace(/\s+/g, ' ')
const need = (...words) => (t, text) => words.filter(w => !squash(text).includes(squash(w))).map(w => `missing "${w}"`)
await scenario('radar map: numbered cards for collection, screening, loose ideas, plus the auditor bar', reset, need('[        RADAR        ]', 'FACTORY', 'v0.8.0', '[ 1  Radar and collection', '[ 2  Screening and advisor', '[ 3  Loose ideas', 'Auditor'))
await scenario('radar: collection card opens full screen with its sources', async () => { await reset(); await setAtom('rstage', 'coleta') }, need('[← Pipeline]', 'Open chat', 'google_trends', '[Sources]'))
await scenario('radar: advisor card opens with the latest report and Send to Factory', async () => { await reset(); await setAtom('rstage', 'triagem') }, need('Send to Factory', 'Latest report is open'))
await scenario('radar: loose ideas card opens with the inbox', async () => { await reset(); putStore(rich()); await setAtom('rstage', 'inbox') }, need('Skate park', 'Send to Factory', 'Discard', 'add-inbox', '[← Pipeline]'))
await scenario('radar: auditor opens', async () => { await reset(); await setAtom('rstage', 'auditor') }, need('[← Pipeline]'))
await scenario('radar: garbage values fall back to the map', async () => { await reset(); await setAtom('rstage', 'zzz'); await setAtom('mode', 'nope') }, need('[ 1  Radar and collection'))
await scenario('radar: receipts tab, one receipt open', async () => { await reset(); await setAtom('rstage', 'coleta'); await setAtom('tabs', { coleta: 'receipts' }); await setAtom('open', ['rcp:coleta-fake-1']) }, need('coleta', 'Outcome', 'reddit shrank', 'tiktok_trends', 'skipped_cost'))
await scenario('radar: more open', async () => { await reset(); await setAtom('more', true) })
await scenario('factory: order is title, status, big tabs, buttons, then picker, potential and stacked stages', async () => { await reset(); putStore(rich()); await setAtom('mode', 'factory') }, (t, text) => {
  const order = ['▣ Roblox Radar', 'Drive', '[        RADAR        ]', '[        FACTORY (2)        ]', '[Refresh]', '[More ▸]', 'Prototype', 'Potential', '[ 1  ◆ Pre-validation', '[ 2  ◆ 2-page brief', '[ 9  ◆ Metrics']
  const at = order.map(w => squash(text).indexOf(squash(w)))
  const probs = order.filter((w, k) => at[k] < 0).map(w => `missing "${w}"`)
  for (let k = 1; k < at.length; k++) if (at[k] >= 0 && at[k - 1] >= 0 && at[k] < at[k - 1]) probs.push(`"${order[k]}" appears before "${order[k - 1]}"`)
  return probs
})
await scenario('factory: a stage that happened has a check', async () => { await reset(); putStore(rich()); await setAtom('mode', 'factory'); await setAtom('proto', 'p2') }, (t, text) => (text.includes('✔') ? [] : ['no check on a done stage']))
await scenario('factory: drop-down menu lists the prototypes', async () => { await reset(); putStore(rich()); await setAtom('mode', 'factory'); await setAtom('protoMenu', true) }, need('P001-MONSTER1', 'P002-MONSTER2', 'Show archived', '▴'))
await scenario('factory: no prototypes at all', async () => { await reset(); await setAtom('mode', 'factory') }, need('Choose a prototype', '[ 1  ', 'none here', '[        RADAR        ]'))
await scenario('factory: stage opened with no prototype says so', async () => { await reset(); await setAtom('mode', 'factory'); await setAtom('fstage', 'brief') }, need('No prototype yet', '[← Pipeline]'))
for (const st of ['prevalid', 'brief', 'template', 'doccompleto', 'build', 'titulo', 'thumb', 'publicar', 'metricas']) {
  await scenario(`factory: stage ${st} full screen for prototype 2`, async () => { await reset(); putStore(rich()); await setAtom('mode', 'factory'); await setAtom('proto', 'p2'); await setAtom('fstage', st) }, need('[← Pipeline]', 'Change prototype', 'Open chat'))
}
await scenario('factory: proto 3 archived thumb', async () => { await reset(); putStore(rich()); await setAtom('mode', 'factory'); await setAtom('proto', 'p3'); await setAtom('fstage', 'thumb') })
const REFS = [
  { name: 'Game A', url: 'https://www.roblox.com/games/1', visits: '9.3B', approval_pct: '87%', ccu: '120K', as_of: '2026-11-10', why_fit: 'same loop family', risk: 'fading', tag: 'F' },
  { name: 'Game B', url: 'https://www.roblox.com/games/2', visits: '1.1B', tag: 'H' },
  { name: 'Game C' },
]
const BRIEF_DOC = { name: 'P002-MONSTER2_02_brief_v1', url: 'https://docs.google.com/document/d/AAAAAAAAAAAA/edit', fileId: 'AAAAAAAAAAAA', at: NOW, gen: 1, kind: 'brief' }
const revengState = (patch, extra = {}) => async () => {
  await reset()
  const s = rich()
  Object.assign(s.ideas[1], { stage: 'template', docs: { brief: [BRIEF_DOC] }, ...extra })
  s.ideas[1].reveng = { gen: 0, uploads: {}, segment: 1, mode: 'extract', noEconomy: false, ...patch }
  putStore(s)
  await setAtom('mode', 'factory'); await setAtom('proto', 'p2'); await setAtom('fstage', 'template')
}
const upl = { 1: { at: NOW, files: [{ name: 'P002_03_reveng-input_g1_chunk01.json', kind: 'chunk', index: 1, fileId: 'f1', url: null }, { name: 'P002_03_reveng-input_g1_audit01.json', kind: 'audit', index: 1, fileId: 'f2', url: null }], rejected: [] } }
await scenario('reveng: no reference chosen, candidates from the brief', revengState({}, { refs: { candidates: REFS, chosenIndex: null, history: [] } }), need('Reference candidates (3)', 'Choose', 'Game A', '9.3B visits', 'Risk: fading', 'Reference chosen', 'Copy prompt JSON', 'Upload doc', 'Validate doc', 'Build template doc', 'Choose a reference first.', 'Needs a PASS or PASS WITH GAPS'))
await scenario('reveng: brief done but no candidates shows Find references', revengState({}), need('Find references', 'No reference candidates yet'))
await scenario('reveng: no brief yet says so', async () => { await revengState({})(); const s = JSON.parse(mem.get('rr1') ? JSON.stringify(mem.get('rr1')) : '{}'); s.ideas[1].docs = {}; putStore(s) }, need('Write the brief first'))
await scenario('reveng: reference chosen, upload is next', revengState({}, { refs: { candidates: REFS, chosenIndex: 1, history: [] } }), need('CHOSEN', 'Upload doc', 'next', 'Upload the extraction files first.'))
await scenario('reveng: uploaded, validate is next', revengState({ gen: 1, uploads: upl }, { refs: { candidates: REFS, chosenIndex: 0, history: [] } }), need('batch 1: 1 chunk, 1 audit', 'Validate doc', 'Economy game'))
await scenario('reveng: FAIL verdict keeps upload and validate live', revengState({ gen: 1, uploads: upl, verdict: 'FAIL', verdictReason: 'coverage 2 of 6 chunks' }, { refs: { candidates: REFS, chosenIndex: 0, history: [] } }), need('FAIL', 'coverage 2 of 6 chunks', 'Upload another file set', 'Upload doc', 'Validate doc'))
await scenario('reveng: PASS WITH GAPS unlocks Build template doc', revengState({ gen: 1, uploads: upl, verdict: 'PASS WITH GAPS', verdictReason: 'two gaps' }, { refs: { candidates: REFS, chosenIndex: 0, history: [] }, outputs: { template: [{ at: NOW, kind: 'reveng_validation', gen: 1, content: 'Coverage 6 of 6. Two gaps.', skill: [], chosen: [], discarded: [] }] } }), need('PASS WITH GAPS', 'Validation report', 'Coverage 6 of 6', 'Build template doc'))
await scenario('reveng: done with a template doc shows Open doc and the done notice', revengState({ gen: 1, uploads: upl, verdict: 'PASS' }, { refs: { candidates: REFS, chosenIndex: 0, history: [] }, checks: { template: 'done' }, docs: { brief: [BRIEF_DOC], template: [{ name: 'P002-MONSTER2_03_template-doc_v1', url: 'https://docs.google.com/document/d/BBBBBBBBBBBB/edit', fileId: 'BBBBBBBBBBBB', at: NOW, gen: 1, kind: 'template-doc' }] } }), need('Reverse engineering is done', '<link Open doc>', 'P002-MONSTER2_03_template-doc_v1', 'Advance to'))
await scenario('reveng: Advance is off until the stage is done', revengState({}, { refs: { candidates: REFS, chosenIndex: 0, history: [] } }), need('Finish Reverse engineering first.'))
await scenario('brief stage shows the references on its card, without Choose buttons', async () => { await reset(); const s = rich(); s.ideas[1].stage = 'brief'; s.ideas[1].docs = { brief: [BRIEF_DOC] }; s.ideas[1].refs = { candidates: REFS, chosenIndex: null, history: [] }; putStore(s); await setAtom('mode', 'factory'); await setAtom('proto', 'p2'); await setAtom('fstage', 'brief') }, (t, text) => (/Choose/.test(text) ? ['Choose button on the brief card'] : need('Reference candidates (3)', 'Game A', 'Write 2-page brief')(t, text)))
await scenario('the stage is called Reverse engineering on the map', async () => { await reset(); putStore(rich()); await setAtom('mode', 'factory'); await setAtom('proto', 'p2') }, (t, text) => (/Template match/i.test(text) ? ['old name still shown'] : need('Reverse engineering')(t, text)))
for (const cols of [60, 130]) {
  await scenario(`tier ${cols}: reveng panel`, revengState({ gen: 1, uploads: upl, verdict: 'PASS WITH GAPS' }, { refs: { candidates: REFS, chosenIndex: 0, history: [] } }), need('Validate doc'), cols)
}
await scenario('factory: gate waiting / block', async () => {
  await reset()
  const s = rich()
  s.ideas[1].gateAsked = { titulo: NOW }
  putStore(s)
  await setAtom('mode', 'factory'); await setAtom('proto', 'p2'); await setAtom('fstage', 'titulo')
})
await scenario('factory: gate block', async () => {
  await reset()
  const s = rich()
  s.ideas[1].gateAsked = { titulo: '2020-01-01T00:00:00.000Z' }
  s.ideas[1].gate = { titulo: { verdict: 'BLOCK', reason: 'r', at: NOW } }
  putStore(s)
  await setAtom('mode', 'factory'); await setAtom('proto', 'p2'); await setAtom('fstage', 'titulo')
})
await scenario('factory: selected proto id that no longer exists', async () => { await reset(); await setAtom('mode', 'factory'); await setAtom('proto', 'ghost') })
await scenario('factory: more open on a stage', async () => { await reset(); putStore(rich()); await setAtom('mode', 'factory'); await setAtom('proto', 'p2'); await setAtom('more', true) })
await scenario('old store shape (no inbox, no protoSeq, not migrated)', async () => {
  await reset()
  mem.set('rr1', { threads: {}, archive: {}, instructions: {}, log: {}, ideas: [{ id: 'o1', title: 'Old', note: '', origin: 'own', from: null, stage: 'brief', status: 'pending', proto_id: 'RB-1', created: NOW, updated: NOW, history: [] }, { id: 'o2', title: 'Loose', note: '', origin: 'own', from: null, stage: 'prevalid', status: 'pending', proto_id: null, created: NOW, updated: NOW, history: [] }], knowledge: {}, seeded: true, memory: {}, outbox: [], memSaved: 0, restoredAt: NOW, jobs: {}, stageChats: {} })
  await setAtom('mode', 'factory')
})

for (const cols of [60, 90, 130]) {
  await scenario(`tier ${cols}: radar map`, reset, need('[ 1  '), cols)
  await scenario(`tier ${cols}: radar collection`, async () => { await reset(); await setAtom('rstage', 'coleta') }, need('google_trends'), cols)
  await scenario(`tier ${cols}: radar advisor`, async () => { await reset(); await setAtom('rstage', 'triagem') }, need('Send to Factory'), cols)
  await scenario(`tier ${cols}: radar inbox`, async () => { await reset(); putStore(rich()); await setAtom('rstage', 'inbox') }, need('Skate park'), cols)
  await scenario(`tier ${cols}: factory map`, async () => { await reset(); putStore(rich()); await setAtom('mode', 'factory'); await setAtom('proto', 'p2') }, need('Potential'), cols)
  await scenario(`tier ${cols}: factory menu open`, async () => { await reset(); putStore(rich()); await setAtom('mode', 'factory'); await setAtom('protoMenu', true) }, need('P001-MONSTER1'), cols)
  await scenario(`tier ${cols}: factory titles stage`, async () => { await reset(); putStore(rich()); await setAtom('mode', 'factory'); await setAtom('proto', 'p2'); await setAtom('fstage', 'titulo') }, need('Mud Kings'), cols)
  await scenario(`tier ${cols}: factory thumb stage`, async () => { await reset(); putStore(rich()); await setAtom('mode', 'factory'); await setAtom('proto', 'p3'); await setAtom('fstage', 'thumb') }, need('Close up'), cols)
  await scenario(`tier ${cols}: factory more open`, async () => { await reset(); putStore(rich()); await setAtom('mode', 'factory'); await setAtom('proto', 'p2'); await setAtom('fstage', 'brief'); await setAtom('more', true) }, null, cols)
  await scenario(`tier ${cols}: radar more open`, async () => { await reset(); await setAtom('rstage', 'coleta'); await setAtom('more', true) }, null, cols)
}
await scenario('factory: documents give Open doc on the card and the stage, Open folder in the header, a failure notice', async () => {
  await reset()
  const s = rich()
  s.ideas[1].driveFolderId = 'FOLD'
  s.ideas[1].driveFolderUrl = 'https://drive.google.com/drive/folders/FOLDERIDFOLDERID'
  s.ideas[1].docs = { brief: [{ name: 'P002-MONSTER2_02_brief_v1', url: 'https://docs.google.com/document/d/AAAAAAAAAAAA/edit', fileId: 'AAAAAAAAAAAA', at: NOW, gen: 1, kind: 'brief' }] }
  s.ideas[1].docWarn = { 'https://docs.google.com/document/d/AAAAAAAAAAAA/edit': 'it is not inside the prototype folder' }
  s.ideas[1].failed = { brief: { reason: 'no connector', at: NOW } }
  putStore(s)
  await setAtom('mode', 'factory'); await setAtom('proto', 'p2')
}, need('<link Open folder>', '<link Open doc>', 'Prototype folder'.slice(0, 0)))
await scenario('factory: stage panel lists documents and the failure', async () => {
  await reset()
  const s = rich()
  s.ideas[1].docs = { brief: [{ name: 'P002-MONSTER2_02_brief_v1', url: 'https://docs.google.com/document/d/AAAAAAAAAAAA/edit', fileId: 'AAAAAAAAAAAA', at: NOW, gen: 1, kind: 'brief' }] }
  s.ideas[1].docWarn = { 'https://docs.google.com/document/d/AAAAAAAAAAAA/edit': 'it is not inside the prototype folder' }
  s.ideas[1].failed = { brief: { reason: 'no connector', at: NOW } }
  putStore(s)
  await setAtom('mode', 'factory'); await setAtom('proto', 'p2'); await setAtom('fstage', 'brief')
}, need('<link Open doc>', 'Documents (1)', 'P002-MONSTER2_02_brief_v1', 'not inside the prototype folder', 'Failed: no connector'))
await scenario('a drawing error never leaves a blank pane', async () => { await reset(); const s = base(); s.ideas = 'broken'; putStore(s) }, need('Back to Radar', 'could not draw'))

const dumpName = process.argv.includes('--dump') ? process.argv[process.argv.indexOf('--dump') + 1] : null
for (const r of results) {
  console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}`)
  for (const p of r.problems.slice(0, 6)) console.log(`       ${p}`)
  if (dumpName && r.name.includes(dumpName)) console.log(r.text.split(String.fromCharCode(10)).map(l => `     | ${l}`).join(String.fromCharCode(10)))
}
if (process.env.PARITY_OUT) {
  const { writeFileSync } = await import('node:fs')
  writeFileSync(process.env.PARITY_OUT, JSON.stringify(signatures, null, 1))
}
console.log(failures === 0 ? 'SMOKE OK' : `SMOKE FAILED: ${failures}`)
process.exit(failures === 0 ? 0 : 1)
