// Factory mode: prototype picker, the prototype hero card with its potential, and one panel per stage.
// Presentation only: every handler comes from Ctx and is called exactly as before.
import { AMBER, BG, CLAY, FG, LINE, LINE_SOFT, MUTED, NEON, OLIVE, PANEL, RAISED, RUST, SAND, SKY } from '../theme'
import { ago, nameOf, openChatButton } from '../views'
import type { Ctx } from '../views'
import { IDEA_STAGES, clip, nextStageOf } from '../model'
import type { Idea, Output } from '../model'
import { docLinks, isArchived, isPending, latestOf, outputsOf } from '../factory'
import { actionsFor } from '../actions'
import type { FAction } from '../actions'
import { splitItems } from '../outputs'
import { SAFETY, potential, safetyBlocked } from '../scoring'
import { newest, skillsFolderName } from '../skills'
import { refsBlock, revengPanel } from './reveng'
import { STEP_LABEL, STEP_ORDER } from '../chatflow'
import { scanPanel, scanSummary } from './scan'
import { btn, cardWidth, chip, emptyState, meterColor, meterText, notice, pill, rail, rule, tierOf, tint } from './kit'

const SHORT: Record<string, string> = { prevalid: 'Pre-valid', brief: 'Brief', template: 'Reverse eng.', doccompleto: 'Full doc', build: 'Build', titulo: 'Title', thumb: 'Thumb', publicar: 'Publish', metricas: 'Metrics' }
// A request that has waited this long with no new answer shows "No reply yet" and the button to ask the chat.
export const NO_REPLY_MS = 10 * 60 * 1000
const GATE_COLOR: Record<string, string> = { PASS: OLIVE, 'PASS WITH RISKS': AMBER, BLOCK: RUST }

export function checkGlyph(i: Idea, st: string): { glyph: string; color: string } {
  const c = i.checks?.[st]
  if (c === 'done') return { glyph: '●', color: OLIVE }
  if (c === 'asked' || isPending(i, st)) return { glyph: '◐', color: AMBER }
  return { glyph: '○', color: SAND }
}

const pctText = (p: number | null) => (p === null ? '--' : `${p}%`)
const pctColor = (p: number | null) => (p === null ? SAND : p >= 70 ? OLIVE : p >= 40 ? AMBER : RUST)

/* ---------- prototype picker: a drop-down menu ---------- */

export function protoPicker(x: Ctx, current: Idea | undefined) {
  const { Box, Text, Button } = x.C
  const w = cardWidth(x.columns)
  const cfg = x.scoring
  const list = x.store.ideas
    .filter(i => (x.showArchived ? true : !isArchived(i)))
    .map(i => ({ i, p: potential(i.scores, cfg) }))
    .sort((a, b) => (b.p.pct ?? -1) - (a.p.pct ?? -1) || b.i.updated.localeCompare(a.i.updated))
  const label = current ? `${current.proto_id}  ${clip(current.title, 40)}` : 'Choose a prototype'
  const titleW = Math.max(12, Math.min(34, w - 46))
  return (
    <Box flexDirection="column" gap={1}>
      <Box gap={2} alignItems="center" flexWrap="wrap">
        <Text color={MUTED}>Prototype</Text>
        <Button key="proto-menu" onPress={() => x.toggleProtoMenu()}>
          <Text bold color={FG} backgroundColor={RAISED}>{` ${label.padEnd(Math.min(56, Math.max(24, label.length)))} ${x.protoMenu ? '▴' : '▾'} `}</Text>
        </Button>
      </Box>
      {x.protoMenu ? (
        <Box flexDirection="column" borderStyle="round" borderColor={LINE_SOFT} backgroundColor={PANEL} paddingX={1}>
          {list.length === 0 ? <Text color={MUTED}>No prototype yet. Send an idea to the Factory from Radar.</Text> : null}
          {list.map(({ i, p }, k) => {
            const on = !!current && current.id === i.id
            const bg = on ? RAISED : undefined
            return (
              <Box key={`optrow-${i.id}`} flexDirection="column">
                {k > 0 ? rule(x.C, w - 6) : null}
                <Button key={`opt-${i.id}`} onPress={() => x.selectProto(i.id)}>
                  <Text bold color={NEON} backgroundColor={bg}>{on ? '▶ ' : '  '}</Text>
                  <Text bold color={CLAY} backgroundColor={bg}>{`${clip(i.proto_id ?? '', 15).padEnd(16)}`}</Text>
                  <Text color={isArchived(i) ? SAND : FG} backgroundColor={bg}>{`${clip(i.title, titleW).padEnd(titleW + 1)}`}</Text>
                  <Text bold color={pctColor(p.pct)} backgroundColor={bg}>{pctText(p.pct).padStart(5)}</Text>
                  <Text color={MUTED} backgroundColor={bg}>{`  ${(SHORT[i.stage] ?? i.stage).padEnd(10)}`}</Text>
                  {isArchived(i) ? <Text color={SAND} backgroundColor={bg}>{' archived'}</Text> : null}
                </Button>
              </Box>
            )
          })}
          {btn(x.C, 'proto-menu-archived', x.showArchived ? 'Hide archived' : 'Show archived', 'quiet', () => x.toggleArchived())}
        </Box>
      ) : null}
    </Box>
  )
}

