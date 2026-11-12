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

test('summary lines under SUMMARIES never overwrite a stage row', () => {
  const t = ['1 Pre-validation       done   P003-ATRAVES_01_scan_v1 2026-11-12', 'SUMMARIES (one line per finished stage):', '1 Pre-validation: MEDIUM 59 percent, adjust the angle', 'DECISIONS: none'].join(NL)
  const p = parseStatus(t)
  assert.equal(p.rows.prevalid!.status, 'done')
  assert.equal(p.rows.prevalid!.doc, 'P003-ATRAVES_01_scan_v1')
})

test('the real P003 documents written by the chat parse: two stages done, the brief document, eight criteria', () => {
  const BS = String.fromCharCode(92)
  const esc = (t: string) => t.replace(/([_\[\]!])/g, `${BS}$1`)
  const status = [
    'STATUS | P003-ATRAVES | Cross without making a splash | updated 2026-11-12 17:25', '',
    'IDEA: Atravessar sem fazer splash (DONT SPLASH). 1 jogo, 65 mil e caindo.', '',
    'CHAT: not available (no link given in the request)', '',
    'FOLDER: https://drive.google.com/drive/folders/1EOIMhQDRDu19MTl5WGlOVQ78M18Ggl', '',
    'CURRENT STAGE: 2-page brief', '',
    'STAGE STATUS DOCUMENT UPDATED', '',
    '1 Pre-validation done P003-ATRAVES_01_scan_v1 https://docs.google.com/document/d/1ewEjo9iY8sskJW0gFS7wQW97l-S_Dk9kHFmwqOb8Hz0/edit 2026-11-12', '',
    '2 2-page brief done P003-ATRAVES_02_brief_v1 https://docs.google.com/document/d/1ZzMCwdn0iJjN5oEGXcJBVy5Ma_FRukn-m7EfKGwft6k/edit 2026-11-12', '',
    '3 Reverse engineering not started', '', '4 Title not started', '',
    'SUMMARIES:', '', '1 Pre-validation (2026-11-12): MEDIUM 59%, ADJUST.', '',
  ].join(NL)
  const p = parseStatus(status)
  assert.equal(p.rows.prevalid!.status, 'done')
  assert.equal(p.rows.brief!.status, 'done')
  assert.equal(p.rows.brief!.doc, 'P003-ATRAVES_02_brief_v1')
  assert.ok(p.rows.brief!.url!.startsWith('https://docs.google.com/document/d/1ZzMCwdn0iJjN5oEGXcJBVy5Ma_FRukn-m7EfKGwft6k'))
  assert.equal(p.rows.template!.status, 'not started')
  assert.equal(p.current, '2-page brief')
  assert.equal(p.chat, null)
  const potential = [
    'POTENTIAL: MEDIUM (overall score: 64%)', '', 'CONFIDENCE: low', '',
    'CRITERIA score confidence evidence', '',
    'Emerging demand 78 medium Leader 285.4M visits, 7-day average 72K, peak 167K on 2026-11-01 (2026-11-12). [F]', '',
    'Timing 38 medium Silence format alive 18 months in Quiet or Die!, but a plain copy window is closed. [F]', '',
    'Competition (space) 40 low No game found with a shared team noise meter. [H]', '',
    'Clickability 78 medium One image: friends on a dark flooded path. [I]', '',
    'Virality 72 low One splash wipes the team. [H]', '',
    'Co-play 78 low The shared meter makes friends the core. [H]', '',
    'Feasibility (1 hour MVP) 65 medium One room, noise check and blind chaser. [I]', '',
    'Safety 75 medium Leader rated All Ages (Minimal). [F]', '',
    'Not assessed: loop, retention, monetization',
  ].join(NL)
  const q = parsePotential(potential)
  assert.equal(q.label, 'MEDIUM')
  assert.equal(q.pct, 64)
  assert.equal(Object.keys(q.criteria).length, 8)
  assert.equal(q.criteria.whitespace!.v, 40)
  assert.equal(esc('a_b').includes(BS), true)
})
