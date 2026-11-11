import assert from 'node:assert/strict'
import { test } from 'node:test'

import { abbrOf, applyParsed, archiveIdea, chatTitleOf, createPrototype, migrateStore, protoIdOf, sendInboxToFactory, newInbox, ensureProto, isPending, markAsked, advanceIdea } from '../hooks/factory'
import { emptyStore, newIdea } from '../hooks/model'
import type { Idea } from '../hooks/model'
import { parseTags, splitItems } from '../hooks/outputs'
import { DEFAULT_SCORING, addScores, bar, overall, parseCriteria, potential, safetyBlocked } from '../hooks/scoring'

const NOW = '2026-11-10T10:00:00.000Z'

test('ABBR is the first significant word, letters only, max 7, with the second initial on collision', () => {
  assert.equal(abbrOf('Monster Truck Tycoon', []), 'MONSTER')
  assert.equal(abbrOf('The Brainrot Bakery', []), 'BRAINRO')
  assert.equal(abbrOf('K-pop tycoon', []), 'K')
  assert.equal(abbrOf('Monster Truck Tycoon', ['MONSTER']), 'MONSTET')
  assert.equal(abbrOf('Monster Truck Tycoon', ['MONSTER', 'MONSTET']), 'MONSTE2')
  assert.equal(abbrOf('123 ???', []), 'IDEA')
  assert.equal(abbrOf('Pão de Queijo', []), 'PAO')
})

test('proto IDs use a 3-digit counter that is never reused, even after an archive', () => {
  const s = emptyStore()
  const a = createPrototype(s, { title: 'Monster Truck', note: '', origin: 'own', from: null, now: NOW })
  const b = createPrototype(s, { title: 'Monster Bakery', note: '', origin: 'own', from: null, now: NOW })
  assert.equal(a.proto_id, 'P001-MONSTER')
  assert.equal(b.proto_id, 'P002-MONSTEB')
  archiveIdea(a, true, NOW)
  const c = createPrototype(s, { title: 'Third', note: '', origin: 'own', from: null, now: NOW })
  assert.equal(c.proto_id, 'P003-THIRD')
  assert.equal(s.protoSeq, 3)
  assert.equal(a.stage, 'prevalid')
  assert.equal(a.status, 'rejected')
  assert.equal(protoIdOf(12, 'X'), 'P012-X')
})

test('chat title is "<id> | <title>" clipped to 58 chars', () => {
  assert.equal(chatTitleOf('P001-MONSTER', 'Monster Truck'), 'P001-MONSTER | Monster Truck')
  assert.ok(chatTitleOf('P001-MONSTER', 'x'.repeat(200)).length <= 58)
})

test('inbox idea sent to the Factory becomes a prototype at pre-validation and leaves the inbox', () => {
  const s = emptyStore()
  s.inbox.push(newInbox('Skate Park', 'n', 'own', null, NOW, 0))
  const idea = sendInboxToFactory(s, s.inbox[0]!.id, NOW)
  assert.ok(idea)
  assert.equal(idea!.stage, 'prevalid')
  assert.equal(idea!.proto_id, 'P001-SKATE')
  assert.equal(s.inbox.length, 0)
  assert.equal(sendInboxToFactory(s, 'nope', NOW), null)
})

test('migration: ideas with proto_id become prototypes in creation order, the rest go to the inbox, rejected stay archived, chats kept', () => {
  const s = emptyStore()
  const mk = (title: string, created: string, extra: Partial<Idea>): Idea => ({ ...newIdea(title, 'n', 'own', null, created, 0), ...extra })
  const chat = { id: 'sess1', title: 't', link: null, at: created0(), syncedAt: null, seen: 0 }
  s.ideas = [
    mk('Zeta game', '2026-10-03T00:00:00.000Z', { proto_id: 'RB-20261003-zeta', stage: 'brief', chat }),
    mk('Loose one', '2026-10-02T00:00:00.000Z', { chat }),
    mk('Alpha game', '2026-10-01T00:00:00.000Z', { proto_id: 'RB-20261001-alpha', stage: 'template' }),
    mk('Dead idea', '2026-10-04T00:00:00.000Z', { status: 'rejected' }),
  ]
  migrateStore(s)
  assert.deepEqual(s.ideas.map(i => i.proto_id), ['P001-ALPHA', 'P002-ZETA', 'P003-DEAD'])
  assert.equal(s.ideas[0]!.legacyProtoId, 'RB-20261001-alpha')
  assert.equal(s.ideas[1]!.chat?.id, 'sess1')
  assert.equal(s.ideas[2]!.status, 'rejected')
  assert.equal(s.inbox.length, 1)
  assert.equal(s.inbox[0]!.title, 'Loose one')
  assert.equal(s.inbox[0]!.chat?.id, 'sess1')
  assert.equal(s.protoSeq, 3)
  const before = JSON.stringify(s)
  migrateStore(s)
  assert.equal(JSON.stringify(s), before)
})
function created0() {
  return NOW
}