/* ---------- creation sequence: prototype, Drive folder, chat created, chat opened ---------- */

const STEP_GLYPH: Record<string, { glyph: string; color: string }> = {
  pending: { glyph: '○', color: SAND },
  running: { glyph: '◐', color: AMBER },
  done: { glyph: '●', color: OLIVE },
  failed: { glyph: '✖', color: RUST },
}

// Shown on the prototype until all four steps are done. Each step has its own glyph and its own error text.
export function creationBlock(x: Ctx, i: Idea) {
  const { Box, Text, Link, Input } = x.C
  const c = i.creation
  if (!c) return null
  const stateOf = (k: (typeof STEP_ORDER)[number]) => c.steps[k]?.state ?? 'pending'
  const errorOf = (k: (typeof STEP_ORDER)[number]) => c.steps[k]?.error
  const all = STEP_ORDER.every(k => stateOf(k) === 'done' && !errorOf(k))
  if (all) return null
  const docsBad = stateOf('docs') === 'failed' || (stateOf('docs') === 'pending' && stateOf('folder') === 'done' && !i.pdocs?.statusUrl)
  const chatOpen = stateOf('chat') !== 'done'
  return (
    <Box flexDirection="column" gap={1} borderStyle="round" borderColor={docsBad ? RUST : LINE_SOFT} paddingX={1}>
      <Box gap={2} flexWrap="wrap">
        {STEP_ORDER.map((k, n) => {
          const g = STEP_GLYPH[stateOf(k)] ?? STEP_GLYPH.pending!
          return (
            <Text key={`cs-${i.id}-${k}`} bold={stateOf(k) === 'running'} color={g.color}>
              {`${g.glyph} ${n + 1} ${STEP_LABEL[k]}`}
            </Text>
          )
        })}
      </Box>
      {STEP_ORDER.filter(k => errorOf(k)).map(k => (
        <Text key={`ce-${i.id}-${k}`} color={stateOf(k) === 'failed' ? RUST : AMBER}>
          {`${STEP_LABEL[k]}: ${clip(errorOf(k) ?? '', 400)}`}
        </Text>
      ))}
      {docsBad ? (
        <Box gap={2} flexWrap="wrap" alignItems="center">
          {btn(x.C, `create-docs-${i.id}`, 'Create status and potential docs', 'primary', () => x.createDocs(i.id))}
        </Box>
      ) : null}
      {chatOpen ? (
        <Box flexDirection="column" gap={1}>
          <Box gap={2} flexWrap="wrap" alignItems="center">
            <Text color={FG}>{`Create a chat titled: ${i.proto_id} | ${clip(i.title, 60)}`}</Text>
            {btn(x.C, `copy-chat-title-${i.id}`, 'Copy chat title', 'secondary', (press: any) => x.copyChatTitle(i.id, press))}
          </Box>
          <Input key={`chat-link-${i.id}`} placeholder="Paste the link of the chat here" rows={1} submitLabel="Save link" onSubmit={(v: string) => void x.pasteChatLink(i.id, v)} />
        </Box>
      ) : null}
      {c.link && Link ? <Link key={`chat-session-${i.id}`} href={c.link} label="Open chat" /> : null}
    </Box>
  )
}

