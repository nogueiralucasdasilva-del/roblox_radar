import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import { applyParsed, createPrototype } from '../hooks/factory'
import { emptyStore } from '../hooks/model'
import { parseTags } from '../hooks/outputs'
import { peakPercent, parseScan, scanContext, splitTag } from '../hooks/scan'
import { PREVALID_FILES, readPrevalid, runPrevalid } from '../hooks/selftest'
import { potential, DEFAULT_SCORING } from '../hooks/scoring'
import { buildActionRequest, actionByKey } from '../hooks/actions'

const DIR = path.join(import.meta.dirname, '..', 'data', 'selftest', 'prevalid')
const fx = (n: string) => readFileSync(path.join(DIR, n), 'utf8')
const NOW = '2026-11-11T12:00:00.000Z'

test('plain reply: a valid scan with 6 scores, 2 competitors and no knockout', () => {
  const r = readPrevalid(fx('reply_plain.txt'))
  assert.equal(r.found, true)
  assert.equal(r.scan!.ok, true)
  const s = r.scan!.scan!
  assert.equal(s.potential, 'MEDIO')
  assert.equal(s.confidence, 'media')
  assert.equal(s.noun, 'sopa')
  assert.equal(s.verb, 'entregar sem derramar')
  assert.deepEqual(s.wedge, { text: 'corrida de entrega com fisica de derramamento, clipavel em 2 segundos', tag: 'H' })
  assert.equal(s.engine, 'NAO AVALIADO')
  assert.equal(s.fails.tag, 'F')
  assert.equal(s.competitors.length, 2)
  assert.equal(s.competitors[0]!.game, 'Jogo A')
  assert.equal(s.competitors[0]!.peakPct, 14)
  assert.equal(s.competitors[0]!.deadClone, false)
  assert.equal(s.competitors[1]!.deadClone, false)
  assert.equal(s.noKo, true)
  assert.equal(s.evidence.startsWith('radar=nao encontrado'), true)
  assert.deepEqual(r.criteria.sort(), ['clickability', 'demand', 'safety', 'timing', 'virality', 'whitespace'])
})

test('JSON-wrapped, fenced and trailing-space replies give exactly the same result as the plain one', () => {
  const plain = JSON.stringify(readPrevalid(fx('reply_plain.txt')).scan)
  for (const n of ['reply_json_wrapped.json', 'reply_fenced.txt', 'reply_trailing_spaces.txt']) {
    const r = readPrevalid(fx(n))
    assert.equal(r.found, true, n)
    assert.equal(JSON.stringify(r.scan), plain, n)
    assert.equal(r.criteria.length, 6, n)
  }
})

test('CRLF line endings parse the same', () => {
  const crlf = fx('reply_plain.txt').split(String.fromCharCode(10)).join(String.fromCharCode(13, 10))
  assert.equal(JSON.stringify(readPrevalid(crlf).scan), JSON.stringify(readPrevalid(fx('reply_plain.txt')).scan))
})

test('malformed: the scan block is found but invalid, naming the missing keys', () => {
  const r = readPrevalid(fx('reply_malformed.txt'))
  assert.equal(r.found, true)
  assert.equal(r.scan!.ok, false)
  assert.ok(r.scan!.errors[0]!.includes('WEDGE') && r.scan!.errors[0]!.includes('CONFIANCA'))
  assert.equal(r.scan!.raw.includes('POTENCIAL'), true)
})

test('no tags and a quoted example find nothing', () => {
  assert.equal(readPrevalid(fx('reply_no_tags.txt')).found, false)
  assert.equal(readPrevalid(fx('reply_quoted_example_only.txt')).found, false)
})

test('every prevalid fixture passes the self-test expectations', () => {
  const res = runPrevalid(PREVALID_FILES.map(name => ({ name, text: fx(name) })))
  assert.deepEqual(res.filter(r => !r.ok), [])
  assert.equal(res.length, 7)
})

test('POTENCIAL and CONFIANCA values are validated; accents are accepted', () => {
  const base = (pot: string, conf: string) => ['POTENCIAL: ' + pot + ' | x [I]', 'NOUN_VERB: a | b', 'WEDGE: w [H]', 'FUNCIONA: f', 'FALHA: x', 'CONFIANCA: ' + conf].join(String.fromCharCode(10))
  assert.equal(parseScan(base('ALTO', 'alta')).ok, true)
  assert.equal(parseScan(base('MÉDIO', 'média')).ok, true)
  assert.equal(parseScan(base('MEDIO', 'media')).scan!.potential, 'MEDIO')
  const bad = parseScan(base('TALVEZ', 'media'))
  assert.equal(bad.ok, false)
  assert.ok(bad.errors.join(' ').includes('POTENCIAL must be ALTO, MEDIO or BAIXO'))
  assert.ok(parseScan(base('ALTO', 'muito')).errors.join(' ').includes('CONFIANCA'))
  assert.equal(parseScan('').ok, false)
  assert.equal(parseScan('garbage').errors.length > 0, true)
})

