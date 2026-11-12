// What sits under each stage card of the Factory: the Copy prompt button, and (when the card is opened) the names of the
// skills, the prompt and the documents of that stage, each one a link to Drive. Presentation only.
import { AMBER, FG, LINE_SOFT, MUTED, OLIVE, RUST } from '../theme'
import type { Ctx } from '../views'
import { clip } from '../model'
import type { Idea } from '../model'
import { docLinks } from '../factory'
import { PROMPT_FILES } from '../protodocs'
import { skillsFolderName } from '../skills'
import type { SkillRef } from '../model'
import { btn } from './kit'

const driveFile = (id: string): string => `https://drive.google.com/file/d/${id}/view`

export const cardKey = (i: Idea, stage: string): string => `card:${i.id}:${stage}`

function links(x: Ctx, items: { key: string; label: string; url: string | null }[], empty: string) {
  const { Box, Text, Link } = x.C
  if (items.length === 0) return <Text color={MUTED}>{empty}</Text>
  return (
    <Box gap={2} flexWrap="wrap">
      {items.map(it => (it.url && Link ? <Link key={it.key} href={it.url} label={clip(it.label, 48)} /> : <Text key={it.key} color={FG}>{clip(it.label, 48)}</Text>))}
    </Box>
  )
}


// The prompt buttons, drawn inside the card on its right side.
export function stageSide(x: Ctx, i: Idea, stage: string) {
  const { Box } = x.C
  const reveng = stage === 'template'
  return (
    <Box flexDirection="column" gap={1} alignItems="center">
      {reveng ? btn(x.C, `gemini-prompt-${i.id}`, 'Copy Gemini prompt', 'secondary', (press: any) => x.copyPrompt(i.id, press)) : null}
      {btn(x.C, `copy-prompt-${i.id}-${stage}`, reveng ? 'Copy validation prompt' : 'Copy prompt', reveng ? 'secondary' : 'primary', (press: any) => x.copyStagePrompt(i.id, stage, 0, press))}
    </Box>
  )
}

export function stageExtras(x: Ctx, i: Idea, stage: string) {
  const { Box, Text } = x.C
  const open = x.open.includes(cardKey(i, stage))
  const note = x.stageNote(i.id, stage)
  const def = x.stages.find(s => s.id === stage)
  const folder = skillsFolderName(x.skills, def ?? { id: stage })
  const own: SkillRef[] = x.skills?.ok ? (x.skills.files[folder] ?? []) : []
  const shared: SkillRef[] = x.skills?.ok ? (x.skills.files._all ?? []) : []
  const promptNames = PROMPT_FILES[stage] ?? []
  const isPrompt = (f: SkillRef) => /^prompt_/.test(f.name)
  const skills = [...own.filter(f => !isPrompt(f)), ...shared.filter(f => !isPrompt(f))]
  const prompts = own.filter(isPrompt)
  const docs = docLinks(i, stage)
  const reveng = stage === 'template'
  return (
    <Box flexDirection="column" gap={1} paddingLeft={3}>
      {note ? <Text color={note.level === 'ok' ? OLIVE : note.level === 'warn' ? AMBER : RUST}>{clip(note.text, 200)}</Text> : null}
      {note?.prompt ? (
        <Box borderStyle="round" borderColor={LINE_SOFT} paddingX={1}>
          <Text color={FG}>{clip(note.prompt, 2500)}</Text>
        </Box>
      ) : null}
      {open ? (
        <Box flexDirection="column" gap={1} borderStyle="round" borderColor={LINE_SOFT} paddingX={1}>
          <Box gap={2} flexWrap="wrap">
            <Text color={MUTED}>Skills</Text>
            {links(x, skills.map(f => ({ key: `sk-${i.id}-${stage}-${f.name}`, label: f.name, url: f.id ? driveFile(f.id) : null })), x.skills?.ok ? 'none in Drive' : 'Drive not read yet')}
          </Box>
          <Box gap={2} flexWrap="wrap">
            <Text color={MUTED}>Prompt</Text>
            {links(x, prompts.map(f => ({ key: `pr-${i.id}-${stage}-${f.name}`, label: f.name, url: f.id ? driveFile(f.id) : null })), promptNames.length > 0 ? `${promptNames[0]} is not in Drive yet` : 'none')}
          </Box>
          <Box gap={2} flexWrap="wrap">
            <Text color={MUTED}>Documents</Text>
            {links(x, docs.map(d => ({ key: `dc-${i.id}-${stage}-${d.name}`, label: d.name, url: d.url })), 'none yet')}
          </Box>
        </Box>
      ) : null}
    </Box>
  )
}
