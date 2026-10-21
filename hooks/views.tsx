import type { Report, ReportItem, SourceStatus, SourcesFile, ReportsFile, Stage } from '../types'
import { AMBER, CLAY, FG, LINE, MUTED, NEON, OLIVE, PANEL, RUST, SAND, SKY, BG } from './theme'
import { KNOWLEDGE_KINDS, STALE_BUSY_MS, clip, ideasAt, nextStageOf, stepFor } from './model'
import type { ChatLink, Idea, IdeaStatus, Knowledge, KnowledgeKind, Store } from './model'
import { isLate, latestPerTask, receiptsFor } from './receipts'
import type { Template } from './templates'
import { actionFor } from './actions'
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
  setStatus: (ideaId: string, status: IdeaStatus) => unknown
  promote: (ideaId: string) => unknown
  scanIdea: (ideaId: string) => unknown
  ideaSay: (ideaId: string, text: string) => unknown
  briefIdea: (ideaId: string) => unknown
  openChat: (kind: 'idea' | 'stage', scope: string) => unknown
  ideaYes: (ideaId: string) => unknown
  removeIdea: (ideaId: string) => unknown
  runAction: (ideaId: string) => unknown
  runTask: (triggerId: string) => unknown
  templates: { at: string; ok: boolean; error?: string; list: Template[] } | null
  chooseTemplate: (ideaId: string, templateId: string | null) => unknown
  refreshTemplates: () => unknown
  chatError: (key: string) => string | null
  chatBusy: (key: string) => boolean
  addIdea: (title: string) => unknown
  addKnowledge: (stageId: string, raw: string) => unknown
  removeKnowledge: (stageId: string, id: string) => unknown
}

const STATUS_META: Record<SourceStatus, { glyph: string; color: string; label: string }> = {
  working: { glyph: '✔', color: OLIVE, label: 'WORKING' },
  attention: { glyph: '▲', color: AMBER, label: 'ATTENTION' },
  stale: { glyph: '◷', color: SKY, label: 'STALE' },
  broken: { glyph: '✖', color: RUST, label: 'BROKEN' },
  unknown: { glyph: '?', color: SAND, label: 'UNKNOWN' },
}

const IDEA_COLOR: Record<IdeaStatus, string> = { pending: AMBER, promising: OLIVE, rejected: RUST }
const IDEA_LABEL: Record<IdeaStatus, string> = { pending: 'PENDING', promising: 'PROMISING', rejected: 'REJECTED' }
const VERDICT_COLOR: Record<string, string> = { PASS: OLIVE, MAYBE: AMBER, REJECT: RUST, HOOK: SKY }
const POTENTIAL_COLOR: Record<string, string> = { HIGH: OLIVE, MEDIUM: AMBER, LOW: RUST }
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

