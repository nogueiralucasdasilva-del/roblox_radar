// Phase 4: one prototype walks all nine Factory stages on the fixture replies, through the real parser and state code.
// Each stage logs one report line so a failure names the stage and the first wrong field.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import { actionsFor } from '../hooks/actions'
import { advanceIdea, applyParsed, archiveIdea, createPrototype, docLinks, isArchived, markAsked, resolveGates } from '../hooks/factory'
import { IDEA_STAGES, emptyStore } from '../hooks/model'
import { parseTags } from '../hooks/outputs'

const ROOT = path.join(import.meta.dirname, '..', 'data', 'selftest')
const read = (...p: string[]) => readFileSync(path.join(ROOT, ...p), 'utf8')
const NOW = '2026-11-11T12:00:00.000Z'

// stage -> fixture reply, the output kind it must produce, and whether a document is registered
const STEPS: Record<string, { reply: string[]; kind: string; docs: number }> = {
  prevalid: { reply: ['prevalid', 'reply_plain.txt'], kind: 'scan', docs: 0 },
  brief: { reply: ['reply_brief.txt'], kind: 'brief', docs: 1 },
  template: { reply: ['reply_reveng_validation.txt'], kind: 'reveng_validation', docs: 1 },
  titulo: { reply: ['reply_titles.txt'], kind: 'titles', docs: 0 },
  thumb: { reply: ['reply_thumb_prompts.txt'], kind: 'thumb_prompts', docs: 0 },
  doccompleto: { reply: ['reply_fulldoc.txt'], kind: 'fulldoc', docs: 1 },
  build: { reply: ['reply_build_plan.txt'], kind: 'build_plan', docs: 1 },
  publicar: { reply: ['reply_launch.txt'], kind: 'launch', docs: 0 },
  metricas: { reply: ['reply_results.txt'], kind: 'results', docs: 0 },
}

test('the fixture steps cover exactly the nine stages', () => {
  assert.deepEqual(Object.keys(STEPS), [...IDEA_STAGES])
})

test('one prototype walks every stage: ask, reply, output, advance (gate PASS WITH RISKS), then archive', () => {
  const store = emptyStore()
  const i = createPrototype(store, { title: 'Soup Dash', note: '', origin: 'own', from: null, now: NOW })
  const report: string[] = []
  for (const stage of IDEA_STAGES) {
    const step = STEPS[stage]!
    assert.equal(i.stage, stage, `the prototype should be at ${stage}`)
    const act = actionsFor(stage)[0]
    assert.ok(act, `${stage}: no action to start it`)
    markAsked(i, stage, act!.kind, 1, [], NOW, act!.key)
    assert.equal(i.checks![stage], 'asked', `${stage}: not marked asked`)
    const parsed = parseTags(read(...step.reply))
    applyParsed(i, parsed, NOW)
    const out = i.outputs?.[stage]?.[0]
    const wrong = !out ? 'no output stored' : out.kind !== step.kind ? `output kind ${out.kind}, expected ${step.kind}` : docLinks(i, stage).length !== step.docs ? `docs ${docLinks(i, stage).length}, expected ${step.docs}` : i.failed?.[stage] ? 'stage marked failed' : null
    report.push(`${stage.padEnd(12)} ${wrong ? `NOT WORKING: ${wrong}` : 'works'}`)
    assert.equal(wrong, null, `${stage}: ${wrong}`)
    if (stage !== IDEA_STAGES[IDEA_STAGES.length - 1]) {
      i.gateAsked = { ...(i.gateAsked ?? {}), [stage]: NOW }
      applyParsed(i, parseTags(read('reply_gate.txt').replace('stage=brief', `stage=${stage}`)), '2026-11-11T12:05:00.000Z')
      assert.equal(i.gate?.[stage]?.verdict, 'PASS WITH RISKS', `${stage}: gate not stored`)
      assert.equal(resolveGates(i, '2026-11-11T12:06:00.000Z'), true, `${stage}: did not advance`)
    } else {
      assert.equal(advanceIdea(i, NOW), false, 'metricas is the last stage')
    }
  }
  archiveIdea(i, true, NOW)
  assert.equal(isArchived(i), true)
  console.log(report.join('\n'))
})

test('a failed ask never advances and shows its reason on that stage only', () => {
  const store = emptyStore()
  const i = createPrototype(store, { title: 'Soup Dash', note: '', origin: 'own', from: null, now: NOW })
  markAsked(i, 'prevalid', 'scan', 1, [], NOW, 'scan')
  applyParsed(i, parseTags(read('reply_fail.txt').replace(/stage=\S+/, 'stage=prevalid')), NOW)
  assert.ok(i.failed?.prevalid?.reason)
  assert.equal(i.stage, 'prevalid')
  assert.equal(i.failed?.brief, undefined)
})
