// The action registry of the Factory: which button exists on which stage, its label, when it is enabled, and the small
// facts it passes along as params. There is no instruction about how to do a stage's work in this file: that lives in
// the Drive skills, and the text sent to the chat is built only by request.ts.
import type { Idea } from './model'
import { IDEA_STAGES, clip } from './model'
import { docName } from './docnames'
import type { DocKind } from './docnames'
import { docLinks, newestDocs, templateDone } from './factory'
import { splitItems } from './outputs'
import { buildRequest } from './request'
import { scanContext } from './scan'
import type { RequestDoc } from './request'

export type Param = string | number | boolean

export type FAction = {
  key: string // the action id sent in the request
  stage: string
  kind: string // the output kind tracked for this action
  label: string
  done: string // shown after the click
  docKind: DocKind | null // the document kind this action is expected to save (names the file)
  needs?: (i: Idea) => string | null // why the button is blocked, or null
  params?: (i: Idea) => Record<string, Param>
  gen?: (i: Idea) => number // generation of the request, when it is not the next output generation
}

export type RequestCtx = {
  stageName: string
  skills: { folder: string; stageFolderId: string | null; allId: string | null }
  protoFolder: { name: string; id: string | null }
}

const hasBrief = (i: Idea): string | null => (docLinks(i, 'brief').length > 0 ? null : 'Write the 2-page brief first.')
const hasTemplate = (i: Idea): string | null => (i.template || templateDone(i) ? null : 'Finish Reverse engineering first (validated extraction and template doc).')
const chosenRef = (i: Idea) => (i.refs && i.refs.chosenIndex !== null ? i.refs.candidates[i.refs.chosenIndex] : undefined)
const newestUrl = (i: Idea, stage: string, kind: string): { url: string; fileId: string | null } | null => {
  const d = newestDocs(i.docs?.[stage] ?? []).find(x => x.kind === kind)
  return d ? { url: d.url, fileId: d.fileId } : null
}
const previous = (i: Idea, stage: string): string =>
  clip(
    (i.outputs?.[stage] ?? [])
      .flatMap(o => splitItems(o.content))
      .slice(0, 15)
      .map(t => clip(t.split('\n')[0] ?? '', 60))
      .join(' / '),
    600,
  )

export const ACTIONS: FAction[] = [
  { key: 'scan', stage: 'prevalid', kind: 'scan', label: 'Run quick scan', done: 'Quick scan requested in its chat.', docKind: 'scan' },
  {
    key: 'brief',
    stage: 'brief',
    kind: 'brief',
    label: 'Write 2-page brief',
    done: 'Brief requested in its chat.',
    docKind: 'brief',
    // The latest scan travels with the brief request, so the brief reuses its evidence instead of searching again.
    params: (i): Record<string, Param> => {
      const sc = (i.outputs?.prevalid ?? []).find(o => o.scan)?.scan
      const out: Record<string, Param> = {}
      if (sc) out.scan = scanContext(sc)
      return out
    },
  },
  { key: 'refs', stage: 'brief', kind: 'refs', label: 'Find references', done: 'Reference candidates requested in its chat.', docKind: 'brief', needs: hasBrief },
  {
    key: 'reveng_validate',
    stage: 'template',
    kind: 'reveng_validation',
    label: 'Validate doc',
    done: 'Validation requested in its chat.',
    docKind: 'reveng-report',
    needs: i => (i.reveng && i.reveng.gen > 0 && i.reveng.uploads[i.reveng.gen] ? null : 'Upload the extraction files first.'),
    gen: i => i.reveng?.gen ?? 1,
    params: i => ({
      batch: i.reveng?.gen ?? 1,
      inputs_folder: i.inputsFolderId ?? '',
      no_economy: i.reveng?.noEconomy ?? false,
      merged_name: docName(i.proto_id ?? '', 'template', 'reveng-merged', i.reveng?.gen ?? 1),
      report_name: docName(i.proto_id ?? '', 'template', 'reveng-report', i.reveng?.gen ?? 1),
    }),
  },
  {
    key: 'reveng_build',
    stage: 'template',
    kind: 'template_doc',
    label: 'Build template doc',
    done: 'Template doc requested in its chat.',
    docKind: 'template-doc',
    needs: i => (i.reveng && (i.reveng.verdict === 'PASS' || i.reveng.verdict === 'PASS WITH GAPS') ? null : 'Needs a PASS or PASS WITH GAPS validation.'),
    params: i => {
      const merged = newestUrl(i, 'template', 'reveng-merged')
      const brief = docLinks(i, 'brief')[0]
      return { merged_url: merged?.url ?? '', merged_file_id: merged?.fileId ?? '', brief_url: brief?.url ?? '', chosen_reference: chosenRef(i)?.name ?? '' }
    },
  },
  { key: 'fulldoc', stage: 'doccompleto', kind: 'fulldoc', label: 'Write full doc', done: 'Full doc requested in its chat.', docKind: 'fulldoc', needs: i => hasBrief(i) ?? hasTemplate(i) },
  { key: 'build', stage: 'build', kind: 'build_plan', label: 'Plan the build', done: 'Build plan requested in its chat.', docKind: 'build-plan', needs: hasTemplate },
  { key: 'titles', stage: 'titulo', kind: 'titles', label: 'Generate titles', done: 'Titles requested in its chat.', docKind: 'titles', params: i => ({ avoid_items: previous(i, 'titulo') }) },
  { key: 'thumb', stage: 'thumb', kind: 'thumb_prompts', label: 'Generate 5 prompts', done: 'Thumbnail prompts requested in its chat.', docKind: 'thumb-prompts', params: i => ({ avoid_items: previous(i, 'thumb') }) },
  { key: 'launch', stage: 'publicar', kind: 'launch', label: 'Prepare the launch', done: 'Launch plan requested in its chat.', docKind: 'launch' },
  { key: 'results', stage: 'metricas', kind: 'results', label: 'Read the results', done: 'Results readout requested in its chat.', docKind: 'results' },
]