/* ---------- the prototype hero card ---------- */

function criteriaColumns(x: Ctx, i: Idea) {
  const { Box, Text } = x.C
  const latest = i.scores && i.scores.length > 0 ? i.scores[i.scores.length - 1]!.criteria : {}
  const names = [...Object.keys(x.scoring.weights), SAFETY]
  const cell = (k: string) => {
    const c = latest[k]
    const color = !c ? SAND : k === SAFETY && c.v < x.scoring.safety_gate ? RUST : meterColor(c.v)
    return (
      <Box key={`cr-${i.id}-${k}`}>
        <Text color={MUTED}>{k.padEnd(14)}</Text>
        <Text color={color}>{c ? meterText(c.v) : '··········'}</Text>
        <Text bold color={color}>{` ${c ? String(c.v).padStart(3) : ' --'}`}</Text>
        <Text color={MUTED}>{` ${c ? `${c.c[0]}${c.t}` : ''}`}</Text>
      </Box>
    )
  }
  if (tierOf(x.columns) === 'narrow') return <Box flexDirection="column">{names.map(cell)}</Box>
  const half = Math.ceil(names.length / 2)
  return (
    <Box gap={3}>
      <Box flexDirection="column">{names.slice(0, half).map(cell)}</Box>
      <Box flexDirection="column">{names.slice(half).map(cell)}</Box>
    </Box>
  )
}

// Nine cells, one per stage: done ▰ OLIVE, the current stage ▰ NEON, the rest ▱.
function progressRow(x: Ctx, i: Idea) {
  const { Box, Text } = x.C
  const done = IDEA_STAGES.filter(st => i.checks?.[st] === 'done').length
  return (
    <Box gap={1} alignItems="center">
      <Box>
        {IDEA_STAGES.map(st => {
          const isDone = i.checks?.[st] === 'done'
          const here = st === i.stage
          return (
            <Text key={`pg-${i.id}-${st}`} color={isDone ? OLIVE : here ? NEON : SAND}>
              {isDone || here ? '▰' : '▱'}
            </Text>
          )
        })}
      </Box>
      <Text color={MUTED}>{`${done}/${IDEA_STAGES.length}`}</Text>
    </Box>
  )
}

