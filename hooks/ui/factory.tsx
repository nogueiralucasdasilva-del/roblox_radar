// Factory mode: prototype list, selected prototype header with potential score, stepper with checks, and one panel per stage.
import { AMBER, BG, CLAY, FG, LINE, MUTED, NEON, NEON_BG, OLIVE, PANEL, RUST, SAND, SKY } from '../theme'
import { ago, chip, nameOf, openChatButton } from '../views'
import type { Ctx } from '../views'
import { IDEA_STAGES, clip, nextStageOf } from '../model'
import type { Idea, Output } from '../model'
import { isArchived, isPending, latestOf, outputsOf } from '../factory'
import { actionsFor } from '../prompts'
import type { FAction } from '../prompts'
import { splitItems } from '../outputs'
import { SAFETY, bar, potential, safetyBlocked } from '../scoring'
import { newest } from '../skills'

const SHORT: Record<string, string> = { prevalid: 'Pre-valid', brief: 'Brief', template: 'Template', doccompleto: 'Full doc', build: 'Build', titulo: 'Title', thumb: 'Thumb', publicar: 'Publish', metricas: 'Metrics' }
const GATE_COLOR: Record<string, string> = { PASS: OLIVE, 'PASS WITH RISKS': AMBER, BLOCK: RUST }

export function checkGlyph(i: Idea, st: string): { glyph: string; color: string } {
  const c = i.checks?.[st]
  if (c === 'done') return { glyph: '●', color: OLIVE }
  if (c === 'asked' || isPending(i, st)) return { glyph: '◐', color: AMBER }
  return { glyph: '○', color: SAND }
}

// One Text per stage, so it can sit inside a Button next to the other columns.
function checkTexts(x: Ctx, i: Idea) {
  const { Text } = x.C
  return IDEA_STAGES.map(st => {
    const g = checkGlyph(i, st)
    return (
      <Text key={`ck-${i.id}-${st}`} color={g.color}>
        {`${g.glyph} `}
      </Text>
    )
  })
}

const pctText = (p: number | null) => (p === null ? '--' : `${p}%`)

/* ---------- prototype list ---------- */

function protoList(x: Ctx) {
  const { Box, Text, Button } = x.C
  const cfg = x.scoring
  let list = x.store.ideas.filter(i => (x.showArchived ? true : !isArchived(i)))
  if (x.stageFilter) list = list.filter(i => i.stage === x.stageFilter)
  const rows = list
    .map(i => ({ i, p: potential(i.scores, cfg) }))
    .sort((a, b) => (b.p.pct ?? -1) - (a.p.pct ?? -1) || b.i.updated.localeCompare(a.i.updated))
  return (
    <Box flexDirection="column" gap={1}>
      <Box gap={1} flexWrap="wrap">
        <Text color={MUTED}>Stage:</Text>
        <Button key="flt-all" onPress={() => x.setStageFilter(null)}>
          <Text bold={!x.stageFilter} color={!x.stageFilter ? NEON : MUTED}>All</Text>
        </Button>
        {IDEA_STAGES.map(st => (
          <Button key={`flt-${st}`} onPress={() => x.setStageFilter(x.stageFilter === st ? null : st)}>
            <Text bold={x.stageFilter === st} color={x.stageFilter === st ? NEON : MUTED}>{SHORT[st] ?? st}</Text>
          </Button>
        ))}
        <Button key="flt-arch" label={x.showArchived ? 'Hide archived' : 'Show archived'} onPress={() => x.toggleArchived()} />
      </Box>
      <Text color={MUTED}>{`${'ID'.padEnd(16)}${'Name'.padEnd(25)}${'Pot.'.padEnd(6)}${'Stage'.padEnd(11)}${IDEA_STAGES.map(st => (SHORT[st] ?? st).slice(0, 1)).join(' ')}`}</Text>
      {rows.length === 0 ? <Text color={MUTED}>No prototype yet. Send an idea to the Factory from Radar mode.</Text> : null}
      {rows.map(({ i, p }) => {
        const isSel = x.proto === i.id
        return (
          <Button key={`proto-${i.id}`} onPress={() => x.selectProto(i.id)}>
            <Text bold color={isSel ? NEON : CLAY}>{`${clip(i.proto_id ?? '', 15).padEnd(16)}`}</Text>
            <Text color={isArchived(i) ? SAND : FG}>{`${clip(i.title, 24).padEnd(25)}`}</Text>
            <Text bold color={FG}>{pctText(p.pct).padEnd(6)}</Text>
            <Text color={MUTED}>{(SHORT[i.stage] ?? i.stage).padEnd(11)}</Text>
            {checkTexts(x, i)}
            {isArchived(i) ? <Text color={SAND}>{' archived'}</Text> : null}
          </Button>
        )
      })}
      <Text color={MUTED}>{'● done   ◐ asked, waiting for the chat   ○ not started'}</Text>
    </Box>
  )
}

