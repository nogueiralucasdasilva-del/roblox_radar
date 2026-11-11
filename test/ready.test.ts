import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import { evalChatTools, evalDrive, evalDuplicates, evalFolders, evalRadar, evalScheduled, evalSelftest, evalSkills, overallLevel } from '../hooks/ready'
import { GOLDEN_FILES, runGolden } from '../hooks/selftest'
import { declaredActions, parseSeedVersion } from '../hooks/skills'
import type { SkillsState } from '../hooks/skills'

const NOW = Date.parse('2026-11-11T18:00:00.000Z')
const f = (name: string, version: number | null, actions: string[] = []) => ({ name, modified: '2026-11-11T10:00:00.000Z', version, actions })

function skills(over: Record<string, ReturnType<typeof f>[]> = {}): SkillsState {
  const files: Record<string, ReturnType<typeof f>[]> = {
    prevalid: [f('skill_prevalid_scan.md', 2, ['scan'])],
    brief: [f('skill_brief_document.md', 1, ['brief', 'refs'])],
    reveng: [f('skill_reveng_validate.md', 1)],
    doccompleto: [f('skill_fulldoc.md', 1, ['fulldoc'])],
    build: [f('skill_build_plan_output.md', 1, ['build'])],
    titulo: [f('skill_titulo_output.md', 1, ['titles'])],
    thumb: [f('skill_thumb_output.md', 1, ['thumb'])],
    publicar: [f('skill_launch_output.md', 1, ['launch'])],
    metricas: [f('skill_results_output.md', 1, ['results'])],
    _all: [f('skill_output_protocol.md', 2)],
    ...over,
  }
  const ids = Object.fromEntries(Object.keys(files).map(k => [k, `id-${k}`]))
  return { at: '', ok: true, rootId: 'root', ids, files }
}
const stages = [{ id: 'template', skills_folder: 'reveng' }]

test('seed_version and declared actions are read from a skill file', () => {
  assert.equal(parseSeedVersion('# Title' + String.fromCharCode(10) + String.fromCharCode(10) + 'seed_version: 2 (replaces v1)'), 2)
  assert.equal(parseSeedVersion('no version'), null)
  assert.deepEqual(declaredActions('# Brief (actions: brief, refs)  and (action: Scan)'), ['brief', 'refs', 'scan'])
})

test('ready check: skills per stage are green with files and protocol v2, red when a folder is empty or the protocol is old', () => {
  assert.equal(evalSkills(skills(), stages).level, 'green')
  const empty = evalSkills(skills({ thumb: [] }), stages)
  assert.equal(empty.level, 'red')
  assert.ok(empty.text.includes('thumb'))
  const old = evalSkills(skills({ _all: [f('skill_output_protocol.md', 1)] }), stages)
  assert.equal(old.level, 'red')
  assert.ok(old.text.includes('needs 2'))
  assert.equal(evalSkills(skills({ _all: [] }), stages).level, 'red')
  assert.equal(evalSkills(null, stages).level, 'red')
})

test('ready check: Reverse engineering reads its files from reveng, not from template', () => {
  const st = skills({ template: [f('old_schema.md', 1)], reveng: [] })
  assert.equal(evalSkills(st, stages).level, 'red')
  assert.ok(evalSkills(st, stages).text.includes('reveng'))
})

test('ready check: duplicate actions, newer wins is amber, same version is red', () => {
  assert.equal(evalDuplicates(skills()).level, 'green')
  const newer = evalDuplicates(skills({ prevalid: [f('a.md', 1, ['scan']), f('b.md', 2, ['scan'])] }))
  assert.equal(newer.level, 'amber')
  assert.ok(newer.text.includes('the newer wins'))
  const same = evalDuplicates(skills({ prevalid: [f('a.md', 2, ['scan']), f('b.md', 2, ['scan'])] }))
  assert.equal(same.level, 'red')
})

