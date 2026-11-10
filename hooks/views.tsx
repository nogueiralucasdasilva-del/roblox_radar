import type { Report, ReportItem, SourceStatus, SourcesFile, ReportsFile, Stage } from '../types'
import { AMBER, CLAY, FG, LINE, MUTED, NEON, OLIVE, PANEL, RUST, SAND, SKY, BG } from './theme'
import { KNOWLEDGE_KINDS, clip } from './model'
import type { ChatLink, IdeaStatus, Knowledge, KnowledgeKind, Store } from './model'
import { isLate, latestPerTask, receiptsFor } from './receipts'
import type { Template } from './templates'
import type { ScoringConfig } from './scoring'
import type { SkillsState } from './skills'
import type { Outcome, Receipt } from './receipts'

// Components come from $.ui.resolve(e) at render time.
export type Components = { Box: any; Text: any; Button: any; Input: any; Link?: any }

export type Ctx = {
  C: Components
  columns: number
  now: number
  store: Store
  stages: Stage[]
  sources: SourcesFile | null
  reports: ReportsFile | null
  receipts: Receipt[]
  rcp: { at: string; ok: boolean; error?: string } | null
  open: string[]
  toggle: (id: string) => unknown
  go: (stageId: string) => unknown
  sendItem: (report: Report, sectionIdx: number, itemIdx: number) => unknown
  saveHook: (report: Report, item: ReportItem) => unknown
  openChat: (kind: 'idea' | 'stage', scope: string) => unknown
  runTask: (triggerId: string) => unknown
  templates: { at: string; ok: boolean; error?: string; list: Template[] } | null
  chooseTemplate: (ideaId: string, templateId: string | null) => unknown
  refreshTemplates: () => unknown
  chatError: (key: string) => string | null
  chatBusy: (key: string) => boolean
  addKnowledge: (stageId: string, raw: string) => unknown
  removeKnowledge: (stageId: string, id: string) => unknown
  // 0.7.0 Radar inbox and Factory
  scoring: ScoringConfig
  skills: SkillsState | null
  sendToFactory: (src: { kind: 'inbox'; id: string } | { kind: 'advisor'; report: Report; si: number; ii: number }) => unknown
  addInbox: (raw: string) => unknown
  discardInbox: (id: string) => unknown
  factoryNote: { ideaId: string; text: string } | null
  selectProto: (id: string | null) => unknown
  proto: string | null
  showArchived: boolean
  toggleArchived: () => unknown
  protoMenu: boolean
  toggleProtoMenu: () => unknown
  changeProto: () => unknown
  fstage: string | null
  setFstage: (id: string) => unknown
  openProtoChat: (ideaId: string, stageId: string) => unknown
  runFactory: (ideaId: string, key: string) => unknown
  markDone: (ideaId: string, stageId: string) => unknown
  requestAdvance: (ideaId: string, force: boolean) => unknown
  overrideAdvance: (ideaId: string) => unknown
  advanceNoGate: (ideaId: string) => unknown
  refreshNow: (ideaId: string) => unknown
  pickItem: (ideaId: string, stageId: string, item: string, mode: 'choose' | 'discard') => unknown
  registerResearch: (ideaId: string, text: string) => unknown
  setTemplateMode: (ideaId: string, mode: 'library' | 'custom') => unknown
  renameAbbr: (ideaId: string, raw: string) => unknown
  archive: (ideaId: string, on: boolean) => unknown
}

const STATUS_META: Record<SourceStatus, { glyph: string; color: string; label: string }> = {
  working: { glyph: '✔', color: OLIVE, label: 'WORKING' },
  attention: { glyph: '▲', color: AMBER, label: 'ATTENTION' },
  stale: { glyph: '◷', color: SKY, label: 'STALE' },
  broken: { glyph: '✖', color: RUST, label: 'BROKEN' },
  unknown: { glyph: '?', color: SAND, label: 'UNKNOWN' },
}