/* ---------- selected prototype header ---------- */

function criteriaColumns(x: Ctx, i: Idea) {
  const { Box, Text } = x.C
  const latest = i.scores && i.scores.length > 0 ? i.scores[i.scores.length - 1]!.criteria : {}
  const names = [...Object.keys(x.scoring.weights), SAFETY]
  const cell = (k: string) => {
    const c = latest[k]
    const color = !c ? SAND : k === SAFETY && c.v < x.scoring.safety_gate ? RUST : c.v >= 70 ? OLIVE : c.v >= 40 ? AMBER : RUST
    return (
      <Text key={`cr-${i.id}-${k}`} color={color}>
        {`${k.padEnd(13)} ${c ? bar(c.v) : '··········'} ${c ? String(c.v).padStart(3) : ' --'} ${c ? `${c.c[0]}${c.t}` : ''}`}
      </Text>
    )
  }
  const half = Math.ceil(names.length / 2)
  return (
    <Box gap={3}>
      <Box flexDirection="column">{names.slice(0, half).map(cell)}</Box>
      <Box flexDirection="column">{names.slice(half).map(cell)}</Box>
    </Box>
  )
}

function protoHeader(x: Ctx, i: Idea) {
  const { Box, Text, Button, Input } = x.C
  const p = potential(i.scores, x.scoring)
  const blocked = safetyBlocked(i.scores, x.scoring)
  return (
    <Box flexDirection="column" gap={1} borderStyle="round" borderColor={CLAY} backgroundColor={PANEL} paddingX={1}>
      <Box gap={2} flexWrap="wrap" alignItems="center">
        <Button key="back-list" label="← List" onPress={() => x.selectProto(null)} />
        <Text bold color={CLAY}>{i.proto_id}</Text>
        <Text bold color={FG}>{i.title}</Text>
        <Text bold color={p.pct === null ? SAND : p.pct >= 70 ? OLIVE : p.pct >= 40 ? AMBER : RUST}>{`Potential ${pctText(p.pct)}`}</Text>
        {p.delta !== null ? <Text color={p.delta >= 0 ? OLIVE : RUST}>{`${p.delta >= 0 ? '+' : ''}${p.delta} vs previous stage`}</Text> : null}
        <Text color={MUTED}>{`${p.scored}/${p.total} criteria scored`}</Text>
        {blocked ? <Text bold color={RUST}>{`⚑ SAFETY BELOW ${x.scoring.safety_gate}`}</Text> : null}
        {isArchived(i) ? <Text color={SAND}>ARCHIVED</Text> : null}
      </Box>
      <Box gap={1} flexWrap="wrap" alignItems="center">
        <Text color={MUTED}>{`ABBR ${i.abbr ?? ''}`}</Text>
        <Box borderStyle="round" borderColor={LINE} paddingX={1}>
          <Input key={`abbr-${i.id}`} placeholder="new ABBR, letters only, max 7" rows={1} submitLabel="set ABBR" onSubmit={(v: string) => void x.renameAbbr(i.id, v)} />
        </Box>
        <Button key={`arch-${i.id}`} label={isArchived(i) ? 'Unarchive' : 'Archive'} onPress={() => x.archive(i.id, !isArchived(i))} />
      </Box>
      {criteriaColumns(x, i)}
      <Text color={MUTED}>Confidence: l low, m medium, h high. Evidence: F fact, H hypothesis, V needs validation.</Text>
    </Box>
  )
}

/* ---------- stepper ---------- */

function stepper(x: Ctx, i: Idea) {
  const { Box, Text, Button } = x.C
  const here = x.fstage ?? i.stage
  return (
    <Box gap={1} flexWrap="wrap">
      {IDEA_STAGES.map(st => {
        const g = checkGlyph(i, st)
        const sel = st === here
        return (
          <Button key={`step-${st}`} onPress={() => x.setFstage(st)}>
            <Text bold={sel} color={sel ? BG : g.color} backgroundColor={sel ? NEON : PANEL}>
              {` ${g.glyph} ${SHORT[st] ?? st}${st === i.stage ? ' ▶' : ''} `}
            </Text>
          </Button>
        )
      })}
    </Box>
  )
}

/* ---------- stage panel ---------- */

