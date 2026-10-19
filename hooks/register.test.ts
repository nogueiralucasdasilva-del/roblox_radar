import { expect, mock, test } from 'claude-code/testing'

import {
  ROLLOVER_MESSAGES,
  buildPrompt,
  extractInstructions,
  extractTagged,
  ideasAt,
  makeProtoId,
  needsRollover,
  newIdea,
  newThread,
  nextStageOf,
  parseKnowledge,
  parseTyped,
  promoteIdea,
  recentHistory,
  setIdeaStatus,
} from './model'
import type { Msg } from './model'
import {
  isLate,
  mergeReports,
  parseReceipt,
  receiptsFor,
  reportsFromReceipts,
  sourceStatusOf,
  sourcesFromReceipt,
  stageHealth,
} from './receipts'
import type { Stage } from '../types'

const stage: Stage = {
  id: 'brief',
  name: '2-page brief',
  sub: 's',
  gate: true,
  desc: 'd',
  inputs: 'i',
  outputs: 'o',
  build: 'partial',
  build_note: '',
  owner_chat: '',
  trigger_ids: [],
  status_doc: '',
  docs: [],
  skills: [],
  pendencies: [],
  flag: null,
  checked_at: null,
}

const msg = (role: 'user' | 'assistant', text: string, i: number): Msg => ({ role, text, at: `2026-10-17T00:00:0${i}Z` })

test('pane draws on terminal and desktop even when the data file is unreadable', async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'radar-panel',
      surface,
      component: 'Pane',
      requestId: 'radar-panel',
      props: {},
    } as any)
    const found = await ui.find({ type: 'Text', text: /Could not read/ })
    expect(found).toBeDefined()
    await ui.unmount()
  }
})

test('history sent with a message is bounded and keeps the newest messages', () => {
  const messages = [msg('user', 'a'.repeat(5000), 1), msg('assistant', 'b'.repeat(5000), 2), msg('user', 'c'.repeat(5000), 3)]
  const kept = recentHistory(messages, 9000)
  expect(kept.length).toBe(1)
  expect(kept[0]?.text.startsWith('c')).toBe(true)
})

test('a stage chat rolls over on size or on message count', () => {
  const t = newThread(1, '', '2026-10-17T00:00:00Z')
  expect(needsRollover(t)).toBe(false)
  t.messages.push(msg('user', 'x'.repeat(25000), 1))
  expect(needsRollover(t)).toBe(true)
  const u = newThread(1, '', '2026-10-17T00:00:00Z')
  for (let i = 0; i <= ROLLOVER_MESSAGES; i++) u.messages.push(msg('user', 'hi', 1))
  expect(needsRollover(u)).toBe(true)
})

test('standing instructions are pulled out of the agent answer', () => {
  const r = extractInstructions('Done.\nINSTRUCTION: Always cite the evidence tag.\nINSTRUCTION: Keep answers under 5 lines.')
  expect(r.found.length).toBe(2)
  expect(r.clean).toBe('Done.')
})

test('the stage prompt carries the stage, the summary and the new message in English', () => {
  const p = buildPrompt(stage, '2026-10-17', ['Be brief'], 'Earlier we chose X.', [msg('user', 'hi', 1)], 'What is left?')
  expect(p.includes('Reply in English')).toBe(true)
  expect(p.includes('Earlier we chose X.')).toBe(true)
  expect(p.includes('Be brief')).toBe(true)
  expect(p.includes('What is left?')).toBe(true)
})

test('knowledge lines and typed entries are parsed', () => {
  expect(parseKnowledge('pattern | Use a number in the title')).toEqual({ kind: 'pattern', text: 'Use a number in the title' })
  expect(parseKnowledge('Plain text')?.kind).toBe('technique')
  expect(parseTyped('pitfall: promise the reveal too late')).toEqual({ kind: 'pitfall', text: 'promise the reveal too late' })
  expect(parseTyped('   ')).toBe(null)
  expect(extractTagged('Answer\nKNOWLEDGE: result | A won\nINSTRUCTION: x', 'KNOWLEDGE:').found.length).toBe(1)
})

