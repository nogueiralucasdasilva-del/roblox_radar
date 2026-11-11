// The Ready check section (under More) and its colors. Presentation only.
import { AMBER, FG, MUTED, OLIVE, RUST, SAND } from '../theme'
import { ago } from '../views'
import type { Ctx } from '../views'
import { clip } from '../model'
import { overallLevel } from '../ready'
import type { Level } from '../ready'
import { btn, cardWidth, sectionTitle } from './kit'

export const LEVEL: Record<Level, { glyph: string; color: string }> = {
  green: { glyph: '●', color: OLIVE },
  amber: { glyph: '▲', color: AMBER },
  red: { glyph: '✖', color: RUST },
}

// The color of the one dot in the header: grey until the check has run.
export function readyColor(x: Ctx): string {
  return x.ready ? LEVEL[overallLevel(x.ready.items)].color : SAND
}

export function readyBlock(x: Ctx) {
  const { Box, Text } = x.C
  const w = cardWidth(x.columns) - 8
  const r = x.ready
  const open = x.open.includes('selftest:detail')
  return (
    <Box flexDirection="column" gap={1}>
      {sectionTitle(x.C, 'Ready check', r ? r.items.length : undefined, w)}
      <Box gap={2} flexWrap="wrap" alignItems="center">
        {btn(x.C, 'ready-run', x.readyBusy ? 'Running...' : 'Run ready check', 'primary', () => x.runReady(), { disabled: x.readyBusy })}
        {btn(x.C, 'selftest-run', 'Run self-test', 'secondary', () => x.runSelftest())}
        <Text color={MUTED}>{r ? `checked ${ago(r.at, x.now)}` : 'not run yet'}</Text>
      </Box>
      {r ? (
        <Box flexDirection="column">
          {r.items.map(i => (
            <Box key={`rdy-${i.id}`} gap={1}>
              <Text bold color={LEVEL[i.level].color}>{LEVEL[i.level].glyph}</Text>
              <Text color={FG}>{i.label.padEnd(24)}</Text>
              <Text color={i.level === 'green' ? MUTED : LEVEL[i.level].color}>{clip(i.text, Math.max(20, w - 30))}</Text>
            </Box>
          ))}
        </Box>
      ) : null}
      {x.selfResults ? (
        <Box flexDirection="column">
          <Box>{btn(x.C, 'selftest-detail', open ? 'Hide self-test files' : `Show self-test files (${x.selfResults.length})`, 'quiet', () => x.toggle('selftest:detail'))}</Box>
          {open
            ? x.selfResults.map(s => (
                <Box key={`st-${s.file}`} gap={1}>
                  <Text color={s.ok ? OLIVE : RUST}>{s.ok ? '✔' : '✖'}</Text>
                  <Text color={FG}>{s.file}</Text>
                  {!s.ok ? <Text color={RUST}>{clip(s.detail, 120)}</Text> : null}
                </Box>
              ))
            : null}
        </Box>
      ) : null}
    </Box>
  )
}