export function protoHeader(x: Ctx, i: Idea) {
  const { Box, Text } = x.C
  const p = potential(i.scores, x.scoring)
  const blocked = safetyBlocked(i.scores, x.scoring)
  return (
    <Box flexDirection="column" gap={1} borderStyle="round" borderColor={LINE} backgroundColor={PANEL} paddingX={1} paddingY={1}>
      <Box gap={2} flexWrap="wrap" alignItems="center">
        {chip(x.C, i.proto_id ?? '', CLAY)}
        <Text bold color={FG}>{i.title}</Text>
        {isArchived(i) ? tint(x.C, 'ARCHIVED', SAND) : null}
        {blocked ? chip(x.C, `⚑ SAFETY BELOW ${x.scoring.safety_gate}`, RUST) : null}
        {i.driveFolderUrl && x.C.Link ? <x.C.Link key={`folder-${i.id}`} href={i.driveFolderUrl} label="Open folder" /> : null}
      </Box>
      {creationBlock(x, i)}
      {!i.driveFolderUrl && x.folderNotice(i.id) ? notice(x.C, 'warn', x.folderNotice(i.id) as string) : null}
      <Box gap={2} flexWrap="wrap" alignItems="center">
        {chip(x.C, pctText(p.pct), pctColor(p.pct))}
        <Text color={MUTED}>POTENTIAL</Text>
        {p.delta !== null ? <Text color={p.delta >= 0 ? OLIVE : RUST}>{`${p.delta >= 0 ? '+' : ''}${p.delta} vs previous stage`}</Text> : null}
        <Text color={MUTED}>{`${p.scored}/${p.total} criteria scored`}</Text>
      </Box>
      {(i.outputs?.prevalid ?? []).find(o => o.scan)?.scan ? scanSummary(x, (i.outputs?.prevalid ?? []).find(o => o.scan)!.scan!, `scan-sum-${i.id}`) : null}
      {progressRow(x, i)}
      {criteriaColumns(x, i)}
      <Text color={MUTED}>Confidence l, m, h. Evidence F fact, H hypothesis, V needs validation.</Text>
      <Box gap={2} alignItems="center" flexWrap="wrap">
        <Text color={MUTED}>{`ID ${i.proto_id} is fixed.`}</Text>
        {btn(x.C, `arch-${i.id}`, isArchived(i) ? 'Unarchive' : 'Archive', isArchived(i) ? 'quiet' : 'secondary', () => x.archive(i.id, !isArchived(i)))}
      </Box>
    </Box>
  )
}

/* ---------- one line about the selected prototype, shown above a stage ---------- */

export function protoLine(x: Ctx, i: Idea) {
  const { Box, Text } = x.C
  const p = potential(i.scores, x.scoring)
  return (
    <Box gap={2} flexWrap="wrap" alignItems="center">
      {chip(x.C, i.proto_id ?? '', CLAY)}
      <Text bold color={FG}>{clip(i.title, 40)}</Text>
      {chip(x.C, `${pctText(p.pct)} potential`, pctColor(p.pct))}
      {safetyBlocked(i.scores, x.scoring) ? chip(x.C, '⚑ safety low', RUST) : null}
      {btn(x.C, 'change-proto', 'Change prototype', 'quiet', () => x.changeProto())}
    </Box>
  )
}

/* ---------- stage panel ---------- */

// The block's one primary action. Disabled keeps its place and turns grey, so the layout never jumps.
export function actionButton(x: Ctx, i: Idea, a: FAction, enabled: boolean, label?: string, kind: 'primary' | 'secondary' = 'primary') {
  const { Box, Text } = x.C
  const blocked = a.needs ? a.needs(i) : null
  const off = !enabled || !!blocked
  return (
    <Box key={`act-${a.key}`} gap={1} flexWrap="wrap" alignItems="center">
      {btn(x.C, `actb-${i.id}-${a.key}`, label ?? a.label, kind, () => (off ? undefined : x.runFactory(i.id, a.key)), { disabled: off })}
      {blocked && enabled ? <Text color={AMBER}>{blocked}</Text> : null}
    </Box>
  )
}

function docLink(x: Ctx, o: Output) {
  const { Link, Text } = x.C
  if (!o.doc) return null
  return Link ? <Link key={`doc-${o.at}-${o.kind}`} href={o.doc.url} label={`open doc: ${clip(o.doc.title, 50)}`} /> : <Text color={SKY}>{o.doc.url}</Text>
}

function skillNote(o: Output) {
  return o.skill.length > 0 ? `skills: ${o.skill.map(s => s.name).join(', ')}` : ''
}

