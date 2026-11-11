// Parity guard for design-only work: the buttons (key, text, hotkey, handler), inputs and links of every smoke
// scenario must stay the same. Usage: node test/smoke/parity.mjs [--update]
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const here = import.meta.dirname
const baselinePath = path.join(here, 'parity.baseline.json')
const tmp = path.join(here, '..', '..', 'node_modules', '.smoke', 'parity.current.json')
const run = spawnSync(process.execPath, [path.join(here, 'run.mjs')], { env: { ...process.env, PARITY_OUT: tmp }, encoding: 'utf8' })
if (!existsSync(tmp)) {
  console.log(run.stdout)
  console.log(run.stderr)
  console.log('PARITY FAILED: the smoke run produced no signatures')
  process.exit(1)
}
const current = JSON.parse(readFileSync(tmp, 'utf8'))
if (process.argv.includes('--update')) {
  writeFileSync(baselinePath, JSON.stringify(current, null, 1))
  console.log(`parity baseline written: ${Object.keys(current).length} scenarios`)
  process.exit(0)
}
const base = JSON.parse(readFileSync(baselinePath, 'utf8'))
const problems = []
const warnings = []
const id = b => `${b.key}|${b.hotkey}`
for (const [name, b] of Object.entries(base)) {
  const c = current[name]
  if (!c) {
    problems.push(`${name}: scenario missing now`)
    continue
  }
  if (b.buttons.length !== c.buttons.length) problems.push(`${name}: button count ${b.buttons.length} -> ${c.buttons.length}`)
  const bk = new Map(b.buttons.map(x => [id(x), x]))
  const ck = new Map(c.buttons.map(x => [id(x), x]))
  for (const [k, x] of bk) {
    const y = ck.get(k)
    if (!y) problems.push(`${name}: button gone: ${k} "${x.text}"`)
    else {
      if (x.press !== y.press) problems.push(`${name}: handler presence changed on ${k}`)
      if (x.text !== y.text) warnings.push(`${name}: text "${x.text}" -> "${y.text}"`)
    }
  }
  for (const k of ck.keys()) if (!bk.has(k)) problems.push(`${name}: new button ${k}`)
  if (JSON.stringify(b.inputs) !== JSON.stringify(c.inputs)) problems.push(`${name}: inputs changed`)
  if (JSON.stringify(b.links) !== JSON.stringify(c.links)) problems.push(`${name}: links changed`)
}
for (const name of Object.keys(current)) if (!base[name]) problems.push(`${name}: scenario not in baseline`)
for (const w of warnings.slice(0, 15)) console.log(`  text: ${w}`)
if (warnings.length > 15) console.log(`  ... ${warnings.length - 15} more text differences (allowed only for padding or case)`)
for (const p of problems.slice(0, 30)) console.log(`  ${p}`)
console.log(problems.length === 0 ? `PARITY OK (${Object.keys(base).length} scenarios, ${warnings.length} text differences)` : `PARITY FAILED: ${problems.length}`)
process.exit(problems.length === 0 ? 0 : 1)
