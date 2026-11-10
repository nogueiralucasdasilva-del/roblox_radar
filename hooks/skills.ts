// Skills live in Drive, not in the mod: Lucas edits them without touching GitHub.
// Layout: roblox_radar_skills / <stage id> / any files, plus roblox_radar_skills / _all / any files read by every stage.
// This module lists the folders so the panel can show them and record which versions were present when a request was made.
// The chat itself reads the files: the panel never names an individual skill.
import type { SkillRef } from './model'

// Id of the Drive folder roblox_radar_skills. Created in 0.7.0; /seed-skills recreates missing folders and files without overwriting.
export const SKILLS_ROOT_ID = '1XduWjErt3wDKfUz9mLOn5B-tTbgei0CN'
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

// Initial skill files and where they live in Drive. src lists the places to look inside <plugin root>/seed/.
export const SEED_MAP: { folder: string; name: string; src: string[] }[] = [
  { folder: 'build', name: 'skill_roblox_mvp_build.md', src: ['roblox-mvp-build/SKILL.md', 'skill_roblox_mvp_build.md'] },
  { folder: 'build', name: 'skill_roblox_3d_assets.md', src: ['roblox-3d-assets/SKILL.md', 'skill_roblox_3d_assets.md'] },
  { folder: 'build', name: 'skill_roblox_ui_ux.md', src: ['roblox-ui-ux/SKILL.md', 'skill_roblox_ui_ux.md'] },
  { folder: 'thumb', name: 'skill_roblox_thumbnail_ctr.md', src: ['roblox-thumbnail-ctr/SKILL.md', 'skill_roblox_thumbnail_ctr.md'] },
  { folder: 'titulo', name: 'skill_roblox_title_craft.md', src: ['roblox-title-craft/SKILL.md', 'skill_roblox_title_craft.md'] },
  { folder: SHARED, name: 'skill_roblox_principles_gate.md', src: ['roblox-principles-gate/SKILL.md', 'skill_roblox_principles_gate.md'] },
  { folder: 'template', name: 'skill_template_reverse_engineering_schema.md', src: ['template/skill_template_reverse_engineering_schema.md', 'skill_template_reverse_engineering_schema.md'] },
  { folder: SHARED, name: 'skill_scoring_rubric.md', src: ['_all/skill_scoring_rubric.md', 'skill_scoring_rubric.md'] },
]

// Creates the missing stage folders and the missing seed files. Never overwrites: a file whose title exists is skipped.
export async function seedSkills(drive: Drive, rootId: string, readSeed: (relPath: string) => Promise<string | null>): Promise<{ created: string[]; skipped: string[]; missing: string[] }> {
  const out = { created: [] as string[], skipped: [] as string[], missing: [] as string[] }
  const ids: Record<string, string> = {}
  for (const f of await listChildren(drive, rootId, true)) ids[String(f.title ?? f.name ?? '')] = f.id
  for (const name of [...SKILL_STAGES, SHARED]) {
    if (ids[name]) continue
    const made = parse(await drive('create_file', { title: name, parentId: rootId, contentMimeType: FOLDER_MIME }))
    if (made && typeof made.id === 'string') {
      ids[name] = made.id
      out.created.push(`folder ${name}`)
    }
  }
  for (const m of SEED_MAP) {
    const folderId = ids[m.folder]
    if (!folderId) continue
    const have = await listChildren(drive, folderId, false)
    if (have.some(f => String(f.title ?? f.name ?? '') === m.name)) {
      out.skipped.push(m.name)
      continue
    }
    let text: string | null = null
    for (const src of m.src) {
      text = await readSeed(src)
      if (text) break
    }
    if (!text) {
      out.missing.push(m.name)
      continue
    }
    await drive('create_file', { title: m.name, parentId: folderId, contentMimeType: 'text/plain', disableConversionToGoogleType: true, textContent: text })
    out.created.push(m.name)
  }
  return out
}