// Every document of the stage, newest first, one link each. A warning shows when a check found a problem.
function docsBlock(x: Ctx, i: Idea, stage: string, docs: { name: string; url: string }[]) {
  const { Box, Text, Link } = x.C
  void stage
  return (
    <Box flexDirection="column">
      <Text color={MUTED}>{`Documents (${docs.length})`}</Text>
      {docs.map(d => (
        <Box key={`doc-${d.url}`} gap={1} flexWrap="wrap">
          {Link ? <Link key={`doclink-${d.url}`} href={d.url} label={clip(d.name, 70)} /> : <Text color={SKY}>{d.url}</Text>}
          {i.docWarn?.[d.url] ? notice(x.C, 'warn', i.docWarn[d.url] as string) : null}
        </Box>
      ))}
    </Box>
  )
}

// One generation of text output, with its doc link and the skills that were present when it was requested.
function outputBlock(x: Ctx, i: Idea, o: Output, title: string, older = false) {
  const { Box, Text } = x.C
  const w = cardWidth(x.columns) - 8
  return (
    <Box key={`out-${i.id}-${o.kind}-${o.gen}-${o.at}`} flexDirection="column" borderStyle="round" borderColor={LINE_SOFT} paddingX={1}>
      <Text dimColor={older} color={MUTED}>{`${title}, gen ${o.gen}, ${ago(o.at, x.now)}`}</Text>
      <Text color={FG}>{clip(o.content, 1800)}</Text>
      {docLink(x, o)}
      {skillNote(o) ? <Box>{tint(x.C, clip(skillNote(o), w), MUTED)}</Box> : null}
    </Box>
  )
}

// Titles and thumbnail prompts: every generation kept, each item with its own buttons.
function itemsBlock(x: Ctx, i: Idea, stage: string) {
  const { Box, Text } = x.C
  const gens = outputsOf(i, stage)
  const isTitle = stage === 'titulo'
  if (gens.length === 0) return <Text color={MUTED}>Nothing yet. The result appears here when the chat answers.</Text>
  return (
    <Box flexDirection="column" gap={1}>
      {gens.map(o => {
        const items = splitItems(o.content).filter(t => !o.discarded.includes(t))
        return (
          <Box key={`gen-${i.id}-${stage}-${o.gen}-${o.at}`} flexDirection="column" gap={1} borderStyle="round" borderColor={LINE_SOFT} paddingX={1}>
            <Text color={MUTED}>{`Generation ${o.gen}, ${ago(o.at, x.now)}${o.discarded.length > 0 ? `, ${o.discarded.length} discarded` : ''}${skillNote(o) ? `, ${clip(skillNote(o), 100)}` : ''}`}</Text>
            {items.map((t, n) => {
              const chosen = o.chosen.some(c => c === t || t.includes(c) || c.includes(t))
              return (
                <Box key={`it-${o.gen}-${n}`} flexDirection="column">
                  <Box gap={1}>
                    {chosen ? rail(x.C, OLIVE, `rail-${o.gen}-${n}`) : <Text color={MUTED}>{String(n + 1).padStart(2, '0')}</Text>}
                    {chosen ? chip(x.C, '★ chosen', OLIVE) : null}
                    <Text bold={chosen} color={chosen ? OLIVE : FG}>{clip(t, isTitle ? 300 : 900)}</Text>
                  </Box>
                  <Box gap={1} paddingLeft={3}>
                    {chosen ? null : btn(x.C, `ch-${o.gen}-${n}`, 'Mark as chosen', 'secondary', () => x.pickItem(i.id, stage, t, 'choose'))}
                    {!isTitle ? btn(x.C, `dc-${o.gen}-${n}`, 'Discard', 'danger', () => x.pickItem(i.id, stage, t, 'discard')) : null}
                  </Box>
                </Box>
              )
            })}
          </Box>
        )
      })}
    </Box>
  )
}

// A numbered step of the custom template path.
function stepTitle(x: Ctx, n: number, text: string) {
  const { Box, Text } = x.C
  return (
    <Box gap={1}>
      <Text bold color={BG} backgroundColor={CLAY}>{` ${n} `}</Text>
      <Text bold color={FG}>{text}</Text>
    </Box>
  )
}

