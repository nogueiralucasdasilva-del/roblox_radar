// Offline render smoke test: bundles the mod, renders the pane in many states and checks the element tree.
// Usage: node test/smoke/run.mjs [--dump <scenario>]
import { build } from 'esbuild'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..', '..')
const out = path.join(root, 'node_modules', '.smoke', 'bundle.mjs')
await build({
  entryPoints: [path.join(root, 'hooks', 'register.tsx')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: out,
  jsx: 'transform',
  jsxFactory: 'h',
  jsxFragment: 'Fragment',
  inject: [path.join(root, 'test', 'smoke', 'h.mjs')],
  alias: { 'claude-code': path.join(root, 'test', 'smoke', 'host-stub.mjs') },
  logLevel: 'error',
})
const stub = await import(pathToFileURL(path.join(root, 'test', 'smoke', 'host-stub.mjs')).href)
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
  tool: { call: async () => ({ isError: true, text: 'no tool in the smoke test' }), list: async () => [] },
  mcp: { call: async () => { throw new Error('no mcp') } },
  model: { complete: async () => ({ isAnswered: false }) },
  session: { send: async () => ({ isDelivered: false }), surfaces: async () => [] },
  prompt: { submit: async () => ({}) },
  agent: { spawn: async () => ({ deny: 'no' }) },
  clock: { every: () => {} },
  command: { register: async () => {} },
}
const e = { surface: 'desktop', viewport: { columns: 100 }, props: { bodyColumns: 100 }, requestId: 'radar-panel', component: 'Pane' }

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
async function scenario(name, setup, check) {
  try {
    if (setup) await setup()
    const tree = await render($, e)
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

const reset = async () => {
  stub.state.clear()
  mem.clear()
  putStore(base())
}

const need = (...words) => (t, text) => words.filter(w => !text.includes(w)).map(w => `missing "${w}"`)
await scenario('radar map: numbered cards for collection, screening, loose ideas, plus the auditor bar', reset, need('[        RADAR        ]', 'FACTORY', 'v0.7.4', '[ 1  Radar and collection', '[ 2  Screening and advisor', '[ 3  Loose ideas', 'Auditor'))
await scenario('radar: collection card opens full screen with its sources', async () => { await reset(); await setAtom('rstage', 'coleta') }, need('[← Pipeline]', 'Open chat', 'google_trends', '[Sources]'))
await scenario('radar: advisor card opens with the latest report and Send to Factory', async () => { await reset(); await setAtom('rstage', 'triagem') }, need('Send to Factory', 'Latest report is open'))
await scenario('radar: loose ideas card opens with the inbox', async () => { await reset(); putStore(rich()); await setAtom('rstage', 'inbox') }, need('Skate park', '[Send to Factory]', '[Discard]', 'add-inbox', '[← Pipeline]'))
await scenario('radar: auditor opens', async () => { await reset(); await setAtom('rstage', 'auditor') }, need('[← Pipeline]'))
await scenario('radar: garbage values fall back to the map', async () => { await reset(); await setAtom('rstage', 'zzz'); await setAtom('mode', 'nope') }, need('[ 1  Radar and collection'))
await scenario('radar: more open', async () => { await reset(); await setAtom('more', true) })
await scenario('factory: order is title, status, big tabs, buttons, then picker, potential and stacked stages', async () => { await reset(); putStore(rich()); await setAtom('mode', 'factory') }, (t, text) => {
  const order = ['Roblox Radar', 'Drive', '[        RADAR        ]', '[        FACTORY (2)        ]', '[Refresh]', '[More ▸]', 'Prototype', 'Potential', '[ 1  ◆ Pre-validation', '[ 2  ◆ 2-page brief', '[ 9  ◆ Metrics']
  const at = order.map(w => text.indexOf(w))
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
await scenario('factory: template custom + library', async () => {
  await reset()
  const s = rich()
  s.ideas[1].template_mode = 'custom'
  s.ideas[1].refs = '1. a'
  s.ideas[1].research = 'r'
  s.ideas[1].outputs = { template: [{ at: NOW, kind: 'refs', gen: 1, content: '1. ref', skill: [], chosen: [], discarded: [] }], brief: [{ at: NOW, kind: 'brief', gen: 1, content: 'b', skill: [], chosen: [], discarded: [], doc: { title: 'T', url: 'https://x' } }] }
  putStore(s)
  await setAtom('mode', 'factory'); await setAtom('proto', 'p2'); await setAtom('fstage', 'template')
})
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

await scenario('a drawing error never leaves a blank pane', async () => { await reset(); const s = base(); s.ideas = 'broken'; putStore(s) }, need('Back to Radar', 'could not draw'))

const dumpName = process.argv.includes('--dump') ? process.argv[process.argv.indexOf('--dump') + 1] : null
for (const r of results) {
  console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}`)
  for (const p of r.problems.slice(0, 6)) console.log(`       ${p}`)
  if (dumpName && r.name.includes(dumpName)) console.log(r.text.split(String.fromCharCode(10)).map(l => `     | ${l}`).join(String.fromCharCode(10)))
}
console.log(failures === 0 ? 'SMOKE OK' : `SMOKE FAILED: ${failures}`)
process.exit(failures === 0 ? 0 : 1)
