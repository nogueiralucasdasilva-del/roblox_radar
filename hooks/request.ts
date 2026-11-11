// The one request builder. Every stage action and the principles gate go through buildRequest: the text has the same
// structure for every stage and carries no instruction about how to do a stage's work. That lives in the Drive skills
// (the stage folder and _all), and the tagged-block protocol lives in _all/skill_output_protocol.md.
export type RequestDoc = { stage: string; name: string; url: string }

export type RequestInput = {
  protoId: string
  title: string
  stageId: string
  stageName: string
  actionId: string
  actionLabel: string
  gen: number
  skills: { folder: string; stageFolderId: string | null; allId: string | null }
  protoFolder: { name: string; id: string | null }
  expectedDocName: string | null
  docs: readonly RequestDoc[]
  chosenReference?: string | null
  params?: Record<string, string | number | boolean | null | undefined>
}

const SKILLS_ROOT = 'roblox_radar_skills'
const idText = (id: string | null, fallback: string) => (id ? `id ${id}` : `id not known: ${fallback}`)

export function buildRequest(r: RequestInput): string {
  const head = `Prototype ${r.protoId} (${r.title}). Stage: ${r.stageName} (${r.stageId}). Action: ${r.actionLabel} (${r.actionId}). Generation: ${r.gen}.`
  const step0 = 'Step 0: follow _all/skill_output_protocol.md, including the Drive check.'
  const skills = `Skills: before starting, list the Drive folder ${r.skills.folder} (${idText(r.skills.stageFolderId, `find it inside the Drive folder ${SKILLS_ROOT}`)}) and the folder _all (${idText(r.skills.allId, `find it inside the Drive folder ${SKILLS_ROOT}`)}). Read every file in both (ignore subfolders) and follow them as the skills for this action. If a folder cannot be read, say so and use the installed skill of the same name if one exists.`
  const output = `Output: save every document you create in the Drive folder ${r.protoFolder.name} (${idText(r.protoFolder.id, 'find it inside the Drive folder roblox_radar_protos and create it if it is missing')}), ${r.expectedDocName ? `using exactly the name ${r.expectedDocName}` : 'if a skill asks for a document'}. End your reply with the tagged blocks defined in _all/skill_output_protocol.md.`
  const params = Object.entries(r.params ?? {})
    .filter(([, v]) => v !== null && v !== undefined && String(v) !== '')
    .map(([k, v]) => `${k}=${String(v)}`)
  const context: string[] = []
  for (const d of r.docs) context.push(`- ${d.stage} | ${d.name} | ${d.url}`)
  if (r.chosenReference) context.push(`Chosen reference: ${r.chosenReference}`)
  if (params.length > 0) context.push(`Params: ${params.join('; ')}`)
  return [head, step0, skills, output, context.length > 0 ? ['Context:', ...context].join(String.fromCharCode(10)) : 'Context: none.'].join(String.fromCharCode(10))
}