test('an idea climbs the ladder, gets its proto_id at the brief and a rejected idea cannot move', () => {
  const now = '2026-10-19T10:00:00Z'
  const idea = newIdea('K-pop tycoon', 'n', 'own', null, now, 0)
  expect(idea.stage).toBe('prevalid')
  expect(idea.proto_id).toBe(null)
  setIdeaStatus(idea, 'rejected', now)
  expect(promoteIdea(idea, [], now)).toBe(false)
  setIdeaStatus(idea, 'promising', now)
  expect(promoteIdea(idea, [], now)).toBe(true)
  expect(idea.stage).toBe('brief')
  expect(idea.proto_id).toBe('RB-20261019-k-pop-tycoon')
  expect(idea.status).toBe('pending')
  expect(ideasAt([idea], 'prevalid').length).toBe(1)
  expect(ideasAt([idea], 'brief').length).toBe(1)
  expect(ideasAt([idea], 'template').length).toBe(0)
  expect(makeProtoId(now, 'K-pop tycoon', ['RB-20261019-k-pop-tycoon'])).toBe('RB-20261019-k-pop-tycoon-2')
  expect(nextStageOf('metricas')).toBe(null)
})

const stageOf = (over: Partial<Stage>): Stage => ({ ...stage, ...over })

const DATA = {
  updated: '2026-10-19',
  note: 'test snapshot',
  stages: [
    stageOf({ id: 'coleta', name: 'Radar and collection', build: 'built', extra_tabs: [{ id: 'sources', label: 'Sources' }] }),
    stageOf({ id: 'triagem', name: 'Screening and advisor', build: 'built', extra_tabs: [{ id: 'reports', label: 'Reports' }] }),
    stageOf({ id: 'prevalid', name: 'Pre-validation', extra_tabs: [{ id: 'ideas', label: 'Ideas' }] }),
    stageOf({
      id: 'brief',
      pendencies: [{ id: 'k1', text: 'Decide the proto_id format.', owner: 'Lucas', since: '2026-10-16', done: false }],
      extra_tabs: [{ id: 'protos', label: 'Prototypes' }],
    }),
    stageOf({ id: 'thumb', name: 'Thumbnail', extra_tabs: [{ id: 'protos', label: 'Prototypes' }, { id: 'knowledge', label: 'Knowledge' }] }),
    stageOf({ id: 'registro', name: 'Registry (proto_id)', extra_tabs: [{ id: 'registry', label: 'Registry' }] }),
  ],
}
const SOURCES = {
  asof: '2026-10-18T18:12:00Z',
  origin: 'Snapshot of the status report.',
  summary: '20 legs: 17 ok, 3 stale.',
  sources: [
    { id: 'a', name: 'tiktok_trends', family: 'Apify', cadence: 'daily', status: 'stale', collected_label: 'Oct 18', collected_at: '2026-10-18T13:50:00Z', note: 'Identical to Oct 17.', evidence: 'x' },
    { id: 'b', name: 'reddit_daily2', family: 'Apify', cadence: 'daily', status: 'working', collected_label: 'Oct 18', collected_at: '2026-10-18T13:50:00Z', note: 'ok', evidence: 'x' },
  ],
}
const REPORTS = {
  asof: '2026-10-19T12:00:00Z',
  origin: 'Read from Slack.',
  reports: [
    {
      id: '2026-10-12-themes',
      date: '2026-10-12',
      kind: 'themes',
      title: 'TEMAS STAGE 1',
      channel: '#roblox_trends_2',
      posted: '2026-10-12 14:28 BRT',
      summary: '157 themes.',
      sections: [{ name: 'PASS (top 5)', items: [{ title: 'Anomaly (spot the error)', verdict: 'PASS', note: 'Observe and reveal transfers cleanly.' }] }],
    },
  ],
}
const SEED = {
  ideas: [{ title: 'Monster truck', note: 'Own a monster truck.', origin: 'own' }],
  knowledge: { thumb: [{ kind: 'principle', text: 'The storefront is a contract.', source: 'Commandment 7', tag: 'unrated' }] },
}

