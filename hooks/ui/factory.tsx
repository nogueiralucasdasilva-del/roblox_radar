// Factory mode: prototype picker, the prototype hero card with its potential, and one panel per stage.
// Presentation only: every handler comes from Ctx and is called exactly as before.
import { AMBER, BG, CLAY, FG, LINE, LINE_SOFT, MUTED, NEON, OLIVE, PANEL, RAISED, RUST, SAND, SKY } from '../theme'
import { ago, nameOf, openChatButton } from '../views'
import type { Ctx } from '../views'
import { IDEA_STAGES, clip, nextStageOf } from '../model'
import type { Idea, Output } from '../model'
import { isArchived, isPending, latestOf, outputsOf } from '../factory'
import { actionsFor } from '../prompts'
import type { FAction } from '../prompts'
import { splitItems } from '../outputs'
import { SAFETY, potential, safetyBlocked } from '../scoring'
import { newest } from '../skills'
import { btn, cardWidth, chip, emptyState, meterColor, meterText, notice, pill, rail, rule, tierOf, tint } from './kit'

const SHORT: Record<string, string> = { prevalid: 'Pre-valid', brief: 'Brief', template: 'Template', doccompleto: 'Full doc', build: 'Build', titulo: 'Title', thumb: 'Thumb', publicar: 'Publish', metricas: 'Metrics' }
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
      </Box>
      <Box gap={2} flexWrap="wrap" alignItems="center">
        {chip(x.C, pctText(p.pct), pctColor(p.pct))}
        <Text color={MUTED}>POTENTIAL</Text>
        {p.delta !== null ? <Text color={p.delta >= 0 ? OLIVE : RUST}>{`${p.delta >= 0 ? '+' : ''}${p.delta} vs previous stage`}</Text> : null}
        <Text color={MUTED}>{`${p.scored}/${p.total} criteria scored`}</Text>
      </Box>
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
function actionButton(x: Ctx, i: Idea, a: FAction, enabled: boolean, label?: string) {
  const { Box, Text } = x.C
  const blocked = a.needs ? a.needs(i) : null
  const off = !enabled || !!blocked
  return (
    <Box key={`act-${a.key}`} gap={1} flexWrap="wrap" alignItems="center">
      {btn(x.C, `actb-${i.id}-${a.key}`, label ?? a.label, 'primary', () => (off ? undefined : x.runFactory(i.id, a.key)), { disabled: off })}
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

function templateTools(x: Ctx, i: Idea, enabled: boolean) {
  const { Box, Text, Button, Input } = x.C
  const mode = i.template_mode ?? null
  const list = x.templates ? x.templates.list : []
  const acts = actionsFor('template')
  const byKey = (k: string) => acts.find(a => a.key === k)!
  return (
    <Box flexDirection="column" gap={1}>
      <Box gap={2} flexWrap="wrap" alignItems="center">
        <Text color={MUTED}>Template path</Text>
        <Box gap={0}>
          <Button key="tm-custom" onPress={() => x.setTemplateMode(i.id, 'custom')}>
            {pill(x.C, ' Build my own ', mode === 'custom')}
          </Button>
          <Button key="tm-library" onPress={() => x.setTemplateMode(i.id, 'library')}>
            {pill(x.C, ' Use existing template ', mode === 'library')}
          </Button>
        </Box>
      </Box>
      {mode === 'library' ? (
        <Box flexDirection="column" gap={1}>
          {list.length === 0 ? <Text color={MUTED}>No template doc in the library yet (Drive folder roblox_radar_templates).</Text> : null}
          <Box gap={1} flexWrap="wrap">
            {list.map(t => {
              const on = i.template?.id === t.id
              return (
                <Button key={`pick-${i.id}-${t.id}`} onPress={() => (enabled ? x.chooseTemplate(i.id, on ? null : t.id) : undefined)}>
                  {pill(x.C, ` ${on ? '● ' : ''}${t.name} `, on)}
                  {t.status === 'draft' ? tint(x.C, 'draft', AMBER) : null}
                </Button>
              )
            })}
          </Box>
        </Box>
      ) : null}
      {mode === 'custom' ? (
        <Box flexDirection="column" gap={1}>
          {stepTitle(x, 1, 'Reference games')}
          <Box flexDirection="column" gap={1} paddingLeft={2}>
            {actionButton(x, i, byKey('refs'), enabled)}
            {latestOf(i, 'template', 'refs') ? outputBlock(x, i, latestOf(i, 'template', 'refs')!, 'References') : null}
          </Box>
          {stepTitle(x, 2, 'Reverse-engineering packet')}
          <Box flexDirection="column" gap={1} paddingLeft={2}>
            {actionButton(x, i, byKey('packet'), enabled)}
            {latestOf(i, 'template', 're_packet') ? outputBlock(x, i, latestOf(i, 'template', 're_packet')!, 'Research prompts') : null}
          </Box>
          {stepTitle(x, 3, 'Register research')}
          <Box flexDirection="column" gap={1} paddingLeft={2}>
            <Text color={MUTED}>Run the research outside the panel, then paste the links or the text here.</Text>
            <Box borderStyle="round" borderColor={CLAY} paddingX={1}>
              <Input key={`research-${i.id}`} placeholder="Paste links or text of the finished research" rows={3} submitLabel="register" onSubmit={(v: string) => void x.registerResearch(i.id, v)} />
            </Box>
            {i.research ? notice(x.C, 'ok', `Research registered (${i.research.length} characters).`) : null}
          </Box>
          {stepTitle(x, 4, 'Template doc')}
          <Box flexDirection="column" gap={1} paddingLeft={2}>
            {actionButton(x, i, byKey('template_doc'), enabled)}
            {latestOf(i, 'template', 'template_doc') ? outputBlock(x, i, latestOf(i, 'template', 'template_doc')!, 'Template doc') : null}
          </Box>
        </Box>
      ) : null}
      {!mode ? <Text color={MUTED}>Pick a path. Build my own works with research on three reference games; Use existing picks a template from the Drive library.</Text> : null}
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
            {btn(x.C, `adv-${i.id}`, `Advance to ${nextName}`, 'primary', () => x.requestAdvance(i.id, false), { disabled: blocked })}
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
  const state = check === 'done' ? { t: 'DONE', c: OLIVE } : check === 'asked' || pending ? { t: 'ASKED', c: AMBER } : { t: 'NOT STARTED', c: SAND }
  return (
    <Box flexDirection="column" gap={1} borderStyle="round" borderColor={LINE} backgroundColor={PANEL} paddingX={1} paddingY={1}>
      <Box gap={2} flexWrap="wrap" alignItems="center">
        <Text bold color={NEON}>{nameOf(x.stages, stage)}</Text>
        {chip(x.C, state.t, state.c, `chk-${stage}`)}
        {askedAt ? <Text color={MUTED}>{`asked ${ago(askedAt, x.now)}`}</Text> : null}
        {openChatButton(x, 'idea', i.id, i.chat ?? null, () => x.openProtoChat(i.id, stage))}
        {pending ? btn(x.C, `refresh-${i.id}`, 'Refresh now', 'quiet', () => x.refreshNow(i.id)) : null}
        {check !== 'done' && enabled ? btn(x.C, `done-${i.id}-${stage}`, 'Mark done', 'secondary', () => x.markDone(i.id, stage)) : null}
      </Box>
      {rule(x.C, w - 6)}
      {!reached ? notice(x.C, 'warn', 'This prototype has not reached this stage yet. Actions are off.') : null}
      {pending ? notice(x.C, 'warn', 'Waiting for the chat. The result shows here when it answers (checked every 30 seconds).') : null}
      {stage === 'template' ? templateTools(x, i, enabled) : null}
      {acts.map(a => actionButton(x, i, a, enabled, stage === 'thumb' && gens.length > 0 ? 'Generate 5 more' : stage === 'titulo' && gens.length > 0 ? 'Generate more titles' : undefined))}
      {stage !== 'template' && !items && gens.length > 0 ? outputBlock(x, i, gens[0]!, 'Latest output') : null}
      {stage === 'template' && i.template ? notice(x.C, 'ok', `Library template chosen: ${i.template.name}`) : null}
      {items ? itemsBlock(x, i, stage) : null}
      {!items && stage !== 'template' && gens.length === 0 ? emptyState(x.C, 'No output yet') : null}
      {!items && stage !== 'template' && gens.length > 1 ? (
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
  const stages = ['coleta', 'triagem', ...IDEA_STAGES, '_all']
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
              <Box key={`sk-${s}`} gap={1}>
                <Text color={own.length > 0 ? OLIVE : SAND}>●</Text>
                <Text color={FG}>{s.padEnd(12)}</Text>
                <Text bold color={FG}>{String(own.length).padStart(2)}</Text>
                <Text color={MUTED}>{own.length > 0 ? newest(own).slice(0, 10) : ''}</Text>
              </Box>
            )
          })
        : null}
    </Box>
  )
}