function nameOf(stages: Stage[], id: string): string {
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
  return (
    <Box flexDirection="column" gap={1}>
      <Text color={FG}>Open a report, then send an idea from it to Pre-validation. Each report is one card.</Text>
      <Text color={MUTED}>{f.origin}</Text>
      {reports.map(r => {
        const id = `rep:${r.id}`
        const isOpen = x.open.includes(id)
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
                                {`In ${nameOf(x.stages, sent.stage)}, ${IDEA_LABEL[sent.status].toLowerCase()}`}
                              </Text>
                            ) : it.verdict !== 'REJECT' ? (
                              <Box gap={1}>
                                <Button key={`send-${from}`} label="Send to pre-validation" onPress={() => x.sendItem(r, si, ii)} />
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

/* ---------- Ideas and prototypes (card stages) ---------- */

function chip(x: Ctx, label: string, color: string, key: string) {
  const { Text } = x.C
  return (
    <Text key={key} bold color={BG} backgroundColor={color}>
      {` ${label} `}
    </Text>
  )
}

export function ideasView(x: Ctx, stage: Stage, withAdd: boolean) {
  const { Box, Text, Button, Input } = x.C
  const list = ideasAt(x.store.ideas, stage.id)
  const nextId = nextStageOf(stage.id)
  const counts: Record<IdeaStatus, number> = { pending: 0, promising: 0, rejected: 0 }
  for (const i of list) {
    const st = stepFor(i, stage.id)
    if (st) counts[st.status] += 1
  }
  return (
    <Box flexDirection="column" gap={1}>
      <Text color={FG}>
        {stage.id === 'prevalid'
          ? 'Every idea you explored, from the advisor reports and your own. Open a card to set its status or move it on.'
          : 'Ideas that reached this stage, each with its proto_id. Open a card to set its status or move it on.'}
      </Text>
      <Box gap={2}>
        {(['pending', 'promising', 'rejected'] as IdeaStatus[]).map(k => (
          <Text key={`ic-${k}`} bold color={IDEA_COLOR[k]}>
            {counts[k]} {k}
          </Text>
        ))}
      </Box>
      {withAdd ? (
        <Box borderStyle="round" borderColor={CLAY} paddingX={1}>
          <Input
            key={`add-idea-${stage.id}`}
            placeholder="Add an idea of your own: type it and send"
            rows={1}
            submitLabel="add"
            onSubmit={(v: string) => void x.addIdea(v)}
          />
        </Box>
      ) : null}
      {list.length === 0 ? (
        <Text color={MUTED}>
          {stage.id === 'prevalid'
            ? 'No ideas yet. Send one from a report in the advisor stage, or add your own above.'
            : 'No idea has reached this stage yet. Promote one from the previous stage.'}
        </Text>
      ) : null}
      {list.map(i => {
        const id = `idea:${i.id}`
        const isOpen = x.open.includes(id)
        const here = i.stage === stage.id
        const step = stepFor(i, stage.id)
        const status: IdeaStatus = step ? step.status : i.status
        return (
          <Box
            key={`idea-${i.id}`}
            flexDirection="column"
            borderStyle="round"
            borderColor={isOpen ? CLAY : LINE}
            backgroundColor={PANEL}
            paddingX={1}
          >
            <Button key={`idea-toggle-${i.id}`} onPress={() => x.toggle(id)}>
              <Text bold color={isOpen ? CLAY : FG}>
                {isOpen ? '▾ ' : '▸ '}
                {i.title}
              </Text>
            </Button>
            <Box gap={1} flexWrap="wrap">
              {chip(x, IDEA_LABEL[status], IDEA_COLOR[status], `st-${i.id}`)}
              {!here ? chip(x, `MOVED TO ${nameOf(x.stages, i.stage).toUpperCase()}`, SKY, `mv-${i.id}`) : null}
              {i.proto_id ? chip(x, i.proto_id, CLAY, `pid-${i.id}`) : null}
              {i.scan ? chip(x, `POTENTIAL ${i.scan.level}`, POTENTIAL_COLOR[i.scan.level] ?? SKY, `pot-${i.id}`) : null}
              {i.template ? chip(x, `TEMPLATE ${i.template.name.toUpperCase()}`, SKY, `tpl-${i.id}`) : null}
              {busyOf(i, x.now) ? <Text color={CLAY}>agent working...</Text> : null}
              <Text color={MUTED}>{i.origin === 'advisor' ? 'from the advisor' : 'your idea'}</Text>
            </Box>
            {isOpen ? (
              <Box flexDirection="column" gap={1} paddingTop={1}>
                {i.note ? <Text color={FG}>{i.note}</Text> : null}
                {i.from ? <Text color={MUTED}>Source: {i.from.split('#')[0]}</Text> : null}
                <Text color={MUTED}>
                  Path:{' '}
                  {i.history.map(h => `${nameOf(x.stages, h.stage)} (${h.at.slice(0, 10)}, ${h.status})`).join(', then ')}
                </Text>
                {i.proto_id ? <Text color={MUTED}>proto_id format is provisional (RB-date-slug) until you decide it.</Text> : null}
                {here && status !== 'rejected' ? actionRow(x, i) : null}
                {stage.id === 'template' && here ? templateChooser(x, i) : null}
                {chatPanel(x, 'idea', i.id, i.chat ?? null, i.memory ?? '', stage.id === 'prevalid' && !i.scan ? 'Open chat and run the quick scan' : 'Open chat')}
                <Box gap={1} flexWrap="wrap">
                  {here ? (
                    <Box gap={1} flexWrap="wrap">
                      {stage.id === 'prevalid' && i.chat && status !== 'rejected' ? (
                        <Button key={`yes-${i.id}`} label="Yes, write the 2-page brief" onPress={() => x.ideaYes(i.id)} />
                      ) : null}
                      <Button key={`s-pr-${i.id}`} label="Promising" onPress={() => x.setStatus(i.id, 'promising')} />
                      <Button key={`s-pe-${i.id}`} label={status === 'rejected' ? 'Reopen as pending' : 'Pending'} onPress={() => x.setStatus(i.id, 'pending')} />
                      <Button key={`s-re-${i.id}`} label={stage.id === 'prevalid' && i.chat ? 'No, reject' : 'Reject'} onPress={() => x.setStatus(i.id, 'rejected')} />
                      {i.origin === 'own' && !i.proto_id ? (
                        <Button key={`del-${i.id}`} label="Delete" onPress={() => x.removeIdea(i.id)} />
                      ) : null}
                      {nextId && status !== 'rejected' && !(stage.id === 'prevalid' && i.chat) ? (
                        <Button key={`pro-${i.id}`} label={`Promote to ${nameOf(x.stages, nextId)}`} onPress={() => x.promote(i.id)} />
                      ) : null}

                    </Box>
                  ) : (
                    <Button key={`go-${i.id}`} label={`Open in ${nameOf(x.stages, i.stage)}`} onPress={() => x.go(i.stage)} />
                  )}
                </Box>
              </Box>
            ) : null}
          </Box>
        )
      })}
    </Box>
  )
}

function busyOf(i: Idea, now: number): boolean {
  return !!i.busy && now - Date.parse(i.busy.at) < STALE_BUSY_MS
}

// The conversation inside an idea card. The quick scan lands here as the first answer.
function ideaChat(x: Ctx, i: Idea, here: boolean) {
  const { Box, Text, Input } = x.C
  const msgs = (i.messages ?? []).slice(-8)
  return (
    <Box flexDirection="column" gap={1}>
      {msgs.map((m, n) => {
        if (m.role === 'system') {
          return (
            <Text key={`im-${i.id}-${n}`} color={MUTED}>
              {clip(m.text, 300)}
            </Text>
          )
        }
        const isUser = m.role === 'user'
        return (
          <Box key={`im-${i.id}-${n}`} flexDirection="column" paddingX={1} marginLeft={isUser ? 6 : 0} marginRight={isUser ? 0 : 6}>
            <Text bold color={isUser ? MUTED : CLAY}>
              {isUser ? 'You' : '✻ Idea agent'}
            </Text>
            <Text color={FG}>{clip(m.text, 3000)}</Text>
          </Box>
        )
      })}
      {busyOf(i, x.now) ? <Text color={CLAY}>The idea agent is working. The answer lands here.</Text> : null}
      {here ? (
        <Box borderStyle="round" borderColor={CLAY} paddingX={1}>
          <Input
            key={`idea-chat-${i.id}`}
            placeholder="Talk about this idea: ask, push back, or adjust it"
            rows={2}
            submitLabel="send"
            onSubmit={(v: string) => {
              if (v.trim()) void x.ideaSay(i.id, v.trim())
            }}
          />
        </Box>
      ) : null}
    </Box>
  )
}

// The link between the panel and a real app conversation: open or start it, and show what the panel filed from it.
export function chatPanel(x: Ctx, kind: 'idea' | 'stage', scope: string, chat: ChatLink | null, memory: string, startLabel: string) {
  const { Box, Text, Button, Link } = x.C
  const key = `${kind}:${scope}`
  const err = x.chatError(key)
  const busy = x.chatBusy(key)
  return (
    <Box flexDirection="column" gap={1}>
      <Box gap={1} flexWrap="wrap">
        {chat ? (
          <Button key={`chat-open-${key}`} label="Open chat" onPress={() => x.openChat(kind, scope)} />
        ) : (
          <Button key={`chat-start-${key}`} label={startLabel} onPress={() => x.openChat(kind, scope)} />
        )}
        {busy ? <Text color={CLAY}>opening...</Text> : null}
        {chat ? <Text color={MUTED}>{`${chat.title}, started ${chat.at.slice(0, 10)}${chat.syncedAt ? `, read ${ago(chat.syncedAt, x.now)}` : ''}`}</Text> : null}
        {chat && chat.link && Link ? <Link key={`chat-link-${key}`} href={chat.link} label="open in app" /> : null}
      </Box>
      {!chat ? (
        <Text color={MUTED}>
          {kind === 'idea'
            ? 'This card gets its own conversation in the app, in the Roblox Radar sidebar group. Click the button: the conversation is created and opens beside the panel (approve if the app asks). Later clicks reopen the same one.'
            : 'This stage gets its own conversation in the app, in the Roblox Radar sidebar group. Click the button: the conversation is created and opens beside the panel (approve if the app asks). Later clicks reopen the same one.'}
        </Text>
      ) : null}
      {err ? <Text color={AMBER}>{err}</Text> : null}
      {memory ? (
        <Box flexDirection="column">
          <Text bold color={FG}>
            Memory
          </Text>
          <Text color={MUTED}>{clip(memory, 1200)}</Text>
        </Box>
      ) : null}
    </Box>
  )
}

// The main action of the card's stage, highlighted, with what was last asked.
function actionRow(x: Ctx, i: Idea) {
  const { Box, Text, Button } = x.C
  const a = actionFor(i.stage)
  if (!a || (i.stage === 'prevalid' && i.scan)) return null
  const blocked = a.needs ? a.needs(i) : null
  const last = i.lastAction && i.lastAction.stage === i.stage ? i.lastAction : null
  return (
    <Box gap={1} flexWrap="wrap">
      <Button key={`act-${i.id}`} onPress={() => x.runAction(i.id)}>
        <Text bold color={BG} backgroundColor={blocked ? SAND : NEON}>
          {` ▶ ${a.label} `}
        </Text>
      </Button>
      {blocked ? <Text color={AMBER}>{blocked}</Text> : null}
      {last ? <Text color={MUTED}>{`asked ${ago(last.at, x.now)}`}</Text> : null}
    </Box>
  )
}

// Picks the template of an idea in the Template match stage, from the Drive library.
function templateChooser(x: Ctx, i: Idea) {
  const { Box, Text, Button } = x.C
  const list = x.templates ? x.templates.list : []
  return (
    <Box flexDirection="column">
      <Text bold color={FG}>
        Template
      </Text>
      {list.length === 0 ? <Text color={MUTED}>No template doc in the library yet. Add one to the Drive folder roblox_radar_templates.</Text> : null}
      <Box gap={1} flexWrap="wrap">
        {list.map(t => {
          const isOn = i.template?.id === t.id
          return (
            <Button key={`pick-${i.id}-${t.id}`} onPress={() => x.chooseTemplate(i.id, isOn ? null : t.id)}>
              <Text bold={isOn} color={isOn ? BG : t.status === 'ready' ? FG : MUTED} backgroundColor={isOn ? NEON : undefined}>
                {` ${isOn ? '● ' : ''}${t.name}${t.status === 'draft' ? ' (draft)' : ''} `}
              </Text>
            </Button>
          )
        })}
      </Box>
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

/* ---------- Registry (proto_id) ---------- */

export function registryView(x: Ctx) {
  const { Box, Text, Button } = x.C
  const withId = x.store.ideas.filter(i => i.proto_id).sort((a, b) => a.created.localeCompare(b.created))
  const without = x.store.ideas.length - withId.length
  return (
    <Box flexDirection="column" gap={1}>
      <Text color={FG}>One row per prototype. A proto_id is born when an idea is promoted into the brief stage.</Text>
      <Text color={MUTED}>{without} idea(s) have no proto_id yet.</Text>
      {withId.length === 0 ? <Text color={MUTED}>No prototype yet.</Text> : null}
      {withId.map(i => (
        <Box key={`reg-${i.id}`} gap={1} flexWrap="wrap">
          <Text bold color={CLAY}>
            {i.proto_id}
          </Text>
          <Text bold color={FG}>
            {i.title}
          </Text>
          <Text color={IDEA_COLOR[i.status]}>{IDEA_LABEL[i.status].toLowerCase()}</Text>
          <Button key={`reg-go-${i.id}`} label={`In ${nameOf(x.stages, i.stage)}`} onPress={() => x.go(i.stage)} />
        </Box>
      ))}
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

const ITEM_COLOR: Record<string, string> = { ok: OLIVE, ran: OLIVE, stale: SKY, degraded: AMBER, degraded_size: AMBER, partial: AMBER, running: SKY, dead: RUST, missing: RUST, did_not_run: RUST, failed: RUST }

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