export const actionsFor = (stage: string): FAction[] => ACTIONS.filter(a => a.stage === stage)
export const actionByKey = (key: string): FAction | undefined => ACTIONS.find(a => a.key === key)

// Highest generation already used by outputs or documents of this kind, plus one.
export function nextGeneration(i: Idea, a: FAction): number {
  const fromOutputs = (i.outputs?.[a.stage] ?? []).filter(o => o.kind === a.kind).reduce((m, o) => Math.max(m, o.gen), 0)
  const fromDocs = a.docKind ? (i.docs?.[a.stage] ?? []).filter(d => d.kind === a.docKind).reduce((m, d) => Math.max(m, d.gen), 0) : 0
  return Math.max(fromOutputs, fromDocs) + 1
}

// Every document saved so far, newest per kind, in stage order: what the chat gets as context.
export function contextDocs(i: Idea): RequestDoc[] {
  const out: RequestDoc[] = []
  for (const stage of IDEA_STAGES) {
    const seen = new Set<string>()
    for (const d of newestDocs(i.docs?.[stage] ?? [])) {
      out.push({ stage, name: d.name, url: d.url })
      seen.add(d.url)
    }
    for (const l of docLinks(i, stage)) if (!seen.has(l.url)) out.push({ stage, name: l.name, url: l.url })
  }
  return out
}

function chosenText(i: Idea): string | null {
  const c = chosenRef(i)
  return c ? `${c.name}${c.url ? `, ${c.url}` : ''}` : null
}

// The only way an action becomes text for the chat.
export function buildActionRequest(a: FAction, i: Idea, ctx: RequestCtx, extra?: Record<string, Param>): { text: string; gen: number; expectedDocName: string } {
  const gen = a.gen ? a.gen(i) : nextGeneration(i, a)
  const expectedDocName = docName(i.proto_id ?? '', a.stage, a.docKind ?? 'scan', gen)
  const text = buildRequest({
    protoId: i.proto_id ?? '',
    title: i.title,
    stageId: a.stage,
    stageName: ctx.stageName,
    actionId: a.key,
    actionLabel: a.label,
    gen,
    skills: ctx.skills,
    protoFolder: ctx.protoFolder,
    expectedDocName,
    docs: contextDocs(i),
    chosenReference: chosenText(i),
    params: a.params || extra ? { ...(a.params ? a.params(i) : {}), ...(extra ?? {}) } : undefined,
  })
  return { text, gen, expectedDocName }
}

// The principles gate is a request like any other: the skill (in _all) says what to check, the protocol says how to answer.
export function buildGateRequest(i: Idea, from: string, to: string, ctx: RequestCtx): string {
  return buildRequest({
    protoId: i.proto_id ?? '',
    title: i.title,
    stageId: i.stage,
    stageName: ctx.stageName,
    actionId: 'gate',
    actionLabel: 'Principles gate',
    gen: 1,
    skills: ctx.skills,
    protoFolder: ctx.protoFolder,
    expectedDocName: null,
    docs: contextDocs(i),
    chosenReference: chosenText(i),
    params: { from, to },
  })
}

// Plain facts about the prototype for the opening of its chat. Data only.
export function protoFacts(i: Idea): string {
  const brief = docLinks(i, 'brief')[0]
  const tpl = i.template ? `${i.template.name} (library, https://docs.google.com/document/d/${i.template.id})` : (docLinks(i, 'template')[0]?.url ?? null)
  const chosenTitle = (i.outputs?.titulo ?? []).flatMap(o => o.chosen)[0] ?? null
  return JSON.stringify({
    proto_id: i.proto_id,
    title: i.title,
    note: i.note,
    stage: i.stage,
    brief_doc: brief?.url ?? null,
    template: tpl,
    chosen_reference: chosenText(i),
    chosen_title: chosenTitle,
    drive_folder: i.driveFolderUrl ?? null,
  })
}