// The library path of the old Template match stage. Hidden: the Reverse engineering panel replaces it.
export const SHOW_LIBRARY_PATH = false

function templateTools(x: Ctx, i: Idea, enabled: boolean) {
  const { Box, Text, Button } = x.C
  const list = x.templates ? x.templates.list : []
  return (
    <Box gap={1} flexWrap="wrap">
      {list.map(t => {
        const on = i.template?.id === t.id
        return (
          <Button key={`pick-${i.id}-${t.id}`} onPress={() => (enabled ? x.chooseTemplate(i.id, on ? null : t.id) : undefined)}>
            {pill(x.C, ` ${on ? '● ' : ''}${t.name} `, on)}
          </Button>
        )
      })}
    </Box>
  )
}

function advanceRow(x: Ctx, i: Idea, stage: string) {
  const { Box, Text } = x.C
  const next = nextStageOf(stage)
  if (!next || i.stage !== stage || isArchived(i)) return null
  const g = i.gate?.[stage]
  const asked = i.gateAsked?.[stage]
  const waiting = !!asked && (!g || g.at < asked)
  const blocked = safetyBlocked(i.scores, x.scoring)
  const notDone = stage === 'template' && i.checks?.template !== 'done'
  const nextName = nameOf(x.stages, next)
  const railColor = g ? (GATE_COLOR[g.verdict] ?? LINE_SOFT) : LINE_SOFT
  return (
    <Box gap={1} borderStyle="round" borderColor={LINE_SOFT} paddingX={1}>
      {rail(x.C, railColor, `adv-rail-${i.id}`)}
      <Box flexDirection="column" gap={1}>
        {g ? (
          <Box gap={1} flexWrap="wrap" alignItems="center">
            {chip(x.C, `Principles gate: ${g.verdict}`, GATE_COLOR[g.verdict] ?? MUTED)}
            {g.reason ? <Text color={MUTED}>{clip(g.reason, 240)}</Text> : null}
            {g.override ? <Text color={MUTED}>(overridden)</Text> : null}
          </Box>
        ) : null}
        {waiting ? (
          <Box gap={1} flexWrap="wrap" alignItems="center">
            <Text color={AMBER}>Principles gate asked, waiting for the chat. It advances on its own on PASS.</Text>
            {btn(x.C, `adv-nogate-${i.id}`, 'Advance without gate', 'danger', () => x.advanceNoGate(i.id))}
          </Box>
        ) : g && g.verdict === 'BLOCK' && asked ? (
          <Box gap={1} flexWrap="wrap" alignItems="center">
            <Text bold color={RUST}>The gate blocked this step.</Text>
            {btn(x.C, `adv-override-${i.id}`, `Override and advance to ${nextName}`, 'danger', () => x.overrideAdvance(i.id))}
          </Box>
        ) : (
          <Box gap={1} flexWrap="wrap" alignItems="center">
            {btn(x.C, `adv-${i.id}`, `Advance to ${nextName}`, 'primary', () => (notDone ? undefined : x.requestAdvance(i.id, false)), { disabled: blocked || notDone })}
            {notDone ? <Text color={AMBER}>Finish Reverse engineering first.</Text> : null}
            {blocked ? btn(x.C, `adv-force-${i.id}`, 'Advance anyway (safety is low)', 'danger', () => x.requestAdvance(i.id, true)) : null}
            {blocked ? <Text color={RUST}>Safety is below the gate. Confirm to advance.</Text> : null}
          </Box>
        )}
      </Box>
    </Box>
  )
}