export const IDEA_COLOR: Record<IdeaStatus, string> = { pending: AMBER, promising: OLIVE, rejected: RUST }
export const IDEA_LABEL: Record<IdeaStatus, string> = { pending: 'PENDING', promising: 'PROMISING', rejected: 'REJECTED' }
const VERDICT_COLOR: Record<string, string> = { PASS: OLIVE, MAYBE: AMBER, REJECT: RUST, HOOK: SKY }
export const POTENTIAL_COLOR: Record<string, string> = { HIGH: OLIVE, MEDIUM: AMBER, LOW: RUST }
const KIND_COLOR: Record<KnowledgeKind, string> = { principle: CLAY, technique: OLIVE, pattern: SKY, pitfall: RUST, result: AMBER }

export function ago(iso: string | null, now: number): string {
  if (!iso) return 'unknown time';
  const ms = now - Date.parse(iso)
  if (!Number.isFinite(ms) || ms < 0) return 'just now'
  const h = Math.floor(ms / 3600000)
  if (h < 1) return `${Math.max(1, Math.floor(ms / 60000))} min ago`
  if (h < 48) return `${h} h ago`
  return `${Math.floor(h / 24)} days ago`
}

export function nameOf(stages: Stage[], id: string): string {
  return stages.find(s => s.id === id)?.name ?? id
}

/* ---------- Sources (collection stage) ---------- */

