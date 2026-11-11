// The pre-validation scan block: potential, wedge, evidence, competitors, knockouts and the decision row. Presentation only.
import { AMBER, CLAY, FG, LINE_SOFT, MUTED, OLIVE, RUST, SAND, SKY } from '../theme'
import { ago } from '../views'
import type { Ctx } from '../views'
import { clip } from '../model'
import type { Idea, Output } from '../model'
import type { EvTag, Scan, Tagged } from '../scan'
import { btn, cardWidth, chip, kv, notice, rail, tint } from './kit'

const POT_COLOR = { ALTO: OLIVE, MEDIO: AMBER, BAIXO: RUST } as const
const CONF = { baixa: { t: 'CONF LOW', c: SAND }, media: { t: 'CONF MED', c: AMBER }, alta: { t: 'CONF HIGH', c: OLIVE } } as const
const TAG_COLOR: Record<EvTag, string> = { F: OLIVE, I: SKY, H: AMBER, V: RUST }
export const ADJUST_MAX = 200

// The potential chip and the wedge, for the collapsed Factory card.
export function scanSummary(x: Ctx, scan: Scan, key: string) {
  const { Box, Text } = x.C
  return (
    <Box key={key} gap={1} flexWrap="wrap" alignItems="center">
      {chip(x.C, scan.potential, POT_COLOR[scan.potential])}
      <Text color={MUTED}>{clip(scan.wedge.text, 70)}</Text>
    </Box>
  )
}

function tagged(x: Ctx, t: Tagged, w: number, key: string) {
  const { Box, Text } = x.C
  return (
    <Box key={key} gap={1} flexWrap="wrap">
      <Text color={FG}>{clip(t.text, w)}</Text>
      {t.tag ? tint(x.C, t.tag, TAG_COLOR[t.tag]) : null}
    </Box>
  )
}

// The latest scan, top to bottom as the spec lists it.
function scanBody(x: Ctx, i: Idea, o: Output, scan: Scan) {
  const { Box, Text } = x.C
  const w = cardWidth(x.columns) - 12
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Box gap={2} flexWrap="wrap" alignItems="center">
          {chip(x.C, scan.potential, POT_COLOR[scan.potential], `pot-${i.id}`)}
          {tint(x.C, CONF[scan.confidence].t, CONF[scan.confidence].c)}
          {tint(x.C, 'PROVISIONAL SCORES', SKY)}
          <Text color={MUTED}>{`gen ${o.gen}, ${ago(o.at, x.now)}`}</Text>
        </Box>
        {scan.reason.text ? tagged(x, scan.reason, w, `why-${i.id}`) : null}
      </Box>
      {kv(x.C, [{ k: 'Noun / verb', v: `${scan.noun} / ${scan.verb}` }], 12, `nv-${i.id}`)}
      <Box gap={1}>
        {rail(x.C, CLAY)}
        <Text color={MUTED}>{'Wedge'.padEnd(11)}</Text>
        <Text bold color={FG}>{clip(scan.wedge.text, w)}</Text>
        {scan.wedge.tag ? tint(x.C, scan.wedge.tag, TAG_COLOR[scan.wedge.tag]) : null}
      </Box>
      {scan.engine ? (
        <Box gap={1}>
          <Text color={MUTED}>{'Engine'.padEnd(12)}</Text>
          {/^NAO AVALIADO$/i.test(scan.engine) ? tint(x.C, 'NOT ASSESSED', SAND) : <Text color={FG}>{clip(scan.engine, w)}</Text>}
        </Box>
      ) : null}
      <Box flexDirection="column">
        <Box gap={1}>
          <Text bold color={OLIVE}>{'✔'}</Text>
          {tagged(x, scan.works, w, `ok-${i.id}`)}
        </Box>
        <Box gap={1}>
          <Text bold color={RUST}>{'✖'}</Text>
          {tagged(x, scan.fails, w, `no-${i.id}`)}
        </Box>
      </Box>
      {scan.competitors.length > 0 ? (
        <Box flexDirection="column">
          {scan.competitors.map((c, n) => (
            <Box key={`cmp-${i.id}-${n}`} gap={1} flexWrap="wrap">
              <Text bold color={FG}>{clip(c.game, 24)}</Text>
              <Text color={FG}>{clip(c.numbers, 60)}</Text>
              <Text color={MUTED}>{clip(c.implication.text, 40)}</Text>
              {c.implication.tag ? tint(x.C, c.implication.tag, TAG_COLOR[c.implication.tag]) : null}
              {c.deadClone ? tint(x.C, 'DEAD CLONE', AMBER) : null}
            </Box>
          ))}
        </Box>
      ) : null}
      <Box gap={1} flexWrap="wrap" alignItems="center">
        {scan.noKo ? tint(x.C, 'NO KO', OLIVE) : scan.knockouts.map((k, n) => (
          <Box key={`ko-${i.id}-${n}`} gap={1}>
            {chip(x.C, clip(k.name, 28), RUST)}
            {k.fix ? <Text color={MUTED}>{`fixable by: ${clip(k.fix, 40)}`}</Text> : null}
          </Box>
        ))}
      </Box>
      {scan.evidence ? <Text color={MUTED}>{clip(scan.evidence, w)}</Text> : null}
    </Box>
  )
}