export function stagePanel(x: Ctx, i: Idea, stage: string) {
  const { Box, Text } = x.C
  const w = cardWidth(x.columns)
  const reached = IDEA_STAGES.indexOf(stage) <= IDEA_STAGES.indexOf(i.stage)
  const enabled = reached && !isArchived(i)
  const check = i.checks?.[stage]
  const pending = isPending(i, stage)
  const askedAt = i.askedAt?.[stage]
  const acts = actionsFor(stage).filter(a => stage !== 'template')
  const gens = outputsOf(i, stage)
  const histId = `hist:${i.id}:${stage}`
  const histOpen = x.open.includes(histId)
  const items = stage === 'titulo' || stage === 'thumb'
  const docs = docLinks(i, stage)
  const failed = i.failed?.[stage]
  const noTags = !!i.requested?.[stage]?.noTags
  const askedAge = askedAt ? x.now - Date.parse(askedAt) : 0
  const state = check === 'done' ? { t: 'DONE', c: OLIVE } : check === 'asked' || pending ? { t: 'ASKED', c: AMBER } : { t: 'NOT STARTED', c: SAND }
  return (
    <Box flexDirection="column" gap={1} borderStyle="round" borderColor={LINE} backgroundColor={PANEL} paddingX={1} paddingY={1}>
      <Box gap={2} flexWrap="wrap" alignItems="center">
        <Text bold color={NEON}>{nameOf(x.stages, stage)}</Text>
        {chip(x.C, state.t, state.c, `chk-${stage}`)}
        {askedAt ? <Text color={MUTED}>{`asked ${ago(askedAt, x.now)}`}</Text> : null}
        {openChatButton(x, 'idea', i.id, i.chat ?? null, () => x.openProtoChat(i.id, stage))}
        {docs.length > 0 && x.C.Link ? <x.C.Link key={`opendoc-${i.id}-${stage}`} href={docs[0]!.url} label="Open doc" /> : null}
        {pending ? btn(x.C, `refresh-${i.id}`, 'Refresh now', 'quiet', () => x.refreshNow(i.id)) : null}
        {check !== 'done' && enabled ? btn(x.C, `done-${i.id}-${stage}`, 'Mark done', 'secondary', () => x.markDone(i.id, stage)) : null}
      </Box>
      {rule(x.C, w - 6)}
      {!reached ? notice(x.C, 'warn', 'This prototype has not reached this stage yet. Actions are off.') : null}
      {failed ? notice(x.C, 'error', `Failed: ${failed.reason}`) : null}
      {docs.length > 0 ? docsBlock(x, i, stage, docs) : null}
      {pending ? notice(x.C, 'warn', 'Waiting for the chat. The result shows here when it answers (checked every 30 seconds).') : null}
      {pending && noTags ? (
        <Box gap={1} flexWrap="wrap" alignItems="center">
          {notice(x.C, 'warn', 'The chat replied without tags.')}
          {btn(x.C, `reformat-${i.id}-${stage}`, 'Ask chat to reformat', 'secondary', () => x.askChat(i.id, stage, 'reformat'))}
        </Box>
      ) : pending && askedAge > NO_REPLY_MS ? (
        <Box gap={1} flexWrap="wrap" alignItems="center">
          {notice(x.C, 'warn', 'No reply yet.')}
          {btn(x.C, `status-${i.id}-${stage}`, 'Ask chat for status', 'secondary', () => x.askChat(i.id, stage, 'status'))}
        </Box>
      ) : null}
      {stage === 'template' ? revengPanel(x, i, enabled) : null}
      {stage === 'template' && SHOW_LIBRARY_PATH ? templateTools(x, i, enabled) : null}
      {acts.map(a => {
        // Brief stage: the brief is the primary step until it exists; then Find references appears (secondary) when there are none.
        if (stage === 'brief') {
          const hasBrief = docs.length > 0
          if (a.key === 'refs') return hasBrief && !(i.refs && i.refs.candidates.length > 0) ? actionButton(x, i, a, enabled, undefined, 'secondary') : null
          return actionButton(x, i, a, enabled, undefined, hasBrief ? 'secondary' : 'primary')
        }
        return actionButton(x, i, a, enabled, stage === 'thumb' && gens.length > 0 ? 'Generate 5 more' : stage === 'titulo' && gens.length > 0 ? 'Generate more titles' : undefined)
      })}
      {stage === 'brief' ? refsBlock(x, i, false) : null}
      {stage === 'brief' && !(i.refs && i.refs.candidates.length > 0) && docs.length > 0 ? <Text color={MUTED}>The references come from the 2-page brief.</Text> : null}
      {stage === 'prevalid' && gens.length > 0 ? scanPanel(x, i, gens, enabled) : null}
      {stage !== 'template' && stage !== 'prevalid' && !items && gens.length > 0 ? outputBlock(x, i, gens[0]!, 'Latest output') : null}
      {stage === 'template' && i.template ? notice(x.C, 'ok', `Library template chosen: ${i.template.name}`) : null}
      {items ? itemsBlock(x, i, stage) : null}
      {!items && stage !== 'template' && gens.length === 0 ? emptyState(x.C, 'No output yet') : null}
      {!items && stage !== 'template' && stage !== 'prevalid' && gens.length > 1 ? (
        <Box flexDirection="column" gap={1}>
          <Box>{btn(x.C, `hist-${i.id}-${stage}`, `${histOpen ? 'Hide' : 'Show'} history (${gens.length - 1} earlier)`, 'quiet', () => x.toggle(histId))}</Box>
          {histOpen ? gens.slice(1).map(o => outputBlock(x, i, o, 'Earlier output', true)) : null}
        </Box>
      ) : null}
      {advanceRow(x, i, stage)}
    </Box>
  )
}