const REPLY = [
  'Here are the titles.',
  '@@OUTPUT stage=titulo kind=titles gen=1',
  '1. Monster Truck Bakery',
  '2. Truck Cake Rush',
  '@@END',
  '@@DOC stage=brief | P001 brief | https://docs.google.com/document/d/abc',
  '@@CHOSEN stage=titulo | Truck Cake Rush',
  '@@SCORES {"criteria":{"demand":{"v":80,"c":"medium","e":"trend","t":"F"},"safety":{"v":30,"c":"high","e":"x","t":"H"}}}',
  '@@GATE stage=brief verdict=PASS WITH RISKS | thin evidence',
].join('\n')

test('tags parse, with stage and kind validated', () => {
  const p = parseTags(REPLY)
  assert.equal(p.outputs.length, 1)
  assert.equal(p.outputs[0]!.content, '1. Monster Truck Bakery\n2. Truck Cake Rush')
  assert.equal(p.docs[0]!.url, 'https://docs.google.com/document/d/abc')
  assert.equal(p.chosen[0]!.text, 'Truck Cake Rush')
  assert.equal(p.scores.length, 1)
  assert.deepEqual(p.gates[0], { stage: 'brief', verdict: 'PASS WITH RISKS', reason: 'thin evidence' })
})

test('tags tolerate JSON-wrapped transcripts with escaped newlines', () => {
  const wrapped = JSON.stringify(REPLY)
  assert.equal(parseTags(wrapped).outputs.length, 1)
  const half = REPLY.replace(/\n/g, '\\n')
  const p = parseTags(`prefix text ${half}`.replace('prefix text ', ''))
  assert.equal(p.outputs.length, 1)
  assert.equal(p.gates.length, 1)
})

test('tags inside quoted examples, code fences and placeholders are ignored', () => {
  const text = [
    'End your reply with:',
    '> @@OUTPUT stage=titulo kind=titles gen=1',
    '```',
    '@@OUTPUT stage=titulo kind=titles gen=1',
    'fenced',
    '@@END',
    '```',
    '@@OUTPUT stage=<stageId> kind=<kind> gen=<n>',
    'placeholder',
    '@@END',
    '@@GATE stage=<stageId> verdict=PASS | x',
  ].join('\n')
  const p = parseTags(text)
  assert.equal(p.outputs.length, 0)
  assert.equal(p.gates.length, 0)
})

test('an unterminated output is flagged as truncated', () => {
  const p = parseTags('@@OUTPUT stage=thumb kind=thumb_prompts gen=2\n1. one\n2. two')
  assert.equal(p.outputs[0]!.truncated, true)
})

test('items split on numbering, bullets or paragraphs', () => {
  assert.deepEqual(splitItems('1. alpha\nmore\n2. beta'), ['alpha\nmore', 'beta'])
  assert.deepEqual(splitItems('one\n\ntwo'), ['one', 'two'])
})

test('overall is computed from the weights over the scored criteria, never from the chat', () => {
  const c = parseCriteria({ criteria: { demand: { v: 80, c: 'high', e: 'e', t: 'F' }, timing: { v: 40, c: 'x', e: 'e', t: 'Z' }, bogus: { v: 'a' } }, overall: 99 }, 'prevalid')
  assert.equal(Object.keys(c).length, 2)
  assert.equal(c.timing!.c, 'low')
  assert.equal(c.timing!.t, 'H')
  const o = overall(c, DEFAULT_SCORING)
  assert.equal(o.pct, Math.round((14 * 80 + 12 * 40) / 26))
  assert.equal(o.scored, 2)
  assert.equal(overall({}, DEFAULT_SCORING).pct, 0)
  assert.equal(bar(50), '█████░░░░░')
  const custom = { weights: { demand: 1, timing: 1 }, safety_gate: 40 }
  assert.equal(overall(c, custom).pct, 60)
})

test('score history gives a delta and the safety gate', () => {
  const h: any[] = []
  assert.equal(addScores(h, parseCriteria({ criteria: { demand: { v: 50, c: 'low', e: '', t: 'H' } } }, 'prevalid'), 'prevalid', NOW), true)
  assert.equal(addScores(h, parseCriteria({ criteria: { demand: { v: 50, c: 'low', e: '', t: 'H' } } }, 'prevalid'), 'prevalid', NOW), false)
  assert.equal(addScores(h, parseCriteria({ criteria: { demand: { v: 70, c: 'low', e: '', t: 'H' }, safety: { v: 20, c: 'high', e: '', t: 'F' } } }, 'brief'), 'brief', NOW), true)
  const p = potential(h, DEFAULT_SCORING)
  assert.equal(p.pct, 70)
  assert.equal(p.delta, 20)
  assert.equal(safetyBlocked(h, DEFAULT_SCORING), true)
  assert.equal(potential([], DEFAULT_SCORING).pct, null)
})