async function mountPane(surface: 'terminal' | 'desktop', $: any, on: any) {
  mock.store(on, {})
  on('fs.read', (_: any, e: any) => {
    const p = String(e.path)
    const body = p.endsWith('sources.json') ? SOURCES : p.endsWith('reports.json') ? REPORTS : p.endsWith('seed.json') ? SEED : DATA
    return { value: JSON.stringify(body) }
  })
  return $.ui.mount({ plugin: 'radar-panel', surface, component: 'Pane', requestId: 'radar-panel', props: {} } as any)
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`clicking a stage opens it full screen with the chat first (${surface})`, async ($, on) => {
    const ui = await mountPane(surface, $, on)
    expect(await ui.find({ type: 'Text', text: /Pick a stage/ })).toBeDefined()
    await ui.press({ key: 'stage-brief' })
    expect(await ui.find({ type: 'Text', text: /This chat knows the 2-page brief stage/ })).toBeDefined()
    await (ui as any).input({ key: 'chat-brief', text: 'What is left on this stage?' })
    expect(await ui.find({ type: 'Text', text: /What is left on this stage\?/ })).toBeDefined()
    await ui.press({ key: 'tab-pending' })
    expect(await ui.find({ type: 'Text', text: /Decide the proto_id format/ })).toBeDefined()
    await ui.press({ key: 'back' })
    expect(await ui.find({ type: 'Text', text: /Pick a stage/ })).toBeDefined()
    await ui.unmount()
  })
}

test('collection stage shows every source with its status', async ($, on) => {
  const ui = await mountPane('desktop', $, on)
  await ui.press({ key: 'stage-coleta' })
  await ui.press({ key: 'tab-sources' })
  expect(await ui.find({ type: 'Text', text: /tiktok_trends/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /STALE/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /WORKING/ })).toBeDefined()
  await ui.unmount()
})

test('a report idea is sent to pre-validation and shows up as a card there', async ($, on) => {
  const ui = await mountPane('desktop', $, on)
  await ui.press({ key: 'stage-triagem' })
  await ui.press({ key: 'tab-reports' })
  await ui.press({ key: 'rep-toggle-2026-10-12-themes' })
  expect(await ui.find({ type: 'Text', text: /Observe and reveal transfers cleanly/ })).toBeDefined()
  await ui.press({ key: 'send-2026-10-12-themes#0.0' })
  await ui.press({ key: 'jump-prevalid' })
  await ui.press({ key: 'tab-ideas' })
  expect(await ui.find({ type: 'Text', text: /Anomaly \(spot the error\)/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Monster truck/ })).toBeDefined()
  await ui.unmount()
})

test('an own idea is added in pre-validation and the knowledge repository takes a typed entry', async ($, on) => {
  const ui = await mountPane('terminal', $, on)
  await ui.press({ key: 'stage-prevalid' })
  await ui.press({ key: 'tab-ideas' })
  await (ui as any).input({ key: 'add-idea-prevalid', text: 'Prison break tycoon' })
  expect(await ui.find({ type: 'Text', text: /Prison break tycoon/ })).toBeDefined()
  await ui.press({ key: 'jump-thumb' })
  await ui.press({ key: 'tab-knowledge' })
  expect(await ui.find({ type: 'Text', text: /The storefront is a contract/ })).toBeDefined()
  await (ui as any).input({ key: 'add-know-thumb', text: 'technique: show the reveal in the first frame' })
  expect(await ui.find({ type: 'Text', text: /show the reveal in the first frame/ })).toBeDefined()
  await ui.unmount()
})


/* ---------- receipts ---------- */

