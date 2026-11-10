// Radar mode pieces that are not a pipeline stage: the loose-ideas inbox and the "created" confirmation.
import { AMBER, CLAY, FG, LINE, MUTED, PANEL, SKY } from '../theme'
import { ago } from '../views'
import type { Ctx } from '../views'
import { clip } from '../model'

// Shown after "Send to Factory": what was created, with a button to open its chat.
export function factoryNoteBar(x: Ctx) {
  const { Box, Text, Button } = x.C
  const n = x.factoryNote
  if (!n) return null
  const idea = x.store.ideas.find(i => i.id === n.ideaId)
  return (
    <Box gap={1} flexWrap="wrap" borderStyle="round" borderColor={CLAY} paddingX={1}>
      <Text bold color={CLAY}>{n.text}</Text>
      {idea ? <Button key="note-open-chat" label="Open chat" onPress={() => x.openProtoChat(idea.id, idea.stage)} /> : null}
      {idea ? <Button key="note-open-factory" label="Go to the Factory" onPress={() => x.selectProto(idea.id)} /> : null}
    </Box>
  )
}

// Loose ideas: raw ideas with no proto ID and no chat. "Send to Factory" creates the prototype and its chat.
export function inboxBox(x: Ctx) {
  const { Box, Text, Button, Input } = x.C
  const list = [...x.store.inbox].sort((a, b) => b.created.localeCompare(a.created))
  return (
    <Box flexDirection="column" gap={1} borderStyle="round" borderColor={LINE} backgroundColor={PANEL} paddingX={1} paddingY={1}>
      <Box gap={1} flexWrap="wrap">
        <Text bold color={FG}>Loose ideas</Text>
        <Text color={MUTED}>{`${list.length} waiting`}</Text>
      </Box>
      <Box borderStyle="round" borderColor={CLAY} paddingX={1}>
        <Input
          key="add-inbox"
          placeholder="Raw idea: type the title, then | and an optional note"
          rows={1}
          submitLabel="add"
          onSubmit={(v: string) => void x.addInbox(v)}
        />
      </Box>
      {list.length === 0 ? <Text color={MUTED}>Nothing here. Add a raw idea above, or send one from a screening report.</Text> : null}
      {list.map(i => (
        <Box key={`inbox-${i.id}`} flexDirection="column" borderStyle="round" borderColor={LINE} paddingX={1}>
          <Box gap={1} flexWrap="wrap">
            <Text bold color={FG}>{i.title}</Text>
            <Text color={MUTED}>{`${i.origin === 'advisor' ? 'from a report' : 'your idea'}, ${ago(i.created, x.now)}`}</Text>
          </Box>
          {i.note ? <Text color={MUTED}>{clip(i.note, 300)}</Text> : null}
          {i.chat ? <Text color={SKY}>An earlier chat is linked and travels with it.</Text> : null}
          <Box gap={1}>
            <Button key={`inbox-send-${i.id}`} label="Send to Factory" onPress={() => x.sendToFactory({ kind: 'inbox', id: i.id })} />
            <Button key={`inbox-del-${i.id}`} label="Discard" onPress={() => x.discardInbox(i.id)} />
          </Box>
        </Box>
      ))}
      <Text color={AMBER} dimColor>
        Discard removes the idea for good.
      </Text>
    </Box>
  )
}