test('ready check: chat tools, Drive probes, folders, scheduled tasks', () => {
  assert.equal(evalChatTools(['mcp__ccd_session__start_session', 'mcp__ccd_window__open_session_in', 'mcp__ccd_session_mgmt__list_sessions', 'mcp__ccd_session_mgmt__list_events']).level, 'green')
  const missing = evalChatTools(['mcp__ccd_session__start_session'])
  assert.equal(missing.level, 'red')
  assert.ok(missing.text.includes('open_session_in'))
  assert.equal(evalDrive({ ok: true }, { ok: true }, { ok: true, trashed: true }).level, 'green')
  assert.equal(evalDrive({ ok: true }, { ok: true }, { ok: true, trashed: false }).level, 'amber')
  assert.equal(evalDrive({ ok: true }, { ok: false, error: 'denied' }, { ok: true, trashed: true }).level, 'red')
  assert.equal(evalFolders([{ name: 'skills', ok: true }, { name: 'receipts', ok: false, error: 'not found' }]).level, 'red')
  assert.equal(evalScheduled({ ok: false }).level, 'amber')
  assert.equal(evalScheduled({ ok: true }).level, 'green')
})

test('ready check: radar freshness names the dead legs and goes amber then red with age', () => {
  const items = [{ name: 'a', status: 'ok' }, { name: 'b', status: 'stale' }, { name: 'rblxdb_x', status: 'dead' }, { name: 'c', status: 'skipped_cost' }]
  const fresh = evalRadar({ finished_utc: '2026-11-11T16:00:00Z', items }, NOW)
  assert.equal(fresh.level, 'green')
  assert.ok(fresh.text.includes('1 ok, 2 stale, 1 dead (rblxdb_x)'))
  assert.equal(evalRadar({ finished_utc: '2026-11-10T10:00:00Z', items }, NOW).level, 'amber')
  assert.equal(evalRadar({ finished_utc: '2026-11-08T10:00:00Z', items }, NOW).level, 'red')
  assert.equal(evalRadar(null, NOW).level, 'red')
})

test('overall level and the self-test line', () => {
  assert.equal(overallLevel([{ id: 'a', label: '', level: 'green', text: '' }, { id: 'b', label: '', level: 'amber', text: '' }]), 'amber')
  assert.equal(evalSelftest(null).level, 'amber')
  assert.equal(evalSelftest([{ file: 'x', ok: false, detail: 'bad field' }]).level, 'red')
  assert.equal(evalSelftest([{ file: 'x', ok: true, detail: 'ok' }]).level, 'green')
})

// The golden fixtures shipped in data/selftest must pass through the real parser and state code.
const SELFDIR = path.join(import.meta.dirname, '..', 'data', 'selftest')
const golden = readdirSync(SELFDIR)
  .filter(n => n.startsWith('reply_'))
  .map(n => ({ name: n, text: readFileSync(path.join(SELFDIR, n), 'utf8') }))

test('every golden reply passes its expectations (self-test)', () => {
  const res = runGolden(golden)
  assert.deepEqual(res.filter(r => !r.ok), [])
  assert.equal(res.length, GOLDEN_FILES.length)
})

test('the self-test names the file and the first wrong field when something is off', () => {
  const broken = golden.map(g => (g.name === 'reply_titles.txt' ? { ...g, text: g.text.replace('5. Don', 'Don') } : g))
  const bad = runGolden(broken).filter(r => !r.ok)
  assert.equal(bad.length, 1)
  assert.equal(bad[0]!.file, 'reply_titles.txt')
  assert.ok(bad[0]!.detail.includes('expected 5'))
  const missing = runGolden(golden.filter(g => g.name !== 'reply_fail.txt')).filter(r => !r.ok)
  assert.equal(missing[0]!.file, 'reply_fail.txt')
})

test('a render callback that returns nothing fails the self-test', () => {
  const only = golden.filter(g => g.name === 'reply_brief.txt')
  const res = runGolden(only, () => null).find(r => r.file === 'reply_brief.txt')!
  assert.equal(res.ok, false)
  assert.ok(res.detail.includes('rendered empty'))
  assert.equal(runGolden(only, () => ({})).find(r => r.file === 'reply_brief.txt')!.ok, true)
})