function actionButton(x: Ctx, i: Idea, a: FAction, enabled: boolean, label?: string) {
  const { Box, Text, Button } = x.C
  const blocked = a.needs ? a.needs(i) : null
  const off = !enabled || !!blocked
  return (
    <Box key={`act-${a.key}`} gap={1} flexWrap="wrap" alignItems="center">
      <Button key={`actb-${i.id}-${a.key}`} onPress={() => (off ? undefined : x.runFactory(i.id, a.key))}>
        <Text bold color={BG} backgroundColor={off ? SAND : NEON}>{` ▶ ${label ?? a.label} `}</Text>
      </Button>
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
function outputBlock(x: Ctx, i: Idea, o: Output, title: string) {
  const { Box, Text } = x.C
  return (
    <Box key={`out-${i.id}-${o.kind}-${o.gen}-${o.at}`} flexDirection="column" borderStyle="round" borderColor={LINE} paddingX={1}>
      <Text color={MUTED}>{`${title}, gen ${o.gen}, ${ago(o.at, x.now)}${skillNote(o) ? `, ${clip(skillNote(o), 120)}` : ''}`}</Text>
      <Text color={FG}>{clip(o.content, 1800)}</Text>
      {docLink(x, o)}
    </Box>
  )
}

// Titles and thumbnail prompts: every generation kept, each item with its own buttons.
function itemsBlock(x: Ctx, i: Idea, stage: string) {
  const { Box, Text, Button } = x.C
  const gens = outputsOf(i, stage)
  const isTitle = stage === 'titulo'
  if (gens.length === 0) return <Text color={MUTED}>Nothing yet. The result appears here when the chat answers.</Text>
  return (
    <Box flexDirection="column" gap={1}>
      {gens.map(o => {
        const items = splitItems(o.content).filter(t => !o.discarded.includes(t))
        return (
          <Box key={`gen-${i.id}-${stage}-${o.gen}-${o.at}`} flexDirection="column" borderStyle="round" borderColor={LINE} paddingX={1}>
            <Text color={MUTED}>{`Generation ${o.gen}, ${ago(o.at, x.now)}${o.discarded.length > 0 ? `, ${o.discarded.length} discarded` : ''}${skillNote(o) ? `, ${clip(skillNote(o), 100)}` : ''}`}</Text>
            {items.map((t, n) => {
              const chosen = o.chosen.some(c => c === t || t.includes(c) || c.includes(t))
              return (
                <Box key={`it-${o.gen}-${n}`} flexDirection="column" borderStyle={chosen ? 'round' : undefined} borderColor={chosen ? OLIVE : undefined} paddingX={chosen ? 1 : 0}>
                  <Text bold={chosen} color={chosen ? OLIVE : FG}>{`${chosen ? '★ ' : ''}${clip(t, isTitle ? 300 : 900)}`}</Text>
                  <Box gap={1}>
                    {chosen ? null : <Button key={`ch-${o.gen}-${n}`} label="Mark as chosen" onPress={() => x.pickItem(i.id, stage, t, 'choose')} />}
                    {!isTitle ? <Button key={`dc-${o.gen}-${n}`} label="Discard" onPress={() => x.pickItem(i.id, stage, t, 'discard')} /> : null}
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

function templateTools(x: Ctx, i: Idea, enabled: boolean) {
  const { Box, Text, Button, Input } = x.C
  const mode = i.template_mode ?? null
  const list = x.templates ? x.templates.list : []
  const acts = actionsFor('template')
  const byKey = (k: string) => acts.find(a => a.key === k)!
  return (
    <Box flexDirection="column" gap={1}>
      <Box gap={1} flexWrap="wrap">
        <Text color={MUTED}>Template path:</Text>
        <Button key="tm-custom" onPress={() => x.setTemplateMode(i.id, 'custom')}>
          <Text bold={mode === 'custom'} color={mode === 'custom' ? BG : FG} backgroundColor={mode === 'custom' ? NEON : undefined}>{' Build my own '}</Text>
        </Button>
        <Button key="tm-library" onPress={() => x.setTemplateMode(i.id, 'library')}>
          <Text bold={mode === 'library'} color={mode === 'library' ? BG : FG} backgroundColor={mode === 'library' ? NEON : undefined}>{' Use existing template '}</Text>
        </Button>
      </Box>
      {mode === 'library' ? (
        <Box flexDirection="column">
          {list.length === 0 ? <Text color={MUTED}>No template doc in the library yet (Drive folder roblox_radar_templates).</Text> : null}
          <Box gap={1} flexWrap="wrap">
            {list.map(t => {
              const on = i.template?.id === t.id
              return (
                <Button key={`pick-${i.id}-${t.id}`} onPress={() => (enabled ? x.chooseTemplate(i.id, on ? null : t.id) : undefined)}>
                  <Text bold={on} color={on ? BG : t.status === 'ready' ? FG : MUTED} backgroundColor={on ? NEON : undefined}>{` ${on ? '● ' : ''}${t.name}${t.status === 'draft' ? ' (draft)' : ''} `}</Text>
                </Button>
              )
            })}
          </Box>
        </Box>
      ) : null}
      {mode === 'custom' ? (
        <Box flexDirection="column" gap={1}>
          <Text bold color={FG}>1. Reference games</Text>
          {actionButton(x, i, byKey('refs'), enabled)}
          {latestOf(i, 'template', 'refs') ? outputBlock(x, i, latestOf(i, 'template', 'refs')!, 'References') : null}
          <Text bold color={FG}>2. Reverse-engineering packet</Text>
          {actionButton(x, i, byKey('packet'), enabled)}
          {latestOf(i, 'template', 're_packet') ? outputBlock(x, i, latestOf(i, 'template', 're_packet')!, 'Research prompts') : null}
          <Text bold color={FG}>3. Register research</Text>
          <Text color={MUTED}>Run the research outside the panel, then paste the links or the text here.</Text>
          <Box borderStyle="round" borderColor={CLAY} paddingX={1}>
            <Input key={`research-${i.id}`} placeholder="Paste links or text of the finished research" rows={3} submitLabel="register" onSubmit={(v: string) => void x.registerResearch(i.id, v)} />
          </Box>
          {i.research ? <Text color={OLIVE}>{`Research registered (${i.research.length} characters).`}</Text> : null}
          <Text bold color={FG}>4. Template doc</Text>
          {actionButton(x, i, byKey('template_doc'), enabled)}
          {latestOf(i, 'template', 'template_doc') ? outputBlock(x, i, latestOf(i, 'template', 'template_doc')!, 'Template doc') : null}
        </Box>
      ) : null}
      {!mode ? <Text color={MUTED}>Pick a path. Build my own works with research on three reference games; Use existing picks a template from the Drive library.</Text> : null}
    </Box>
  )
}

function advanceRow(x: Ctx, i: Idea, stage: string) {
  const { Box, Text, Button } = x.C
  const next = nextStageOf(stage)
  if (!next || i.stage !== stage || isArchived(i)) return null
  const g = i.gate?.[stage]
  const asked = i.gateAsked?.[stage]
  const waiting = !!asked && (!g || g.at < asked)
  const blocked = safetyBlocked(i.scores, x.scoring)
  const nextName = nameOf(x.stages, next)
  return (
    <Box flexDirection="column" gap={1} borderStyle="round" borderColor={LINE} paddingX={1}>
      {g ? (
        <Text color={GATE_COLOR[g.verdict] ?? MUTED}>{`Principles gate: ${g.verdict}${g.reason ? `, ${clip(g.reason, 240)}` : ''}${g.override ? ' (overridden)' : ''}`}</Text>
      ) : null}
      {waiting ? (
        <Box gap={1} flexWrap="wrap">
          <Text color={AMBER}>Principles gate asked, waiting for the chat. It advances on its own on PASS.</Text>
          <Button key={`adv-nogate-${i.id}`} label="Advance without gate" onPress={() => x.advanceNoGate(i.id)} />
        </Box>
      ) : g && g.verdict === 'BLOCK' && asked ? (
        <Box gap={1} flexWrap="wrap">
          <Text bold color={RUST}>The gate blocked this step.</Text>
          <Button key={`adv-override-${i.id}`} label={`Override and advance to ${nextName}`} onPress={() => x.overrideAdvance(i.id)} />
        </Box>
      ) : (
        <Box gap={1} flexWrap="wrap">
          <Button key={`adv-${i.id}`} onPress={() => x.requestAdvance(i.id, false)}>
            <Text bold color={BG} backgroundColor={blocked ? SAND : CLAY}>{` Advance to ${nextName} `}</Text>
          </Button>
          {blocked ? <Button key={`adv-force-${i.id}`} label="Advance anyway (safety is low)" onPress={() => x.requestAdvance(i.id, true)} /> : null}
          {blocked ? <Text color={RUST}>Safety is below the gate. Confirm to advance.</Text> : null}
        </Box>
      )}
    </Box>
  )
}

function stagePanel(x: Ctx, i: Idea, stage: string) {
  const { Box, Text, Button } = x.C
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
  const key = `idea:${i.id}`
  return (
    <Box flexDirection="column" gap={1} borderStyle="round" borderColor={LINE} backgroundColor={PANEL} paddingX={1} paddingY={1}>
      <Box gap={2} flexWrap="wrap" alignItems="center">
        <Text bold color={NEON}>{nameOf(x.stages, stage)}</Text>
        {chip(x, state.t, state.c, `chk-${stage}`)}
        {openChatButton(x, 'idea', i.id, i.chat ?? null, () => x.openProtoChat(i.id, stage))}
        {askedAt ? <Text color={MUTED}>{`asked ${ago(askedAt, x.now)}`}</Text> : null}
        {pending ? <Button key={`refresh-${i.id}`} label="Refresh now" onPress={() => x.refreshNow(i.id)} /> : null}
        {check !== 'done' && enabled ? <Button key={`done-${i.id}-${stage}`} label="Mark done" onPress={() => x.markDone(i.id, stage)} /> : null}
      </Box>
      {!reached ? <Text color={AMBER}>This prototype has not reached this stage yet. Actions are off.</Text> : null}
      {pending ? <Text color={AMBER}>Waiting for the chat. The result shows here when it answers (checked every 30 seconds).</Text> : null}
      {stage === 'template' ? templateTools(x, i, enabled) : null}
      {acts.map(a => actionButton(x, i, a, enabled, stage === 'thumb' && gens.length > 0 ? 'Generate 5 more' : stage === 'titulo' && gens.length > 0 ? 'Generate more titles' : undefined))}
      {stage !== 'template' && !items && gens.length > 0 ? outputBlock(x, i, gens[0]!, 'Latest output') : null}
      {stage === 'template' && i.template ? <Text color={OLIVE}>{`Library template chosen: ${i.template.name}`}</Text> : null}
      {items ? itemsBlock(x, i, stage) : null}
      {!items && stage !== 'template' && gens.length === 0 ? <Text color={MUTED}>No output yet.</Text> : null}
      {!items && stage !== 'template' && gens.length > 1 ? (
        <Box flexDirection="column" gap={1}>
          <Button key={`hist-${i.id}-${stage}`} label={`${histOpen ? 'Hide' : 'Show'} history (${gens.length - 1} earlier)`} onPress={() => x.toggle(histId)} />
          {histOpen ? gens.slice(1).map(o => outputBlock(x, i, o, 'Earlier output')) : null}
        </Box>
      ) : null}
      {advanceRow(x, i, stage)}
    </Box>
  )
}

/* ---------- skills row (More section) ---------- */

export function skillsRow(x: Ctx) {
  const { Box, Text } = x.C
  const stages = ['coleta', 'triagem', ...IDEA_STAGES]
  const st = x.skills
  return (
    <Box flexDirection="column">
      <Text bold color={FG}>Skills in Drive</Text>
      {!st ? <Text color={MUTED}>Reading Drive...</Text> : null}
      {st && !st.ok ? <Text color={AMBER}>{st.error ?? 'Skills folder not readable.'}</Text> : null}
      {st && st.ok ? (
        <Text color={MUTED}>
          {stages
            .map(s => {
              const own = st.files[s] ?? []
              return `${s}: ${own.length}${own.length > 0 ? ` (${newest(own).slice(0, 10)})` : ''}`
            })
            .join('   ')}
          {`   _all: ${(st.files._all ?? []).length}${(st.files._all ?? []).length > 0 ? ` (${newest(st.files._all ?? []).slice(0, 10)})` : ''}`}
        </Text>
      ) : null}
    </Box>
  )
}

/* ---------- factory view ---------- */

export function factoryView(x: Ctx, moreBody: (stage: string) => any) {
  const { Box, Text } = x.C
  const idea = x.proto ? x.store.ideas.find(i => i.id === x.proto) : undefined
  if (!idea) {
    return (
      <Box flexDirection="column" gap={1}>
        {x.factoryNote ? <Text color={CLAY}>{x.factoryNote.text}</Text> : null}
        <Text bold color={FG}>{`Prototypes (${x.store.ideas.filter(i => !isArchived(i)).length})`}</Text>
        <Text color={MUTED}>Pick a prototype to work on it. Stage actions are off until you do.</Text>
        {protoList(x)}
      </Box>
    )
  }
  const stage = x.fstage && IDEA_STAGES.includes(x.fstage) ? x.fstage : idea.stage
  return (
    <Box flexDirection="column" gap={1}>
      {protoHeader(x, idea)}
      {stepper(x, idea)}
      {stagePanel(x, idea, stage)}
      {moreBody(stage)}
    </Box>
  )
}
