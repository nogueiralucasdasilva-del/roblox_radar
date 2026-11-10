// Prompts the Factory sends to a prototype's chat. Pure. No skill text lives here: every prompt tells the chat to read
// the Drive skill folders of the stage (and _all), so editing a skill in Drive needs no code change.
import type { Idea, Knowledge } from './model'
import { clip } from './model'
import { MEMORY_FOLDER_ID } from './memory'
import { TEMPLATE_FOLDER_ID } from './templates'
import { SHARED, SKILLS_ROOT_ID, SKILLS_ROOT_NAME } from './skills'
import { latestOf, nextGen } from './factory'
import { splitItems } from './outputs'
import { SAFETY } from './scoring'

export type Folders = { stage: string | null; all: string | null }
export type PromptCtx = { stageName: string; folders: Folders; criteria: string[]; knowledge: Knowledge[]; nextStage: string | null; nextStageName: string | null }

const RULES = 'Write in English. Be direct, no em dashes, no emoji. Facts carry a source and a date; inferences are marked as such. Never invent numbers.'

const idOf = (v: string | null): string => (v ? `id ${v}` : 'id not known: find it inside the Drive folder ' + SKILLS_ROOT_NAME + (SKILLS_ROOT_ID ? ` (id ${SKILLS_ROOT_ID})` : ''))

// The one rule every action prompt carries about skills.
export function skillsInstruction(stageId: string, f: Folders): string {
  return `Before starting, list the Drive folder ${stageId} (${idOf(f.stage)}) and the folder ${SHARED} (${idOf(f.all)}). Read every file in both and follow them as the skills for this step. If a folder cannot be read, say so and use the installed skill of the same name if it exists.`
}

// Machine-readable endings the panel parses from the transcript.
export function protocolText(i: Idea, stage: string, kind: string, gen: number, criteria: string[]): string {
  const id = i.proto_id ?? 'the prototype'
  return [
    'End your reply with this machine-readable block. The lines below start with "> " only so the panel does not read this example as your answer: in your reply write them WITHOUT the "> ", with each tag at the very start of its own line, outside any code block.',
    `> @@OUTPUT stage=${stage} kind=${kind} gen=${gen}`,
    '> (the content of the output, plain text, no markdown tables)',
    '> @@END',
    `If you created a Google Doc, also add one line: @@DOC stage=${stage} | <doc title> | <full doc url>`,
    `If your evidence changed any potential score, also add one line: @@SCORES {"criteria":{"<criterion>":{"v":<0 to 100>,"c":"low|medium|high","e":"<one line of evidence>","t":"F|H|V"}}}. Criteria: ${criteria.join(', ')}, and ${SAFETY} (gate, not weighted). t: F fact with source and date, H hypothesis, V needs validation. Score only what you can support; do not give an overall number. The meaning of 0, 50 and 100 is in the scoring rubric file in the ${SHARED} skills folder.`,
    `If the output is longer than about 3000 characters, also save it as a plain text file named ${id}_${stage}_${gen}.md in the Drive folder roblox_radar_protos (create the folder if it is missing).`,
  ].join('\n')
}

export function protoFacts(i: Idea): string {
  const brief = latestOf(i, 'brief')?.doc
  const tpl = i.template ? `${i.template.name} (library, https://docs.google.com/document/d/${i.template.id})` : latestOf(i, 'template', 'template_doc')?.doc ? `custom (${latestOf(i, 'template', 'template_doc')?.doc?.url})` : null
  const chosenTitle = (i.outputs?.titulo ?? []).flatMap(o => o.chosen)[0] ?? null
  return JSON.stringify({
    proto_id: i.proto_id,
    title: i.title,
    note: i.note,
    stage: i.stage,
    brief_doc: brief?.url ?? null,
    template: tpl,
    template_mode: i.template_mode ?? null,
    chosen_title: chosenTitle,
  })
}

const knowledgeLines = (k: Knowledge[], n: number) =>
  k
    .slice(-n)
    .map(x => `- ${x.kind}: ${clip(x.text, 240)} (${x.source})`)
    .join('\n')

export type FAction = {
  key: string
  stage: string
  kind: string
  label: string
  done: string
  needs?: (i: Idea) => string | null
  task: (i: Idea, c: PromptCtx) => string
}

const hasBrief = (i: Idea) => (latestOf(i, 'brief')?.doc ? null : 'Write the 2-page brief first.')
const hasTemplate = (i: Idea) => (i.template || latestOf(i, 'template', 'template_doc') ? null : 'Pick or build a template first (Template match).')

