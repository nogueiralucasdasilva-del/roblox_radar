import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createPrototype } from '../hooks/factory'
import { emptyStore } from '../hooks/model'
import { applyProtoDocs, docNameFor, fillPrompt, nextGen, parsePotential, parseStatus, potentialDocText, statusDocText, STATUS_STAGES } from '../hooks/protodocs'

const NL = String.fromCharCode(10)
const NOW = '2026-11-12T10:30:00.000Z'

test('the first status document parses back to nine "not started" rows, with the chat and folder links', () => {
  const t = statusDocText('P003-ATRAVES', 'Cross without splash', 'https://drive.google.com/drive/folders/FOLDER123456', 'https://claude.ai/code/session_abc', NOW)
  const p = parseStatus(t)
  assert.equal(p.ok, true)
  assert.equal(p.chat, 'https://claude.ai/code/session_abc')
  assert.equal(p.folder, 'https://drive.google.com/drive/folders/FOLDER123456')
  assert.equal(Object.keys(p.rows).length, 9)
  assert.ok(STATUS_STAGES.every(s => p.rows[s]!.status === 'not started'))
  assert.equal(p.current, 'Pre-validation')
})

test('a chat-updated status document gives statuses, document names, links and dates', () => {
  const t = [
    'STATUS | P003-ATRAVES | x | updated 2026-11-12 11:00',
    'CHAT: https://claude.ai/code/session_abc',
    'CURRENT STAGE: 2-page brief',
    '1 Pre-validation       done   P003-ATRAVES_01_scan_v2 https://docs.google.com/document/d/AAAAAAAAAAAA/edit  2026-11-12',
    '2 2-page brief         asked',
    '3 Reverse engineering  failed',
    '4 Title                not started',
  ].join(NL)
  const p = parseStatus(t)
  assert.equal(p.rows.prevalid!.status, 'done')
  assert.equal(p.rows.prevalid!.doc, 'P003-ATRAVES_01_scan_v2')
  assert.equal(p.rows.prevalid!.url, 'https://docs.google.com/document/d/AAAAAAAAAAAA/edit')
  assert.equal(p.rows.prevalid!.updated, '2026-11-12')
  assert.equal(p.rows.brief!.status, 'asked')
  assert.equal(p.rows.template!.status, 'failed')
  assert.equal(nextGen(p.rows.prevalid), 3)
  assert.equal(nextGen(p.rows.brief), 1)
})

test('garbage and CRLF never throw', () => {
  assert.equal(parseStatus('').ok, false)
  assert.equal(parseStatus('nothing here').ok, false)
  assert.equal(parsePotential('').ok, false)
  const crlf = statusDocText('P001-X', 'x', null, null, NOW).split(NL).join(String.fromCharCode(13, 10))
  assert.equal(parseStatus(crlf).ok, true)
})

test('the potential document parses the label, the percent and the eight criteria', () => {
  const t = [
    'POTENTIAL: MEDIUM   (overall score: 58%)',
    'CONFIDENCE: low',
    'CRITERIA                       score    confidence       evidence',
    'Emerging demand                62       medium           search interest rising [F]',
    'Timing                         55       low              holiday window [H]',
    'Competition (space)            40       medium           two old games own the verb [F]',
    'Clickability                   70       low              clear in 2 seconds [I]',
    'Virality                       75       low              clippable [H]',
    'Co-play                        60       low              pairs well [V]',
    'Feasibility (1 hour MVP)       80       medium           simple [I]',
    'Safety                         95       medium           no IP risk [H]',
    'Not assessed: loop, retention, monetization',
  ].join(NL)
  const p = parsePotential(t)
  assert.equal(p.ok, true)
  assert.equal(p.label, 'MEDIUM')
  assert.equal(p.pct, 58)
  assert.equal(p.confidence, 'low')
  assert.deepEqual(Object.keys(p.criteria).sort(), ['clickability', 'demand', 'feasibility', 'safety', 'social_coplay', 'timing', 'virality', 'whitespace'])
  assert.equal(p.criteria.demand!.v, 62)
  assert.equal(p.criteria.demand!.t, 'F')
  assert.equal(p.criteria.social_coplay!.t, 'V')
  assert.equal(parsePotential(potentialDocText('P1-X', 'x', NOW)).ok, false)
})

test('prompt placeholders are filled and a missing one stays visible', () => {
  const out = fillPrompt('A {{proto_id}} B {{folder_url}} C {{gen}} D {{reveng_links}}', { proto_id: 'P003-X', folder_url: 'https://f', gen: 2 })
  assert.equal(out, 'A P003-X B https://f C 2 D <reveng_links>')
  assert.equal(docNameFor('P003-X', 'status'), 'P003-X_00_status')
})

test('applyProtoDocs copies statuses, document links, current stage and potential scores onto the prototype', () => {
  const i = createPrototype(emptyStore(), { title: 'Soup', note: '', origin: 'own', from: null, now: NOW })
  const status = parseStatus([
    'CHAT: https://claude.ai/code/session_abc',
    'CURRENT STAGE: 2-page brief',
    '1 Pre-validation       done   P003-ATRAVES_01_scan_v1 https://docs.google.com/document/d/AAAAAAAAAAAA/edit  2026-11-12',
    '2 2-page brief         asked',
    '3 Reverse engineering  failed',
  ].join(NL))
  const potential = parsePotential(['POTENTIAL: MEDIUM (overall score: 58%)', 'Timing                         55       low              holiday window [H]'].join(NL))
  applyProtoDocs(i, status, potential, NOW)
  assert.equal(i.checks!.prevalid, 'done')
  assert.equal(i.checks!.brief, 'asked')
  assert.equal(i.checks!.template, undefined)
  assert.ok(i.failed!.template)
  assert.equal(i.stage, 'brief')
  assert.equal(i.docs!.prevalid![0]!.name, 'P003-ATRAVES_01_scan_v1')
  assert.equal(i.docs!.prevalid![0]!.kind, 'scan')
  assert.equal(i.scores![0]!.criteria.timing!.v, 55)
  assert.equal(i.chat!.link, 'https://claude.ai/code/session_abc')
  // a second read with the same content changes nothing (no duplicate documents or scores)
  applyProtoDocs(i, status, potential, NOW)
  assert.equal(i.docs!.prevalid!.length, 1)
  assert.equal(i.scores!.length, 1)
})
