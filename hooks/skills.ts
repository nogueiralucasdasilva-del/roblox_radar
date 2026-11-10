// Skills live in Drive, not in the mod: Lucas edits them without touching GitHub.
// Layout: roblox_radar_skills / <stage id> / any files, plus roblox_radar_skills / _all / any files read by every stage.
// This module lists the folders so the panel can show them and record which versions were present when a request was made.
// The chat itself reads the files: the panel never names an individual skill.
import type { SkillRef } from './model'

// Id of the Drive folder roblox_radar_skills. Empty until the folder is created (see CHANGELOG, /seed-skills).
export const SKILLS_ROOT_ID = ''
export const SKILLS_ROOT_NAME = 'roblox_radar_skills'
export const SHARED = '_all'
export const SKILL_STAGES = ['coleta', 'triagem', 'prevalid', 'brief', 'template', 'doccompleto', 'build', 'titulo', 'thumb', 'publicar', 'metricas']
const FOLDER_MIME = 'application/vnd.google-apps.folder'

export type SkillsState = { at: string; ok: boolean; error?: string; rootId: string; ids: Record<string, string>; files: Record<string, SkillRef[]> }
export type Drive = (tool: string, args: Record<string, unknown>) => Promise<string>

const parse = (raw: string): any => {
  try {
    return JSON.parse(raw)
  } catch {
    const a = raw.indexOf('{')
    const b = raw.lastIndexOf('}')
    if (a >= 0 && b > a) {
      try {
        return JSON.parse(raw.slice(a, b + 1))
      } catch {
        return null
      }
    }
    return null
  }
}

async function listChildren(drive: Drive, parentId: string, folders: boolean): Promise<any[]> {
  const out: any[] = []
  let token: string | undefined
  for (let page = 0; page < 5; page++) {
    const raw = await drive('search_files', {
      query: `parentId = '${parentId}' and mimeType ${folders ? '=' : '!='} '${FOLDER_MIME}' and trashed = false`,
      pageSize: 100,
      excludeContentSnippets: true,
      ...(token ? { pageToken: token } : {}),
    })
    const o = parse(raw)
    for (const f of Array.isArray(o?.files) ? o.files : []) if (f && typeof f.id === 'string') out.push(f)
    token = typeof o?.nextPageToken === 'string' ? o.nextPageToken : undefined
    if (!token) break
  }
  return out
}

// Resolves the stage folder ids by name and lists the files of each. Never reads file content.
export async function refreshSkills(drive: Drive, rootId: string, previous: SkillsState | null, now: string): Promise<SkillsState> {
  if (!rootId) return { at: now, ok: false, error: 'The skills folder is not set up yet. Run /seed-skills.', rootId, ids: {}, files: {} }
  try {
    const ids: Record<string, string> = previous && previous.rootId === rootId ? { ...previous.ids } : {}
    for (const f of await listChildren(drive, rootId, true)) {
      const name = String(f.title ?? f.name ?? '')
      if (name === SHARED || SKILL_STAGES.includes(name)) ids[name] = f.id
    }
    const files: Record<string, SkillRef[]> = {}
    for (const [name, id] of Object.entries(ids)) {
      const list = await listChildren(drive, id, false)
      files[name] = list.map(f => ({ name: String(f.title ?? f.name ?? ''), modified: String(f.modifiedTime ?? '') })).sort((a, b) => a.name.localeCompare(b.name))
    }
    return { at: now, ok: true, rootId, ids, files }
  } catch (err: any) {
    return { at: now, ok: false, error: String((err && err.message) || err).slice(0, 300), rootId, ids: previous?.ids ?? {}, files: previous?.files ?? {} }
  }
}

// The stage folder id plus the shared folder id.
export function skillFolders(st: SkillsState | null, stageId: string): { stage: string | null; all: string | null } {
  return { stage: st?.ids[stageId] ?? null, all: st?.ids[SHARED] ?? null }
}

// Files in the stage folder and in _all, with their modified times.
export function skillFiles(st: SkillsState | null, stageId: string): SkillRef[] {
  if (!st) return []
  return [...(st.files[stageId] ?? []), ...(st.files[SHARED] ?? [])]
}

export function newest(files: readonly SkillRef[]): string {
  return files.reduce((m, f) => (f.modified > m ? f.modified : m), '')
}
