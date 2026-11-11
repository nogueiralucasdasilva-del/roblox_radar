// Radar mode pieces that are not a pipeline stage: the loose-ideas inbox and the "created" confirmation.
import { AMBER, BG, CLAY, FG, LINE_SOFT, MUTED, OLIVE, PANEL, SKY } from '../theme'
import { ago } from '../views'
import type { Ctx } from '../views'
import { clip } from '../model'
import { btn, cardWidth, emptyState, notice, rail, sectionTitle, tint } from './kit'

// Shown after "Send to Factory": what was created, with buttons to open its chat or go to the Factory.
export function factoryNoteBar(x: Ctx) {
  const { Box, Text } = x.C
  const n = x.factoryNote
  if (!n) return null
  const idea = x.store.ideas.find(i => i.id === n.ideaId)
  return (
    <Box gap={1} flexWrap="wrap" alignItems="center" borderStyle="round" borderColor={CLAY} paddingX={1}>
      <Text bold color={OLIVE}>{'✔'}</Text>
      <Text bold color={FG}>{n.text}</Text>
      {idea ? btn(x.C, 'note-open-chat', 'Open chat', 'secondary', () => x.openProtoChat(idea.id, idea.stage)) : null}
      {idea ? btn(x.C, 'note-open-factory', 'Go to the Factory', 'secondary', () => x.selectProto(idea.id)) : null}
    </Box>
  )
}

// Loose ideas: raw ideas with no proto ID and no chat. "Send to Factory" creates the prototype and its chat.
export function inboxBox(x: Ctx) {
  const { Box, Text, Input } = x.C
  const list = [...x.store.inbox].sort((a, b) => b.created.localeCompare(a.created))
  const w = cardWidth(x.columns) - 6
  return (
    <Box flexDirection="column" gap={1} borderStyle="round" borderColor={LINE_SOFT} backgroundColor={PANEL} paddingX={1} paddingY={1}>
      {sectionTitle(x.C, 'Loose ideas', list.length, w)}
      <Box gap={1} alignItems="center">
        <Text bold color={BG} backgroundColor={CLAY}>
          {' + '}
        </Text>
        <Box borderStyle="round" borderColor={CLAY} paddingX={1}>
          <Input key="add-inbox" placeholder="Raw idea: type the title, then | and an optional note" rows={1} submitLabel="add" onSubmit={(v: string) => void x.addInbox(v)} />
        </Box>
      </Box>
      {list.length === 0 ? emptyState(x.C, 'Nothing here', 'Add a raw idea above, or send one from a screening report.') : null}
      {list.map(i => (
        <Box key={`inbox-${i.id}`} flexDirection="column" borderStyle="round" borderColor={LINE_SOFT} paddingX={1}>
          <Box gap={1} flexWrap="wrap" alignItems="center">
            {rail(x.C, AMBER, `rail-${i.id}`)}
            <Text bold color={FG}>{i.title}</Text>
            {tint(x.C, `${i.origin === 'advisor' ? 'from a report' : 'your idea'}, ${ago(i.created, x.now)}`, MUTED)}
          </Box>
          {i.note ? <Text color={MUTED}>{clip(i.note, 300)}</Text> : null}
          {i.chat ? <Text color={SKY}>An earlier chat is linked and travels with it.</Text> : null}
          <Box gap={1}>
            {btn(x.C, `inbox-send-${i.id}`, 'Send to Factory', 'primary', () => x.sendToFactory({ kind: 'inbox', id: i.id }))}
            {btn(x.C, `inbox-del-${i.id}`, 'Discard', 'danger', () => x.discardInbox(i.id))}
          </Box>
        </Box>
      ))}
      {notice(x.C, 'warn', 'Discard removes the idea for good.')}
    </Box>
  )
}
