// Presentational kit. Pure: it takes the host components and returns elements, never a handler.
// Rules of the host that every helper respects: a Button holds only Text children, and a Text never holds a Text.
import { AMBER, AMBER_BG, BG, CLAY, CLAY_BG, FG, LINE_SOFT, MUTED, NEON, OLIVE, OLIVE_BG, RUST, RUST_BG, SAND, SKY, SKY_BG, USER_BG } from '../theme'

export type Comps = { Box: any; Text: any; Button: any; Input: any; Link?: any }

// Width tiers. Everything that depends on the width asks for the tier instead of using its own number.
export type Tier = 'narrow' | 'standard' | 'wide'
export const tierOf = (columns: number): Tier => (columns < 70 ? 'narrow' : columns < 110 ? 'standard' : 'wide')

// Card width in cells: full width, never wider than 110.
export const cardWidth = (columns: number): number => Math.max(30, Math.min(110, columns - 4))

const TINT_BG: Record<string, string> = { [OLIVE]: OLIVE_BG, [AMBER]: AMBER_BG, [RUST]: RUST_BG, [SKY]: SKY_BG, [CLAY]: CLAY_BG }

// Solid state label: DONE, ASKED, NOT STARTED, READY, DRAFT, PASS, MAYBE, REJECT, ARCHIVED.
export function chip(C: Comps, label: string, color: string, key?: string) {
  const { Text } = C
  return (
    <Text key={key} bold color={BG} backgroundColor={color}>
      {` ${label.toUpperCase()} `}
    </Text>
  )
}

// Quiet label for secondary information.
export function tint(C: Comps, label: string, color: string, key?: string) {
  const { Text } = C
  return (
    <Text key={key} color={color} backgroundColor={TINT_BG[color] ?? USER_BG}>
      {` ${label} `}
    </Text>
  )
}

// One item of a segmented control. Place adjacent pills in a Box with gap 0.
export function pill(C: Comps, label: string, active: boolean, key?: string) {
  const { Text } = C
  return (
    <Text key={key} bold={active} color={active ? BG : MUTED} backgroundColor={active ? NEON : USER_BG}>
      {label}
    </Text>
  )
}

export type BtnKind = 'primary' | 'secondary' | 'quiet' | 'danger' | 'tab'

// The Text to put inside a Button. The Button keeps its own key, onPress and hotkey.
export function btnText(C: Comps, label: string, kind: BtnKind, opts: { disabled?: boolean; active?: boolean } = {}) {
  const { Text } = C
  if (kind === 'primary') {
    return (
      <Text bold color={BG} backgroundColor={opts.disabled ? SAND : NEON}>
        {` ▶ ${label} `}
      </Text>
    )
  }
  if (kind === 'secondary') {
    return (
      <Text color={FG} backgroundColor={USER_BG}>
        {` ${label} `}
      </Text>
    )
  }
  if (kind === 'danger') {
    return (
      <Text color={RUST} backgroundColor={RUST_BG}>
        {` ${label} `}
      </Text>
    )
  }
  if (kind === 'tab') {
    return (
      <Text bold={!!opts.active} underline={!!opts.active} color={opts.active ? NEON : MUTED}>
        {label}
      </Text>
    )
  }
  return <Text color={SKY}>{label}</Text>
}

// A Button that already looks right. Keeps onPress, key and hotkey exactly as the caller gives them.
export function btn(C: Comps, key: string, label: string, kind: BtnKind, onPress: () => unknown, opts: { disabled?: boolean; active?: boolean; hotkey?: string } = {}) {
  const { Button } = C
  return (
    <Button key={key} hotkey={opts.hotkey} onPress={onPress}>
      {btnText(C, label, kind, opts)}
    </Button>
  )
}

export const meterColor = (v: number): string => (v < 40 ? RUST : v < 70 ? AMBER : OLIVE)

export function meterText(v: number, width = 10): string {
  const n = Math.max(0, Math.min(width, Math.round((v / 100) * width)))
  return '█'.repeat(n) + '░'.repeat(width - n)
}

// Stage progress: one cell per stage. done ▰, not done ▱.
export function progressText(done: boolean[]): string {
  return done.map(d => (d ? '▰' : '▱')).join('')
}

// Section divider, with an optional inline label.
export function rule(C: Comps, width: number, label?: string, key?: string) {
  const { Text } = C
  const w = Math.max(4, width)
  const line = label ? `── ${label} ${'─'.repeat(Math.max(2, w - label.length - 4))}` : '─'.repeat(w)
  return (
    <Text key={key} color={LINE_SOFT}>
      {line.slice(0, w)}
    </Text>
  )
}

// Key-value block with a fixed label column.
export function kv(C: Comps, rows: { k: string; v: string; color?: string }[], labelW = 10, key = 'kv') {
  const { Box, Text } = C
  return (
    <Box key={key} flexDirection="column">
      {rows.map(r => (
        <Box key={`${key}-${r.k}`}>
          <Text color={MUTED}>{r.k.padEnd(labelW)}</Text>
          <Text color={r.color ?? FG}>{r.v}</Text>
        </Box>
      ))}
    </Box>
  )
}

const NOTICE: Record<string, { glyph: string; color: string }> = {
  warn: { glyph: '▲', color: AMBER },
  error: { glyph: '✖', color: RUST },
  info: { glyph: '●', color: SKY },
  ok: { glyph: '✔', color: OLIVE },
}

// One line: glyph, then the text in the same color on its tint.
export function notice(C: Comps, level: 'warn' | 'error' | 'info' | 'ok', text: string, key?: string) {
  const { Text } = C
  const n = NOTICE[level] ?? NOTICE.info!
  return (
    <Text key={key} color={n.color} backgroundColor={TINT_BG[n.color]}>
      {` ${n.glyph} ${text} `}
    </Text>
  )
}

export function emptyState(C: Comps, title: string, hint?: string, key?: string) {
  const { Box, Text } = C
  return (
    <Box key={key} flexDirection="column">
      <Text color={LINE_SOFT}>{'┄'.repeat(28)}</Text>
      <Text color={FG}>{`○ ${title}`}</Text>
      {hint ? <Text color={MUTED}>{`  ${hint}`}</Text> : null}
      <Text color={LINE_SOFT}>{'┄'.repeat(28)}</Text>
    </Box>
  )
}

// Status rail on the left edge of a row. The host types do not confirm that a filled Box stretches to the row height,
// so the rail is a glyph column (the fallback the design brief names).
export function rail(C: Comps, color: string, key?: string) {
  const { Text } = C
  return (
    <Text key={key} color={color}>
      {'▌'}
    </Text>
  )
}

export function sectionTitle(C: Comps, text: string, count?: number, width = 40, key?: string) {
  const { Box, Text } = C
  return (
    <Box key={key} flexDirection="column">
      <Box gap={1}>
        <Text bold color={FG}>{text}</Text>
        {count !== undefined ? <Text color={MUTED}>{String(count)}</Text> : null}
      </Box>
      {rule(C, width)}
    </Box>
  )
}

export { CLAY }