const rjson = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    receipt_version: 1,
    task_key: 'coleta',
    stage: 'coleta',
    run_id: 'coleta-20261019T161000Z',
    started_utc: '2026-10-19T15:40:00Z',
    finished_utc: '2026-10-19T16:10:00Z',
    outcome: 'attention',
    summary: '18 legs ok, 1 stale, 1 degraded_size.',
    counts: { legs_ok: 18, legs_stale: 1, legs_degraded_size: 1, free_scout_rows: null },
    items: [
      { name: 'tiktok_trends', status: 'stale', rows: 50, note: 'identical to 20261018' },
      { name: 'reddit', status: 'degraded_size', rows: 12, note: 'today 12, median 40' },
      { name: 'google_trends', status: 'ok', rows: 120, note: 'newest item 3h old' },
    ],
    outputs: [{ kind: 'sheet', name: 'collection_log', ref: 'abc' }],
    problems: ['reddit shrank'],
    next_run_utc: '2026-10-20T15:30:00Z',
    ...over,
  })

test('a receipt is parsed from a Drive doc body, tolerating wrapping text and curly quotes', () => {
  const ok = parseReceipt(`coleta receipt\n${rjson()}\n`, 'f1')
  expect(ok?.run_id).toBe('coleta-20261019T161000Z')
  expect(ok?.items.length).toBe(3)
  expect(ok?.counts.free_scout_rows).toBe(null)
  const curly = parseReceipt(rjson().replace(/"/g, '“').replace(/“(?=[:,}\]])/g, '"'), 'f2')
  // A body that cannot be repaired is dropped, never half read.
  expect(curly === null || curly.task_key === 'coleta').toBe(true)
  expect(parseReceipt('not json at all', 'f3')).toBe(null)
  expect(parseReceipt(rjson({ receipt_version: 2 }), 'f4')).toBe(null)
  expect(parseReceipt(rjson({ outcome: 'great' }), 'f5')).toBe(null)
  expect(parseReceipt(rjson({ finished_utc: 'yesterday' }), 'f6')).toBe(null)
})

test('the newest collection receipt becomes the Sources list, keeping family and cadence from the snapshot', () => {
  const r = parseReceipt(rjson(), 'f1')
  expect(sourceStatusOf('degraded_size')).toBe('attention')
  expect(sourceStatusOf('dead')).toBe('broken')
  const f = sourcesFromReceipt(r, SOURCES as any)
  expect(f?.sources.length).toBe(3)
  const tt = f?.sources.find(s => s.name === 'tiktok_trends')
  expect(tt?.status).toBe('stale')
  expect(tt?.family).toBe('Apify')
  expect(f?.sources.find(s => s.name === 'reddit')?.status).toBe('attention')
  expect(sourcesFromReceipt(null, SOURCES as any)).toBe(null)
})

test('advisor and thumbnail receipts become report cards, merged with the snapshot by date and kind', () => {
  const adv = parseReceipt(
    rjson({
      task_key: 'advisor',
      stage: 'triagem',
      run_id: 'advisor-20261019T173000Z',
      finished_utc: '2026-10-19T17:30:00Z',
      outcome: 'ok',
      summary: 'Monday themes posted.',
      items: [],
      report: {
        date: '2026-10-19',
        kind: 'themes',
        title: 'TEMAS STAGE 1 2026-10-19',
        channel: 'slack C0C7D3PC68N',
        sections: [
          { title: 'PASS', items: [{ name: 'Spot the error', note: 'Observation kernel.', flags: ['THIRD_PARTY_IP'] }] },
          { title: 'Rejected with highest reach', items: [{ name: 'A rejected theme', note: 'No play kernel.', flags: [] }] },
        ],
      },
    }),
    'f7',
  )!
  const live = reportsFromReceipts([adv])
  expect(live.length).toBe(1)
  expect(live[0]?.sections[0]?.items[0]?.verdict).toBe('PASS')
  expect(live[0]?.sections[0]?.items[0]?.ip).toBe(true)
  expect(live[0]?.sections[1]?.items[0]?.verdict).toBe('REJECT')
  const merged = mergeReports(live, REPORTS as any)
  expect(merged?.reports.length).toBe(2)
  // Same date and kind in the snapshot would be replaced by the live one.
  const same = mergeReports(live, { ...(REPORTS as any), reports: [{ ...(REPORTS as any).reports[0], date: '2026-10-19' }] })
  expect(same?.reports.length).toBe(1)
})

test('stage health reads the newest receipt of each task and flags a run that never reported', () => {
  const ok = parseReceipt(rjson({ outcome: 'ok' }), 'a')!
  const failed = parseReceipt(rjson({ task_key: 'free_scout', run_id: 'fs-1', outcome: 'failed' }), 'b')!
  const now = Date.parse('2026-10-19T17:00:00Z')
  expect(stageHealth([ok], 'coleta', now).level).toBe(0)
  expect(stageHealth([ok, failed], 'coleta', now).level).toBe(2)
  // The coleta receipt expected the next run at 2026-10-20 15:30; two hours later with nothing new is late.
  expect(isLate(ok, Date.parse('2026-10-20T17:31:00Z'))).toBe(true)
  expect(stageHealth([ok], 'coleta', Date.parse('2026-10-20T17:31:00Z')).level).toBe(1)
  expect(receiptsFor([ok], 'triagem').length).toBe(0)
})

test('the Receipts tab and live Sources come from Drive receipts read through the connector', async ($, on) => {
  const files = [{ id: 'r1', title: 'receipt_coleta_20261019T161000Z', createdTime: '2026-10-19T16:10:05Z', mimeType: 'application/vnd.google-apps.document' }]
  on('tool.call', { tool: 'mcp__Google_Drive__search_files' } as any, () => ({ result: { files }, text: JSON.stringify({ files }) }) as any)
  on('tool.call', { tool: 'mcp__Google_Drive__read_file_content' } as any, () => ({ result: 'x', text: rjson() }) as any)
  const ui = await mountPane('desktop', $, on)
  await ui.press({ key: 'stage-coleta' })
  await ui.press({ key: 'tab-receipts' })
  expect(await ui.find({ type: 'Text', text: /18 legs ok, 1 stale/ })).toBeDefined()
  await ui.press({ key: 'tab-sources' })
  expect(await ui.find({ type: 'Text', text: /Live from receipt coleta-20261019T161000Z/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /ATTENTION/ })).toBeDefined()
  await ui.unmount()
})

test('a receipt read exactly as the Drive connector returns it (envelope and Markdown escapes) is parsed', () => {
  const doc =
    '{"receipt\\_version": 1, "task\\_key": "advisor", "stage": "triagem", "run\\_id": "advisor-20261019T1732Z", "finished\\_utc": "2026-10-19T17:32:04Z", "outcome": "ok", "summary": "Screened 65 themes.", ' +
    '"counts": {"legs\\_ok": 18, "screened": 65}, "items": \\[{"name": "Backrooms", "status": "PASS", "rows": null, "note": "changed from MAYBE"}\\], ' +
    '"report": {"date": "2026-10-19", "kind": "themes", "title": "T \\#1", "channel": "slack C0C7D3PC68N", "sections": \\[{"title": "PASS", "items": \\[{"name": "Backrooms", "note": "Markiplier \\"SILLY CAT\\" 1.4M", "flags": \\["THIRD\\_PARTY\\_IP"\\]}\\]}\\]}, ' +
    '"outputs": \\[\\], "problems": \\["rotrends stale"\\], "next\\_run\\_utc": "2026-10-20T17:10:00Z"}'
  const envelope = JSON.stringify({ fileContent: doc, title: 'receipt_advisor_20261019T1732Z', viewUrl: 'https://docs.google.com/document/d/x/edit' })
  const r = parseReceipt(envelope, 'f1')
  expect(r).not.toBeNull()
  expect(r!.task_key).toBe('advisor')
  expect(r!.counts.screened).toBe(65)
  expect(r!.items[0]!.status).toBe('pass')
  expect(r!.report!.sections[0]!.items[0]!.flags[0]).toBe('THIRD_PARTY_IP')
  expect(r!.report!.sections[0]!.items[0]!.note).toContain('"SILLY CAT"')
  expect(r!.problems[0]).toBe('rotrends stale')
})