export const ACTIONS: FAction[] = [
  {
    key: 'scan',
    stage: 'prevalid',
    kind: 'scan',
    label: 'Run quick scan',
    done: 'Quick scan requested in its chat.',
    task: () =>
      'Run the quick scan of this idea now with the roblox-concept-validator skill (quick scan only, concept only). Content of the output: Potential (HIGH, MEDIUM or LOW with confidence), the wedge line, why it could work, why it could fail, the radar signal by name, and the verdict: Yes, No or Adjust. Start the output with the line "Verdict: YES|NO|ADJUST", then "Wedge: <one line>".',
  },
  {
    key: 'brief',
    stage: 'brief',
    kind: 'brief',
    label: 'Write 2-page brief',
    done: 'Brief requested in its chat.',
    task: i =>
      `Write the full 2-page concept brief now as a Google Doc. Put the proto_id ${i.proto_id} in the doc title. Concept only, never loop design. Output content: the doc link, then three lines: the fantasy, the wedge, the main risk.`,
  },
  {
    key: 'refs',
    stage: 'template',
    kind: 'refs',
    label: 'Find 3 reference games',
    done: 'Reference games requested in its chat.',
    needs: hasBrief,
    task: i =>
      `Search Roblox for the three highest-performing games closest to this concept (read the brief ${latestOf(i, 'brief')?.doc?.url ?? ''}). For each: name, link, real numbers with dates (concurrent players, visits, peaks), why it fits, and say what you rejected because it is saturated or fading. Output content: exactly three references, numbered, each with link and metrics.`,
  },
  {
    key: 'packet',
    stage: 'template',
    kind: 're_packet',
    label: 'Reverse-engineering packet',
    done: 'Reverse-engineering packet requested in its chat.',
    needs: i => (i.refs ? null : 'Find the 3 reference games first.'),
    task: i =>
      `Produce one ready-to-copy deep research prompt per reference game below, following the reverse-engineering schema file in the template skills folder. Lucas runs the research outside the panel. Output content: three numbered prompts, each self-contained (it names the game, its link, and every field of the schema).\nReference games:\n${i.refs ?? ''}`,
  },
  {
    key: 'template_doc',
    stage: 'template',
    kind: 'template_doc',
    label: 'Build template doc',
    done: 'Template doc requested in its chat.',
    needs: i => (i.research ? null : 'Register the finished research first.'),
    task: i =>
      `Merge the 2-page brief (${latestOf(i, 'brief')?.doc?.url ?? 'see the brief stage'}) with the three reverse-engineering reports below into one Google Doc: this prototype's own template. Output content: the doc link and the variation slots the template defines.\nResearch registered by Lucas:\n${clip(i.research ?? '', 6000)}`,
  },
  {
    key: 'fulldoc',
    stage: 'doccompleto',
    kind: 'fulldoc',
    label: 'Write full doc',
    done: 'Full doc requested in its chat.',
    needs: i => hasBrief(i) ?? hasTemplate(i),
    task: i =>
      `Write the full development doc for ${i.proto_id} as a Google Doc titled "${i.proto_id} - full doc". Merge the 2-page brief with the template (${i.template ? `library template https://docs.google.com/document/d/${i.template.id}` : latestOf(i, 'template', 'template_doc')?.doc?.url ?? ''}): core loop, rules, tunables with starting values, the variation slots filled, analytics events (roblox-analytics-events skill), minimum scope for the test and what is left out. Output content: the doc link and the three riskiest assumptions.`,
  },
  {
    key: 'build',
    stage: 'build',
    kind: 'build_plan',
    label: 'Plan the build',
    done: 'Build plan requested in its chat.',
    needs: hasTemplate,
    task: i =>
      `Plan the build of ${i.proto_id} from its full doc and template. Use the build skills (roblox-mvp-build, and roblox-3d-assets and roblox-ui-ux where relevant). List the work in order, say what can be done now with the Roblox Studio tools of this session and what needs Lucas or a missing asset. Never publish anything. Output content: the plan summary and a link if you wrote a doc.`,
  },
  {
    key: 'titles',
    stage: 'titulo',
    kind: 'titles',
    label: 'Generate titles',
    done: 'Titles requested in its chat.',
    task: (i, c) =>
      `Generate 5 game titles and a short listing description for ${i.proto_id} with the roblox-title-craft skill, ranked, each with the reason. Lucas picks in this chat. Output content: a numbered list, one title per item. Do not repeat earlier candidates: ${(i.outputs?.titulo ?? []).flatMap(o => splitItems(o.content)).slice(0, 15).map(t => clip(t.split('\n')[0] ?? '', 60)).join('; ') || 'none yet'}.${c.knowledge.length ? `\nTitle knowledge:\n${knowledgeLines(c.knowledge, 25)}` : ''}\nWhen Lucas chooses one, add: @@CHOSEN stage=titulo | <the chosen title>`,
  },
  {
    key: 'thumb',
    stage: 'thumb',
    kind: 'thumb_prompts',
    label: 'Generate 5 prompts',
    done: 'Thumbnail prompts requested in its chat.',
    task: (i, c) =>
      `You cannot generate images. Write 5 distinct image-generation prompts for the thumbnail of ${i.proto_id}, five different angles, with the roblox-thumbnail-ctr skill. Lucas runs them in ChatGPT. Output content: a numbered list, one complete prompt per item, each starting with its angle in a few words. ${
        (i.outputs?.thumb ?? []).length > 0
          ? `Angles already used, do not repeat them: ${(i.outputs?.thumb ?? []).flatMap(o => splitItems(o.content)).map(t => clip(t.split(/[.:\n]/)[0] ?? '', 50)).join('; ')}.`
          : ''
      }${c.knowledge.length ? `\nThumbnail knowledge:\n${knowledgeLines(c.knowledge, 25)}` : ''}\nWhen Lucas chooses a prompt, add: @@CHOSEN stage=thumb | <the chosen prompt>`,
  },
  {
    key: 'launch',
    stage: 'publicar',
    kind: 'launch',
    label: 'Prepare the launch',
    done: 'Launch plan requested in its chat.',
    task: i =>
      `Prepare the launch of ${i.proto_id} with the roblox-experiment-protocol skill: pre-registered hypothesis and prediction, traffic window, budget and audience to propose, readout timing, kill and scale thresholds. Never spend money or publish anything: Lucas approves the spend. Output content: the plan.`,
  },
  {
    key: 'results',
    stage: 'metricas',
    kind: 'results',
    label: 'Read the results',
    done: 'Results readout requested in its chat.',
    task: i =>
      `Read the results of ${i.proto_id} with the roblox-learning-log skill: ask Lucas for metrics you cannot reach, compare each prediction with the result, record the learning log, propose kill or scale with the reason. Memory files are in the Drive folder roblox_radar_memory (id ${MEMORY_FOLDER_ID}). Output content: the readout and the decision.`,
  },
]

