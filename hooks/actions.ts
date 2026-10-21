// The main action of each idea stage: one button on the card that sends the stage's job to the idea's own
// conversation (starting it first when needed) and opens it. Pure: prompts and labels only.
import type { Idea, Knowledge } from './model'
import { clip } from './model'
import { MEMORY_FOLDER_ID } from './memory'
import { TEMPLATE_FOLDER_ID } from './templates'

export type ActionCtx = { knowledge: Knowledge[]; templateLink: string | null }
export type StageAction = {
  label: string
  done: string // shown on the card after the click
  needs?: (i: Idea) => string | null // why the button is blocked, or null
  prompt: (i: Idea, c: ActionCtx) => string
}

const RULES =
  'Write in English. Be direct, no em dashes, no emoji. Facts carry a source and a date; inferences are marked as such. Never invent numbers.'

const knowledgeLines = (c: ActionCtx, n: number) =>
  c.knowledge
    .slice(-n)
    .map(k => `- ${k.kind}: ${clip(k.text, 240)} (${k.source})`)
    .join('\n')

export const STAGE_ACTIONS: Record<string, StageAction> = {
  prevalid: {
    label: 'Run the quick scan',
    done: 'Quick scan requested in its chat.',
    prompt: () =>
      `Run the quick scan of this idea now with the roblox-concept-validator skill (quick scan only, concept only). Use the card format: Potential with confidence, Noun / verb, Why it could work, Why it could fail, Radar, the change to reach the next level, and the Yes/No/Adjust question. ${RULES}`,
  },
  brief: {
    label: 'Write the 2-page brief',
    done: 'Brief requested in its chat.',
    prompt: i =>
      `Write the full 2-page concept brief now as a Google Doc with the roblox-concept-validator skill. Put the proto_id ${i.proto_id ?? '(none yet)'} in the title. Concept only, never loop design. Reply with the doc link, then three lines: the fantasy, the wedge, the main risk. ${RULES}`,
  },
  template: {
    label: 'Match a template',
    done: 'Template match requested in its chat.',
    prompt: i =>
      `Match this idea to a template from the library: the Drive folder roblox_radar_templates (id ${TEMPLATE_FOLDER_ID}), one Google Doc per template, title starting with template_. Read the brief of ${i.proto_id ?? 'this idea'} and every template doc. Recommend one template with the reason, the runner-up, and the variation slots this idea fills (theme, object, verb, visual, any slot the template defines). If no template fits or the folder is empty, say so and describe the template family this idea would need. Lucas picks the template on the card. ${RULES}`,
  },
  doccompleto: {
    label: 'Write the full doc',
    done: 'Full doc requested in its chat.',
    needs: i => (i.template ? null : 'Pick a template first (Template match stage).'),
    prompt: (i, c) =>
      `Write the full development doc for ${i.proto_id ?? 'this idea'} as a Google Doc titled "${i.proto_id ?? i.title} - full doc". Merge the 2-page brief with the template doc${c.templateLink ? ` (${c.templateLink})` : ''}: core loop, rules, tunables with starting values, the variation slots filled, analytics events (use the roblox-analytics-events skill), the minimum scope for the test and what is left out. Keep the template's proven structure; change only the slots. Reply with the doc link and the three riskiest assumptions. ${RULES}`,
  },
  build: {
    label: 'Plan the build',
    done: 'Build plan requested in its chat.',
    needs: i => (i.template ? null : 'Pick a template first (Template match stage).'),
    prompt: i =>
      `Plan the build of ${i.proto_id ?? 'this idea'} from its full doc and its template. List the work in order (base place from the template, slot changes, UI, analytics events, QA with the roblox-qa-checklist skill), say which parts can be done now with the Roblox Studio tools of this session and which need Lucas or a missing asset. Start with the first step only if the Studio tools are available and the full doc exists; otherwise stop after the plan. ${RULES}`,
  },
  titulo: {
    label: 'Propose titles',
    done: 'Titles requested in its chat.',
    prompt: (i, c) =>
      `Propose 5 game titles and a short listing description for ${i.proto_id ?? 'this idea'}, ranked, each with the reason. Follow the title knowledge below and the Roblox commandments; say which line of the knowledge each title uses.\n${knowledgeLines(c, 25) || '(the title repository is empty)'}\n${RULES}`,
  },
  thumb: {
    label: 'Draft thumbnails',
    done: 'Thumbnail concepts requested in its chat.',
    prompt: (i, c) =>
      `Draft 3 thumbnail concepts for ${i.proto_id ?? 'this idea'}: for each, what the 2-second read is, the composition, the text on image (if any), and a ready image-generation prompt. Use the thumbnail knowledge below and the latest weekly thumbnail hooks in the roblox_trends Drive folder.\n${knowledgeLines(c, 25) || '(the thumbnail repository is empty)'}\n${RULES}`,
  },
  publicar: {
    label: 'Prepare the launch',
    done: 'Launch plan requested in its chat.',
    prompt: i =>
      `Prepare the launch of ${i.proto_id ?? 'this idea'} with the roblox-experiment-protocol skill: the pre-registered hypothesis and prediction, the traffic window, budget and audience to propose, readout timing, and kill or scale thresholds. Never spend money or publish anything: Lucas approves the spend. ${RULES}`,
  },
  metricas: {
    label: 'Read the results',
    done: 'Results readout requested in its chat.',
    prompt: i =>
      `Read the results of ${i.proto_id ?? 'this idea'} with the roblox-learning-log skill: ask Lucas for the metrics you cannot reach, compare each prediction with the result, record the learning log, and propose kill or scale with the reason. Memory files are in the Drive folder roblox_radar_memory (id ${MEMORY_FOLDER_ID}). ${RULES}`,
  },
}

export function actionFor(stageId: string): StageAction | null {
  return STAGE_ACTIONS[stageId] ?? null
}