/* ---------- skills row (More section) ---------- */

export function skillsRow(x: Ctx) {
  const { Box, Text } = x.C
  // One row per skills folder: the folder a stage names with skills_folder (reveng for Reverse engineering), else its own id.
  const stages = [...['coleta', 'triagem', ...IDEA_STAGES].map(id => skillsFolderName(x.skills, x.stages.find(t => t.id === id) ?? { id })), '_all']
  const st = x.skills
  return (
    <Box flexDirection="column">
      <Text bold color={FG}>Skills in Drive</Text>
      {rule(x.C, 40)}
      {!st ? <Text color={MUTED}>Reading Drive...</Text> : null}
      {st && !st.ok ? notice(x.C, 'warn', st.error ?? 'Skills folder not readable.') : null}
      {st && st.ok
        ? stages.map(s => {
            const own = st.files[s] ?? []
            return (
              <Box key={`sk-${s}`} flexDirection="column">
                <Box gap={1}>
                  <Text color={own.length > 0 ? OLIVE : SAND}>●</Text>
                  <Text bold color={FG}>{s.padEnd(12)}</Text>
                  <Text bold color={FG}>{String(own.length).padStart(2)}</Text>
                  <Text color={MUTED}>{own.length > 0 ? `newest ${newest(own).slice(0, 10)}` : ''}</Text>
                </Box>
                {own.map(f => (
                  <Box key={`skf-${s}-${f.name}`} gap={1} paddingLeft={3}>
                    <Text color={/\.proposed\.md$/.test(f.name) ? AMBER : MUTED}>{clip(f.name, 46).padEnd(46)}</Text>
                    <Text color={f.version ? FG : SAND}>{f.version ? `v${f.version}` : 'v?'}</Text>
                    <Text color={MUTED}>{f.modified.slice(0, 10)}</Text>
                  </Box>
                ))}
                {own.some(f => /\.proposed\.md$/.test(f.name)) ? <Box paddingLeft={3}>{notice(x.C, 'warn', 'You edited a seeded file. A newer version was uploaded as .proposed.md: compare and merge by hand.')}</Box> : null}
              </Box>
            )
          })
        : null}
    </Box>
  )
}