const DECISION_LABEL: Record<string, string> = { brief: 'BRIEF CHOSEN', adjusting: 'ADJUSTING', stopped: 'STOPPED' }

// One primary button only: the brief. Adjust and Stop sit beside it as secondary and danger.
function decisionRow(x: Ctx, i: Idea, scan: Scan, enabled: boolean) {
  const { Box, Text, Input } = x.C
  const adjId = `adjust:${i.id}`
  const stopId = `stop:${i.id}`
  const adjOpen = x.open.includes(adjId)
  const stopArmed = x.open.includes(stopId)
  const briefAsked = i.checks?.brief === 'asked' || i.checks?.brief === 'done'
  return (
    <Box flexDirection="column" gap={1}>
      <Box gap={2} flexWrap="wrap" alignItems="center">
        {btn(x.C, `dec-brief-${i.id}`, 'Write 2-page brief', 'primary', () => x.decide(i.id, 'brief'), { disabled: !enabled || briefAsked })}
        {btn(x.C, `dec-adjust-${i.id}`, adjOpen ? 'Cancel adjust' : 'Adjust idea', 'secondary', () => x.toggle(adjId), { disabled: !enabled })}
        {btn(x.C, `dec-stop-${i.id}`, stopArmed ? 'Press again to stop' : 'Stop here', 'danger', () => (stopArmed ? x.stopHere(i.id) : x.toggle(stopId)), { disabled: !enabled })}
        {i.decision && DECISION_LABEL[i.decision] ? tint(x.C, DECISION_LABEL[i.decision]!, CLAY) : null}
      </Box>
      {scan.potential === 'BAIXO' ? notice(x.C, 'warn', 'Chat recommends stopping.') : null}
      {adjOpen ? (
        <Input key={`adj-in-${i.id}`} placeholder={`What should change? Short note, max ${ADJUST_MAX} characters`} rows={1} submitLabel="Re-scan" onSubmit={(v: string) => void x.adjustScan(i.id, v)} />
      ) : null}
      {stopArmed ? <Text color={MUTED}>This logs STOPPED_AT_SCAN in the chat and archives the prototype.</Text> : null}
    </Box>
  )
}

// The stage body for pre-validation: latest valid scan with its decisions, or the raw reply and what was wrong with it.
export function scanPanel(x: Ctx, i: Idea, gens: Output[], enabled: boolean) {
  const { Box, Text } = x.C
  const latest = gens[0]
  if (!latest) return null
  const histId = `hist:${i.id}:prevalid`
  const histOpen = x.open.includes(histId)
  const older = gens.slice(1)
  return (
    <Box flexDirection="column" gap={1}>
      <Box key={`scan-${i.id}-${latest.gen}`} flexDirection="column" gap={1} borderStyle="round" borderColor={LINE_SOFT} paddingX={1}>
        {latest.scan ? (
          scanBody(x, i, latest, latest.scan)
        ) : (
          <Box flexDirection="column" gap={1}>
            {notice(x.C, 'warn', `Scan format not recognized: ${(latest.scanErrors ?? ['no scan lines found']).join('; ')}`)}
            <Text color={FG}>{clip(latest.content, 1500)}</Text>
          </Box>
        )}
      </Box>
      {latest.scan ? decisionRow(x, i, latest.scan, enabled) : null}
      {older.length > 0 ? (
        <Box flexDirection="column" gap={1}>
          <Box>{btn(x.C, `hist-${i.id}-prevalid`, `${histOpen ? 'Hide' : 'Show'} history (${older.length} earlier)`, 'quiet', () => x.toggle(histId))}</Box>
          {histOpen
            ? older.map(o => (
                <Box key={`old-${i.id}-${o.gen}-${o.at}`} flexDirection="column" borderStyle="round" borderColor={LINE_SOFT} paddingX={1}>
                  <Text dimColor color={MUTED}>{`Earlier scan, gen ${o.gen}, ${ago(o.at, x.now)}`}</Text>
                  {o.scan ? <Text dimColor color={FG}>{clip(`${o.scan.potential}: ${o.scan.wedge.text}`, 140)}</Text> : <Text dimColor color={FG}>{clip(o.content, 300)}</Text>}
                </Box>
              ))
            : null}
        </Box>
      ) : null}
    </Box>
  )
}