export function sourcesView(x: Ctx) {
  const { Box, Text } = x.C
  const f = x.sources
  if (!f) return <Text color={RUST}>Could not read data/sources.json.</Text>
  const counts: Record<string, number> = {}
  for (const s of f.sources) counts[s.status] = (counts[s.status] ?? 0) + 1
  const perRow = x.columns >= 110 ? 2 : 1
  const w = Math.floor((x.columns - 8 - (perRow - 1)) / perRow)
  return (
    <Box flexDirection="column" gap={1}>
      <Box gap={2} flexWrap="wrap">
        {(Object.keys(STATUS_META) as SourceStatus[])
          .filter(k => (counts[k] ?? 0) > 0)
          .map(k => (
            <Text key={`cnt-${k}`} bold color={STATUS_META[k].color}>
              {STATUS_META[k].glyph} {counts[k]} {STATUS_META[k].label.toLowerCase()}
            </Text>
          ))}
      </Box>
      <Text color={FG}>{f.summary}</Text>
      <Text color={MUTED}>{f.origin}</Text>
      <Box flexDirection="row" flexWrap="wrap" gap={1}>
        {f.sources.map(s => {
          const m = STATUS_META[s.status] ?? STATUS_META.unknown
          return (
            <Box
              key={`src-${s.id}`}
              flexDirection="column"
              borderStyle="round"
              borderColor={m.color}
              backgroundColor={PANEL}
              paddingX={1}
              width={w}
            >
              <Box gap={1}>
                <Text bold color={m.color}>
                  {m.glyph}
                </Text>
                <Text bold color={FG}>
                  {s.name}
                </Text>
                <Text bold color={m.color}>
                  {m.label}
                </Text>
              </Box>
              <Text color={MUTED}>
                {s.family}, {s.cadence}
              </Text>
              <Text color={FG}>
                Collected {s.collected_label} ({ago(s.collected_at, x.now)})
              </Text>
              <Text color={MUTED}>{s.note}</Text>
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}

/* ---------- Reports (advisor stage) ---------- */

export function reportsView(x: Ctx) {
  const { Box, Text, Button } = x.C
  const f = x.reports
  if (!f) return <Text color={RUST}>Could not read data/reports.json.</Text>
  const reports = [...f.reports].sort((a, b) => b.date.localeCompare(a.date))
  // The latest report starts expanded; clicking its header collapses it (the toggle list flips the default).
  const latestId = reports[0] ? `rep:${reports[0].id}` : ''
  return (
    <Box flexDirection="column" gap={1}>
      <Text color={FG}>Latest report is open. Send an idea from it to the Factory.</Text>
      <Text color={MUTED}>{f.origin}</Text>
      {reports.map(r => {
        const id = `rep:${r.id}`
        const isOpen = x.open.includes(id) !== (id === latestId)
        return (
          <Box
            key={`rep-${r.id}`}
            flexDirection="column"
            borderStyle="round"
            borderColor={isOpen ? CLAY : LINE}
            backgroundColor={PANEL}
            paddingX={1}
          >
            <Button key={`rep-toggle-${r.id}`} onPress={() => x.toggle(id)}>
              <Text bold color={isOpen ? CLAY : FG}>
                {isOpen ? '▾ ' : '▸ '}
                {r.date}
              </Text>
              <Text bold color={r.kind === 'themes' ? OLIVE : SKY}>
                {'  '}
                {r.title}
              </Text>
              <Text color={MUTED}>
                {'  '}
                {r.summary}
              </Text>
            </Button>
            {isOpen ? (
              <Box flexDirection="column" gap={1} paddingTop={1}>
                <Text color={MUTED}>
                  Posted {r.posted} in {r.channel}.
                </Text>
                {r.kind === 'hooks' ? (
                  <Text color={MUTED}>Hooks are art ideas for existing games. You can still send one as a raw idea.</Text>
                ) : null}
                {r.sections.map((sec, si) => (
                  <Box key={`sec-${r.id}-${si}`} flexDirection="column">
                    <Text bold color={FG}>
                      {sec.name}
                    </Text>
                    {sec.items.map((it, ii) => {
                      const from = `${r.id}#${si}.${ii}`
                      const sent = x.store.ideas.find(i => i.from === from)
                      const inInbox = x.store.inbox.find(i => i.from === from)
                      const vc = VERDICT_COLOR[it.verdict] ?? MUTED
                      return (
                        <Box key={`it-${from}`} flexDirection="column" paddingLeft={1}>
                          <Box gap={1} flexWrap="wrap">
                            <Text color={vc}>●</Text>
                            <Text bold color={FG}>
                              {it.title}
                            </Text>
                            {it.ip ? <Text color={AMBER}>third-party IP</Text> : null}
                            {sent ? (
                              <Text bold color={SKY}>
                                {`In the Factory as ${sent.proto_id ?? sent.title}, ${nameOf(x.stages, sent.stage)}`}
                              </Text>
                            ) : inInbox ? (
                              <Text bold color={SKY}>
                                In loose ideas
                              </Text>
                            ) : it.verdict !== 'REJECT' ? (
                              <Box gap={1}>
                                <Button key={`send-${from}`} label="Send to Factory" onPress={() => x.sendItem(r, si, ii)} />
                                {r.kind === 'hooks' ? (
                                  <Button key={`hook-${from}`} label="Save to Thumbnail repository" onPress={() => x.saveHook(r, it)} />
                                ) : null}
                              </Box>
                            ) : null}
                          </Box>
                          <Text color={MUTED}>{clip(it.note, 400)}</Text>
                        </Box>
                      )
                    })}
                  </Box>
                ))}
                {r.gaps ? <Text color={AMBER}>{r.gaps}</Text> : null}
              </Box>
            ) : null}
          </Box>
        )
      })}
    </Box>
  )
}

/* ---------- shared bits ---------- */

export function chip(x: Ctx, label: string, color: string, key: string) {
  const { Text } = x.C
  return (
    <Text key={key} bold color={BG} backgroundColor={color}>
      {` ${label} `}
    </Text>
  )
}

// "Open chat" for a stage or a prototype: the chat is a real app conversation opened beside the panel.
export function openChatButton(x: Ctx, kind: 'idea' | 'stage', scope: string, chat: ChatLink | null, onPress: () => unknown) {
  const { Box, Text, Button, Link } = x.C
  const key = `${kind}:${scope}`
  const err = x.chatError(key)
  return (
    <Box flexDirection="column">
      <Box gap={1} flexWrap="wrap">
        <Button key={`chat-open-${key}`} label="Open chat" onPress={onPress} />
        {x.chatBusy(key) ? <Text color={CLAY}>opening...</Text> : null}
        {chat && chat.link && Link ? <Link key={`chat-link-${key}`} href={chat.link} label="open in app" /> : null}
      </Box>
      {err ? <Text color={AMBER}>{err}</Text> : null}
    </Box>
  )
}

/* ---------- Template library (Drive) ---------- */

export function templatesView(x: Ctx) {
  const { Box, Text, Button, Link } = x.C
  const t = x.templates
  return (
    <Box flexDirection="column" gap={1}>
      <Text color={FG}>
        The template library is the Drive folder roblox_radar_templates. Each Google Doc whose title starts with template_ is one template; a new or edited doc appears here on its own.
      </Text>
      <Box gap={2}>
        <Text color={t ? (t.ok ? OLIVE : AMBER) : MUTED}>
          {!t ? 'Reading Drive...' : t.ok ? `${t.list.length} template(s), read at ${t.at.slice(11, 16)} UTC.` : `Drive read failed: ${t.error ?? 'unknown'}`}
        </Text>
        <Button key="tpl-refresh" label="Read again" onPress={() => x.refreshTemplates()} />
      </Box>
      {t && t.list.length === 0 ? <Text color={MUTED}>No template yet. The first one is written in the central chat and saved here.</Text> : null}
      {(t ? t.list : []).map(tp => {
        const used = x.store.ideas.filter(i => i.template?.id === tp.id).length
        return (
          <Box key={`tp-${tp.id}`} flexDirection="column" borderStyle="round" borderColor={tp.status === 'ready' ? OLIVE : LINE} backgroundColor={PANEL} paddingX={1}>
            <Box gap={1} flexWrap="wrap">
              <Text bold color={FG}>
                {tp.name}
              </Text>
              {chip(x, tp.status.toUpperCase(), tp.status === 'ready' ? OLIVE : AMBER, `tps-${tp.id}`)}
              <Text color={MUTED}>{`family ${tp.family}${used > 0 ? `, used by ${used} idea(s)` : ''}`}</Text>
              {tp.link && Link ? <Link key={`tpl-link-${tp.id}`} href={tp.link} label="open doc" /> : null}
            </Box>
            {tp.summary ? <Text color={FG}>{tp.summary}</Text> : null}
          </Box>
        )
      })}
    </Box>
  )
}

/* ---------- Knowledge repository (title and thumbnail) ---------- */

export function knowledgeView(x: Ctx, stage: Stage) {
  const { Box, Text, Button, Input } = x.C
  const entries: Knowledge[] = x.store.knowledge[stage.id] ?? []
  return (
    <Box flexDirection="column" gap={1}>
      <Text color={FG}>
        Repository of principles, patterns and techniques for this stage. It grows from what you add, from what the stage chat
        establishes, and from what gets launched.
      </Text>
      <Box borderStyle="round" borderColor={CLAY} paddingX={1}>
        <Input
          key={`add-know-${stage.id}`}
          placeholder="Add an entry. Start with principle:, technique:, pattern:, pitfall: or result:"
          rows={1}
          submitLabel="add"
          onSubmit={(v: string) => void x.addKnowledge(stage.id, v)}
        />
      </Box>
      {entries.length === 0 ? <Text color={MUTED}>Nothing here yet.</Text> : null}
      {KNOWLEDGE_KINDS.map(kind => {
        const list = entries.filter(e => e.kind === kind)
        if (list.length === 0) return null
        return (
          <Box key={`kind-${kind}`} flexDirection="column">
            <Text bold color={KIND_COLOR[kind]}>
              {kind.toUpperCase()} ({list.length})
            </Text>
            {list.map(e => (
              <Box
                key={`k-${e.id}`}
                flexDirection="column"
                borderStyle="round"
                borderColor={LINE}
                backgroundColor={PANEL}
                paddingX={1}
              >
                <Text color={FG}>{e.text}</Text>
                <Box gap={1} flexWrap="wrap">
                  <Text color={MUTED}>
                    {e.source}, evidence tag {e.tag}
                  </Text>
                  <Button key={`k-rm-${e.id}`} label="Remove" onPress={() => x.removeKnowledge(stage.id, e.id)} />
                </Box>
              </Box>
            ))}
          </Box>
        )
      })}
      <Text color={MUTED}>Evidence tags: F fact with a source, I inference, H hypothesis, V to validate, unrated means nobody rated it yet.</Text>
    </Box>
  )
}

export { NEON }

/* ---------- Receipts (what each scheduled run reported) ---------- */

const OUTCOME_META: Record<Outcome, { glyph: string; color: string; label: string }> = {
  ok: { glyph: '✔', color: OLIVE, label: 'OK' },
  attention: { glyph: '▲', color: AMBER, label: 'ATTENTION' },
  partial: { glyph: '▲', color: AMBER, label: 'PARTIAL' },
  failed: { glyph: '✖', color: RUST, label: 'FAILED' },
}

const ITEM_COLOR: Record<string, string> = { ok: OLIVE, ran: OLIVE, stale: SKY, skipped_cost: SKY, degraded: AMBER, degraded_size: AMBER, partial: AMBER, running: SKY, dead: RUST, missing: RUST, did_not_run: RUST, failed: RUST }

export function receiptsView(x: Ctx, stage: Stage) {
  const { Box, Text, Button } = x.C
  const list = receiptsFor(x.receipts, stage.id)
  const late = latestPerTask(list).filter(r => isLate(r, x.now))
  const reader = x.rcp
  return (
    <Box flexDirection="column" gap={1}>
      <Text color={FG}>
        Every scheduled run ends by writing a receipt to Drive. This list is what the runs said they did, newest first.
      </Text>
      {reader ? (
        reader.ok ? (
          <Text color={MUTED}>{`Drive checked at ${reader.at.slice(11, 16)} UTC, ${x.receipts.length} receipts in the last 8 days.`}</Text>
        ) : (
          <Text color={AMBER}>{`Drive check failed at ${reader.at.slice(11, 16)} UTC: ${reader.error ?? 'unknown error'}. Showing the receipts read earlier.`}</Text>
        )
      ) : (
        <Text color={MUTED}>Reading Drive...</Text>
      )}
      {late.map(r => (
        <Text key={`late-${r.task_key}`} color={AMBER}>
          {`▲ ${r.task_key}: no new receipt since the run expected at ${String(r.next_run_utc).slice(0, 16).replace('T', ' ')} UTC.`}
        </Text>
      ))}
      {list.length === 0 ? <Text color={MUTED}>No receipts yet for this stage. The first ones arrive after the next scheduled runs.</Text> : null}
      {list.map(r => {
        const id = `rcp:${r.run_id}`
        const isOpen = x.open.includes(id)
        const m = OUTCOME_META[r.outcome]
        const counts = Object.entries(r.counts).filter(([, v]) => v !== null)
        return (
          <Box key={`rcp-${r.run_id}`} flexDirection="column" borderStyle="round" borderColor={isOpen ? CLAY : m.color} backgroundColor={PANEL} paddingX={1}>
            <Button key={`rcp-toggle-${r.run_id}`} onPress={() => x.toggle(id)}>
              <Text bold color={m.color}>
                {isOpen ? '▾ ' : '▸ '}
                {m.glyph} {r.task_key}
              </Text>
              <Text color={MUTED}>
                {'  '}
                {ago(r.finished_utc, x.now)}
              </Text>
              <Text color={FG}>
                {'  '}
                {clip(r.summary, 110)}
              </Text>
            </Button>
            {isOpen ? (
              <Box flexDirection="column" paddingTop={1}>
                <Text color={MUTED}>
                  {`${m.label}. Finished ${r.finished_utc.slice(0, 16).replace('T', ' ')} UTC${r.started_utc ? `, started ${r.started_utc.slice(11, 16)}` : ''}. Run ${r.run_id}.`}
                </Text>
                <Text color={FG}>{r.summary}</Text>
                {counts.length > 0 ? <Text color={MUTED}>{counts.map(([k, v]) => `${k} ${v}`).join(', ')}</Text> : null}
                {r.problems.map((p, i) => (
                  <Text key={`p-${r.run_id}-${i}`} color={AMBER}>
                    {`▲ ${p}`}
                  </Text>
                ))}
                {r.items.slice(0, 40).map((it, i) => (
                  <Box key={`i-${r.run_id}-${i}`} gap={1} paddingLeft={1}>
                    <Text color={ITEM_COLOR[it.status] ?? MUTED}>●</Text>
                    <Text color={FG}>{it.name}</Text>
                    <Text color={ITEM_COLOR[it.status] ?? MUTED}>{it.status}</Text>
                    <Text color={MUTED}>{`${it.rows !== null ? `${it.rows} rows. ` : ''}${clip(it.note, 120)}`}</Text>
                  </Box>
                ))}
                {r.outputs.length > 0 ? <Text color={MUTED}>{`Outputs: ${r.outputs.map(o => `${o.kind} ${o.name}`).join('; ')}`}</Text> : null}
              </Box>
            ) : null}
          </Box>
        )
      })}
    </Box>
  )
}
