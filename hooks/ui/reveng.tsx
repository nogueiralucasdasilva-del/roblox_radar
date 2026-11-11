// The reference candidates (from the 2-page brief) and the Reverse engineering stage panel.
// Presentation only: every handler comes from Ctx. A Button holds only Text, a Text never holds a Text.
import { AMBER, BG, CLAY, FG, LINE_SOFT, MUTED, NEON, OLIVE, PANEL, RUST, SAND } from '../theme'
import { ago, nameOf, openChatButton } from '../views'
import type { Ctx } from '../views'
import { clip } from '../model'
import type { Idea, RefCandidate } from '../model'
import { docLinks, docsOf, isPending, templateDone } from '../factory'
import { actionByKey } from '../actions'
import { MAX_SEGMENTS, OVERLAP_SECONDS, SEGMENT_SECONDS, segmentLabel } from '../segments'
import { btn, cardWidth, chip, emptyState, notice, pill, rail, rule, tint } from './kit'

const TAG_COLOR: Record<string, string> = { F: OLIVE, H: AMBER, V: RUST }

// One candidate as a compact row. With `onChoose`, a Choose button; the chosen row gets an OLIVE rail and a CHOSEN chip.
function refRow(x: Ctx, i: Idea, c: RefCandidate, n: number, chosen: boolean, onChoose: (() => unknown) | null) {
  const { Box, Text, Link } = x.C
  const w = cardWidth(x.columns) - 10
  const stats = [c.visits ? `${c.visits} visits` : '', c.approval_pct ? `${c.approval_pct} approval` : '', c.ccu ? `${c.ccu} now${c.as_of ? ` (${c.as_of})` : ''}` : c.as_of ? `as of ${c.as_of}` : ''].filter(Boolean).join('   ')
  return (
    <Box key={`ref-${i.id}-${n}`} flexDirection="column" borderStyle="round" borderColor={chosen ? OLIVE : LINE_SOFT} paddingX={1}>
      <Box gap={1} flexWrap="wrap" alignItems="center">
        {chosen ? rail(x.C, OLIVE, `rr-${n}`) : <Text color={MUTED}>{`${n + 1}.`}</Text>}
        {c.url && Link ? <Link key={`reflink-${i.id}-${n}`} href={c.url} label={clip(c.name, 50)} /> : <Text bold color={FG}>{clip(c.name, 50)}</Text>}
        {c.tag ? tint(x.C, `evidence ${c.tag}`, TAG_COLOR[c.tag] ?? SAND) : null}
        {chosen ? chip(x.C, 'chosen', OLIVE) : null}
        {onChoose && !chosen ? btn(x.C, `choose-ref-${i.id}-${n}`, 'Choose', 'secondary', onChoose) : null}
      </Box>
      {stats ? <Text color={FG}>{clip(stats, w)}</Text> : null}
      {c.why_fit ? <Text color={MUTED}>{clip(`Why it fits: ${c.why_fit}`, w)}</Text> : null}
      {c.risk ? <Text color={AMBER}>{clip(`Risk: ${c.risk}`, w)}</Text> : null}
    </Box>
  )
}

// The three candidates. `choose` adds the Choose buttons (Reverse engineering); the brief card shows the same rows without them.
export function refsBlock(x: Ctx, i: Idea, choose: boolean) {
  const { Box, Text } = x.C
  const refs = i.refs
  if (!refs || refs.candidates.length === 0) return null
  return (
    <Box flexDirection="column" gap={1}>
      <Text bold color={FG}>{`Reference candidates (${refs.candidates.length})`}</Text>
      {refs.candidates.map((c, n) => refRow(x, i, c, n, refs.chosenIndex === n, choose ? () => x.chooseRef(i.id, n) : null))}
    </Box>
  )
}

/* ---------- Reverse engineering stage panel ---------- */

const VERDICT_COLOR: Record<string, string> = { PASS: OLIVE, 'PASS WITH GAPS': AMBER, FAIL: RUST }

// One action of this stage as a button. The next step is the primary; a blocked one keeps its place and shows why.
function stepAction(x: Ctx, i: Idea, key: string, enabled: boolean, primary: boolean) {
  const { Box, Text } = x.C
  const a = actionByKey(key)
  if (!a) return null
  const blocked = a.needs ? a.needs(i) : null
  const off = !enabled || !!blocked
  return (
    <Box gap={1} flexWrap="wrap" alignItems="center">
      {btn(x.C, `actb-${i.id}-${a.key}`, a.label, primary ? 'primary' : 'secondary', () => (off ? undefined : x.runFactory(i.id, a.key)), { disabled: off })}
      {blocked && enabled ? <Text color={AMBER}>{blocked}</Text> : null}
    </Box>
  )
}