export const actionsFor = (stage: string): FAction[] => ACTIONS.filter(a => a.stage === stage)
export const actionByKey = (key: string): FAction | undefined => ACTIONS.find(a => a.key === key)

// The full message sent to the prototype's chat for an action.
export function buildActionPrompt(a: FAction, i: Idea, c: PromptCtx): { text: string; gen: number } {
  const gen = nextGen(i, a.stage, a.kind)
  const text = [
    `Factory request for ${i.proto_id} "${i.title}", stage "${c.stageName}": ${a.label}.`,
    skillsInstruction(a.stage, c.folders),
    `Prototype facts: ${protoFacts(i)}`,
    a.task(i, c),
    protocolText(i, a.stage, a.kind, gen, c.criteria),
    RULES,
  ].join('\n\n')
  return { text, gen }
}

export function gatePrompt(i: Idea, from: string, to: string, c: PromptCtx): string {
  return [
    `Principles gate for ${i.proto_id} "${i.title}": the prototype wants to move from "${from}" to "${to}".`,
    skillsInstruction(from, c.folders),
    `Run the skill roblox-principles-gate for this transition. If the gate skill cannot be read, answer PASS WITH RISKS and say "gate skill not readable" in the reason.`,
    `Prototype facts: ${protoFacts(i)}`,
    `End your reply with exactly one line, at the very start of the line, outside any code block: @@GATE stage=${i.stage} verdict=<PASS|PASS WITH RISKS|BLOCK> | <one line reason>`,
    RULES,
  ].join('\n\n')
}

export function researchMessage(i: Idea, text: string): string {
  return `Lucas registered the finished reverse-engineering research for ${i.proto_id}. Keep it as context for the template doc:\n${clip(text, 8000)}`
}

export const TEMPLATE_LIBRARY_ID = TEMPLATE_FOLDER_ID