test('evidence tags are parsed out, competitors capped at 3, knockouts split with their fix, dead clones flagged', () => {
  assert.deepEqual(splitTag('texto [V]'), { text: 'texto', tag: 'V' })
  assert.deepEqual(splitTag('sem tag'), { text: 'sem tag', tag: null })
  const nl = String.fromCharCode(10)
  const content = [
    'POTENCIAL: BAIXO | verbo morto [I]', 'NOUN_VERB: a | b', 'WEDGE: w [H]', 'FUNCIONA: f [I]', 'FALHA: x [F]',
    'CONCORRENTE: A | 1k agora, pico 50k, 8 meses | morto [F]', 'CONCORRENTE: B | 30k agora, pico 40k (75%) | vivo [F]', 'CONCORRENTE: C | V | nao aberto [V]', 'CONCORRENTE: D | 1 | extra [V]',
    'KO: KO3 saturado | fixable by: outro verbo ; KO6 IP', 'CONFIANCA: baixa',
  ].join(nl)
  const s = parseScan(content).scan!
  assert.equal(s.competitors.length, 3)
  assert.equal(s.competitors[0]!.peakPct, 2)
  assert.equal(s.competitors[0]!.deadClone, true)
  assert.equal(s.competitors[1]!.deadClone, false)
  assert.equal(s.competitors[2]!.peakPct, null)
  assert.equal(s.noKo, false)
  assert.deepEqual(s.knockouts, [{ name: 'KO3 saturado', fix: 'outro verbo' }, { name: 'KO6 IP', fix: null }])
  assert.equal(peakPercent('12k agora, pico 85k'), 14.1)
  assert.equal(peakPercent('sem numeros'), null)
})

test('a valid scan marks the stage done, stores the scan and applies provisional scores (6 of 10 criteria)', () => {
  const s = emptyStore()
  const i = createPrototype(s, { title: 'Soup', note: '', origin: 'own', from: null, now: NOW })
  applyParsed(i, parseTags(fx('reply_plain.txt')), NOW)
  assert.equal(i.checks!.prevalid, 'done')
  assert.equal(i.outputs!.prevalid![0]!.scan!.potential, 'MEDIO')
  assert.equal(i.scores![0]!.provisional, true)
  const p = potential(i.scores, DEFAULT_SCORING)
  assert.equal(p.scored, 5)
  assert.equal(Object.keys(i.scores![0]!.criteria).length, 6)
  assert.equal(i.decision, 'open')
})

test('a malformed scan keeps its raw text, lists the errors and does not mark the stage done', () => {
  const s = emptyStore()
  const i = createPrototype(s, { title: 'Soup', note: '', origin: 'own', from: null, now: NOW })
  applyParsed(i, parseTags(fx('reply_malformed.txt')), NOW)
  assert.notEqual(i.checks!.prevalid, 'done')
  const o = i.outputs!.prevalid![0]!
  assert.equal(o.scan, undefined)
  assert.ok(o.scanErrors![0]!.includes('WEDGE'))
  assert.ok(o.content.includes('POTENCIAL'))
})

test('a later scan is added on top (newest first) and the brief request carries the latest scan context', () => {
  const s = emptyStore()
  const i = createPrototype(s, { title: 'Soup', note: '', origin: 'own', from: null, now: NOW })
  applyParsed(i, parseTags(fx('reply_plain.txt')), NOW)
  const second = fx('reply_plain.txt').replace('gen=1', 'gen=2').replace('POTENCIAL: MEDIO', 'POTENCIAL: ALTO')
  applyParsed(i, parseTags(second), '2026-11-11T13:00:00.000Z')
  assert.equal(i.outputs!.prevalid!.length, 2)
  assert.equal(i.outputs!.prevalid![0]!.scan!.potential, 'ALTO')
  const ctx = scanContext(i.outputs!.prevalid![0]!.scan!)
  assert.ok(ctx.startsWith('POTENCIAL ALTO; WEDGE corrida de entrega'))
  assert.ok(ctx.length <= 600)
  const req = buildActionRequest(actionByKey('brief')!, i, { stageName: '2-page brief', skills: { folder: 'brief', stageFolderId: 'F', allId: 'A' }, protoFolder: { name: i.proto_id!, id: 'P' } })
  assert.ok(req.text.includes('scan=POTENCIAL ALTO'))
  const adjust = buildActionRequest(actionByKey('scan')!, i, { stageName: 'Pre-validation', skills: { folder: 'prevalid', stageFolderId: 'F', allId: 'A' }, protoFolder: { name: i.proto_id!, id: 'P' } }, { adjust: 'make it co-op' })
  assert.ok(adjust.text.includes('adjust=make it co-op'))
  assert.ok(adjust.text.includes('Generation: 3.'))
})

test('a FAIL for the scan returns the action to not started with its reason', () => {
  const s = emptyStore()
  const i = createPrototype(s, { title: 'Soup', note: '', origin: 'own', from: null, now: NOW })
  i.requested = { prevalid: { kind: 'scan', gen: 1, at: NOW, skill: [], action: 'scan' } }
  i.checks = { prevalid: 'asked' }
  applyParsed(i, parseTags('@@FAIL stage=prevalid | Google Drive tools not available in this chat'), NOW)
  assert.equal(i.failed!.prevalid!.reason, 'Google Drive tools not available in this chat')
  assert.equal(i.checks!.prevalid, undefined)
})