test('applying tagged output files it once, sets the check, scores and gate, and is idempotent', () => {
  const s = emptyStore()
  const i = createPrototype(s, { title: 'Truck', note: '', origin: 'own', from: null, now: NOW })
  i.stage = 'titulo'
  markAsked(i, 'titulo', 'titles', 1, [{ name: 'skill_title.md', modified: 'm' }], NOW)
  assert.equal(i.checks!.titulo, 'asked')
  assert.equal(isPending(i, 'titulo'), true)
  const later = '2026-11-10T11:00:00.000Z'
  const r1 = applyParsed(i, parseTags(REPLY), later)
  assert.equal(r1.added >= 2, true)
  assert.equal(i.checks!.titulo, 'done')
  assert.equal(i.checks!.brief, 'done')
  assert.equal(i.outputs!.titulo![0]!.skill[0]!.name, 'skill_title.md')
  assert.deepEqual(i.outputs!.titulo![0]!.chosen, ['Truck Cake Rush'])
  assert.equal(i.scores!.length, 1)
  assert.equal(i.gate!.brief!.verdict, 'PASS WITH RISKS')
  assert.equal(isPending(i, 'titulo'), false)
  const snap = JSON.stringify(i)
  const r2 = applyParsed(i, parseTags(REPLY), '2026-11-10T12:00:00.000Z')
  assert.equal(r2.added, 0)
  assert.equal(JSON.stringify(i), snap)
})

test('advancing moves one stage up and keeps the proto ID; ensureProto fills old ideas', () => {
  const s = emptyStore()
  const i = createPrototype(s, { title: 'Truck', note: '', origin: 'own', from: null, now: NOW })
  const id = i.proto_id
  assert.equal(advanceIdea(i, NOW), true)
  assert.equal(i.stage, 'brief')
  assert.equal(i.proto_id, id)
  const old = newIdea('Old', '', 'own', null, NOW, 0)
  ensureProto(old)
  assert.deepEqual(old.checks, {})
})

import { ACTIONS, buildActionRequest, buildGateRequest } from '../hooks/actions'

test('every action becomes a request only through the request builder: generic, no tags, no work instructions', () => {
  const s = emptyStore()
  const i = createPrototype(s, { title: 'Truck', note: '', origin: 'own', from: null, now: NOW })
  i.refs = { candidates: [{ name: 'A', url: 'https://a.test' }], chosenIndex: 0, history: [] }
  i.reveng = { gen: 1, uploads: { 1: { at: NOW, files: [], rejected: [] } }, segment: 1, mode: 'extract', noEconomy: false, verdict: 'PASS' }
  const ctx = { stageName: 'Stage', skills: { folder: 'FOLDERNAME', stageFolderId: 'FOLDER1', allId: 'ALLID' }, protoFolder: { name: i.proto_id!, id: 'PF1' } }
  for (const a of ACTIONS) {
    const { text, expectedDocName } = buildActionRequest(a, i, { ...ctx, stageName: a.stage })
    const lines = text.split(String.fromCharCode(10))
    assert.ok(lines[0]!.startsWith(`Prototype ${i.proto_id} (Truck). Stage: ${a.stage} (${a.stage}). Action: ${a.label} (${a.key}). Generation: `), a.key)
    assert.ok(lines[1]!.includes('Read every file in both (ignore subfolders)'), a.key)
    assert.ok(lines[1]!.includes('FOLDER1') && lines[1]!.includes('ALLID'), a.key)
    assert.ok(lines[2]!.includes(`using exactly the name ${expectedDocName}`) && lines[2]!.includes('PF1'), a.key)
    assert.ok(expectedDocName.startsWith(`${i.proto_id}_0`), a.key)
    assert.ok(!text.includes('@@'), a.key)
    const p = parseTags(text)
    assert.equal(p.outputs.length + p.gates.length + p.verdicts.length + p.fails.length + p.refs.length, 0, a.key)
    assert.ok(!text.includes(String.fromCharCode(0x2013)) && !text.includes(String.fromCharCode(0x2014)), a.key)
  }
  const g = buildGateRequest(i, 'Pre-validation', 'Brief', { ...ctx, stageName: 'Pre-validation' })
  assert.ok(g.includes('Action: Principles gate (gate)') && g.includes('Params: from=Pre-validation; to=Brief'))
  assert.equal(parseTags(g).gates.length, 0)
})