function stepTitle(x: Ctx, n: number, text: string, next: boolean) {
  const { Box, Text } = x.C
  return (
    <Box gap={1} alignItems="center">
      <Text bold color={BG} backgroundColor={next ? NEON : CLAY}>{` ${n} `}</Text>
      <Text bold color={next ? NEON : FG}>{text}</Text>
      {next ? <Text color={NEON}>next</Text> : null}
    </Box>
  )
}

function checklistRow(x: Ctx, done: boolean, text: string, extra?: any) {
  const { Box, Text } = x.C
  return (
    <Box key={`cl-${text}`} gap={1} alignItems="center">
      <Text color={done ? OLIVE : SAND}>{done ? '✔' : '○'}</Text>
      <Text color={done ? FG : MUTED}>{text}</Text>
      {extra}
    </Box>
  )
}

export function revengPanel(x: Ctx, i: Idea, enabled: boolean) {
  const { Box, Text, Button, Input } = x.C
  const w = cardWidth(x.columns)
  const rv = i.reveng
  const segment = rv?.segment ?? 1
  const mode = rv?.mode ?? 'extract'
  const noEconomy = rv?.noEconomy ?? false
  const refChosen = !!i.refs && i.refs.chosenIndex !== null
  const upload = rv && rv.gen > 0 ? rv.uploads[rv.gen] : undefined
  const verdict = rv?.verdict
  const verdictOk = verdict === 'PASS' || verdict === 'PASS WITH GAPS'
  const hasTemplateDoc = (i.docs?.template ?? []).some(d => d.kind === 'template-doc')
  const done = templateDone(i)
  // The one primary: the next step to do.
  const next = !refChosen ? 0 : !upload || verdict === 'FAIL' ? 2 : !verdict ? 3 : !hasTemplateDoc ? 4 : 0
  const note = x.revengNote(i.id)
  const briefDone = docLinks(i, 'brief').length > 0
  const report = (i.outputs?.template ?? []).find(o => o.kind === 'reveng_validation')
  const chunks = upload ? upload.files.filter(f => f.kind === 'chunk').length : 0
  const audits = upload ? upload.files.filter(f => f.kind === 'audit').length : 0
  const promptOpen = x.open.includes(`prompt:${i.id}`)
  const segs = Array.from({ length: MAX_SEGMENTS }, (_, k) => k + 1)
  return (
    <Box flexDirection="column" gap={1}>
      {i.refs && i.refs.candidates.length > 0 ? (
        refsBlock(x, i, true)
      ) : briefDone ? (
        <Box gap={1} flexWrap="wrap" alignItems="center">
          {btn(x.C, `actb-${i.id}-refs`, 'Find references', 'secondary', () => x.runFactory(i.id, 'refs'))}
          <Text color={MUTED}>No reference candidates yet.</Text>
        </Box>
      ) : (
        <Text color={MUTED}>The references come from the 2-page brief. Write the brief first.</Text>
      )}
      {rule(x.C, w - 6)}
      <Box flexDirection="column">
        {checklistRow(x, refChosen, 'Reference chosen', refChosen && i.refs ? <Text color={MUTED}>{clip(i.refs.candidates[i.refs.chosenIndex as number]?.name ?? '', 40)}</Text> : null)}
        {checklistRow(x, !!upload, 'Files uploaded', upload ? <Text color={MUTED}>{`batch ${rv?.gen}: ${chunks} chunk${chunks === 1 ? '' : 's'}${audits > 0 ? `, ${audits} audit${audits === 1 ? '' : 's'}` : ''}`}</Text> : null)}
        {checklistRow(x, verdictOk, 'Validation verdict', verdict ? chip(x.C, verdict, VERDICT_COLOR[verdict] ?? SAND) : null)}
        {checklistRow(x, hasTemplateDoc, 'Template doc')}
      </Box>
      {rule(x.C, w - 6)}

      {stepTitle(x, 1, 'Copy prompt JSON', false)}
      <Box flexDirection="column" gap={1} paddingLeft={2}>
        <Box gap={2} flexWrap="wrap" alignItems="center">
          <Text color={MUTED}>Segment</Text>
          <Box gap={0} flexWrap="wrap">
            {segs.map(n => (
              <Button key={`seg-${i.id}-${n}`} onPress={() => x.setReveng(i.id, { segment: n })}>
                {pill(x.C, ` ${n} `, segment === n)}
              </Button>
            ))}
          </Box>
          <Box gap={0}>
            <Button key={`mode-extract-${i.id}`} onPress={() => x.setReveng(i.id, { mode: 'extract' })}>
              {pill(x.C, ' Extract ', mode === 'extract')}
            </Button>
            <Button key={`mode-audit-${i.id}`} onPress={() => x.setReveng(i.id, { mode: 'audit' })}>
              {pill(x.C, ' Audit ', mode === 'audit')}
            </Button>
          </Box>
        </Box>
        <Box gap={2} flexWrap="wrap" alignItems="center">
          {btn(x.C, `copy-prompt-${i.id}`, 'Copy prompt JSON', 'secondary', (press: any) => x.copyPrompt(i.id, press))}
          <Text color={MUTED}>{`Segment ${segment}: ${segmentLabel(segment)} (${SEGMENT_SECONDS}s plus ${OVERLAP_SECONDS}s overlap)`}</Text>
        </Box>
        {note ? notice(x.C, note.level === 'ok' ? 'ok' : note.level === 'warn' ? 'warn' : 'error', note.text) : null}
        {note && note.prompt ? (
          <Box flexDirection="column" gap={1}>
            <Box>{btn(x.C, `prompt-show-${i.id}`, promptOpen ? 'Hide the prompt' : 'Show the prompt', 'quiet', () => x.toggle(`prompt:${i.id}`))}</Box>
            {promptOpen ? (
              <Box borderStyle="round" borderColor={LINE_SOFT} backgroundColor={PANEL} paddingX={1}>
                <Text color={FG}>{note.prompt}</Text>
              </Box>
            ) : null}
          </Box>
        ) : null}
      </Box>

      {stepTitle(x, 2, 'Upload doc', next === 2)}
      <Box flexDirection="column" gap={1} paddingLeft={2}>
        <Text color={MUTED}>Paste the path of each extraction file, or of a folder, one per line or separated by semicolons.</Text>
        <Box borderStyle="round" borderColor={next === 2 ? NEON : CLAY} paddingX={1}>
          <Input key={`upload-${i.id}`} placeholder="C:/path/to/chunk_01.json" rows={2} submitLabel="Upload doc" onSubmit={(v: string) => void x.uploadDocs(i.id, v)} />
        </Box>
        {!refChosen ? <Text color={AMBER}>Choose a reference first.</Text> : null}
        {note && note.fsFailed ? <Box>{btn(x.C, `scan-inputs-${i.id}`, 'Scan Drive inputs folder', 'secondary', () => x.scanInputs(i.id))}</Box> : null}
      </Box>

      {stepTitle(x, 3, 'Validate doc', next === 3)}
      <Box flexDirection="column" gap={1} paddingLeft={2}>
        <Box gap={2} flexWrap="wrap" alignItems="center">
          <Text color={MUTED}>Economy game</Text>
          <Box gap={0}>
            <Button key={`econ-yes-${i.id}`} onPress={() => x.setReveng(i.id, { noEconomy: false })}>
              {pill(x.C, ' Yes ', !noEconomy)}
            </Button>
            <Button key={`econ-no-${i.id}`} onPress={() => x.setReveng(i.id, { noEconomy: true })}>
              {pill(x.C, ' No ', noEconomy)}
            </Button>
          </Box>
        </Box>
        {stepAction(x, i, 'reveng_validate', enabled, next === 3)}
        {verdict ? (
          <Box gap={1} flexWrap="wrap" alignItems="center">
            {chip(x.C, verdict, VERDICT_COLOR[verdict] ?? SAND)}
            {rv?.verdictReason ? <Text color={MUTED}>{clip(rv.verdictReason, 200)}</Text> : null}
          </Box>
        ) : null}
        {verdict === 'FAIL' ? notice(x.C, 'error', 'Validation failed. Upload another file set, provide another video, or choose another reference. Upload and Validate stay available.') : null}
        {report ? (
          <Box flexDirection="column" borderStyle="round" borderColor={LINE_SOFT} paddingX={1}>
            <Text color={MUTED}>{`Validation report, gen ${report.gen}, ${ago(report.at, x.now)}`}</Text>
            <Text color={FG}>{clip(report.content, 1800)}</Text>
          </Box>
        ) : null}
      </Box>

      {stepTitle(x, 4, 'Build template doc', next === 4)}
      <Box flexDirection="column" gap={1} paddingLeft={2}>
        {stepAction(x, i, 'reveng_build', enabled, next === 4)}
        {done ? notice(x.C, 'ok', 'Reverse engineering is done. Advance to the next stage.') : null}
      </Box>
    </Box>
  )
}
