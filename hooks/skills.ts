// Skills live in Drive, not in the mod: Lucas edits them without touching GitHub.
// Layout: roblox_radar_skills / <stage id> / any files, plus roblox_radar_skills / _all / any files read by every stage.
// This module lists the folders so the panel can show them and record which versions were present when a request was made.
// The chat itself reads the files: the panel never names an individual skill.
import type { SkillRef } from './model'
import { unwrapDoc } from './receipts'

// Id of the Drive folder roblox_radar_skills. Created in 0.7.0; /seed-skills recreates missing folders and files without overwriting.
export const SKILLS_ROOT_ID = '1XduWjErt3wDKfUz9mLOn5B-tTbgei0CN'
export const SKILLS_ROOT_NAME = 'roblox_radar_skills'
export const SHARED = '_all'
export const SKILL_STAGES = ['coleta', 'triagem', 'prevalid', 'brief', 'template', 'reveng', 'doccompleto', 'build', 'titulo', 'thumb', 'publicar', 'metricas']
export const TOOL_FOLDER = '_tool'
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

// Every seeded skill file has `seed_version: N` right after its title, and may declare the actions it covers as (action: x).
export function parseSeedVersion(text: string): number | null {
  const m = /^\s*seed_version:\s*(\d+)/m.exec(text)
  return m && m[1] ? Number(m[1]) : null
}

export function declaredActions(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/\(actions?:\s*([a-z0-9_,\s]+)\)/gi)) {
    for (const a of String(m[1]).split(',')) {
      const t = a.trim().toLowerCase()
      if (t && !out.includes(t)) out.push(t)
    }
  }
  return out
}

// What each skill file says about itself, cached by file id and modified time so a refresh reads only what changed.
const fileMeta = new Map<string, { modified: string; version: number | null; actions: string[] }>()

async function describeFile(drive: Drive, f: any): Promise<SkillRef> {
  const name = String(f.title ?? f.name ?? '')
  const modified = String(f.modifiedTime ?? '')
  const base: SkillRef = { name, modified, id: typeof f.id === 'string' ? f.id : undefined }
  if (!/\.(md|txt)$/i.test(name) || typeof f.id !== 'string') return base
  const hit = fileMeta.get(f.id)
  if (hit && hit.modified === modified) return { ...base, version: hit.version, actions: hit.actions }
  try {
    const text = unwrapDoc(await drive('read_file_content', { fileId: f.id }))
    const meta = { modified, version: parseSeedVersion(text), actions: declaredActions(text) }
    fileMeta.set(f.id, meta)
    return { ...base, version: meta.version, actions: meta.actions }
  } catch {
    return base
  }
}

// Resolves the stage folder ids by name and lists the files of each. Reads a file only to learn its version and actions.
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
      files[name] = (await Promise.all(list.map(f => describeFile(drive, f)))).sort((a, b) => a.name.localeCompare(b.name))
    }
    return { at: now, ok: true, rootId, ids, files }
  } catch (err: any) {
    return { at: now, ok: false, error: String((err && err.message) || err).slice(0, 300), rootId, ids: previous?.ids ?? {}, files: previous?.files ?? {} }
  }
}

// The Drive skills folder name of a stage: its `skills_folder` when that folder exists (or nothing is known yet),
// else the folder named by the stage id when that one exists, else `skills_folder` or the id.
export function skillsFolderName(st: SkillsState | null, stage: { id: string; skills_folder?: string }): string {
  const wanted = stage.skills_folder
  if (!wanted) return stage.id
  if (!st || !st.ok) return wanted
  if (st.ids[wanted]) return wanted
  return st.ids[stage.id] ? stage.id : wanted
}

// The stage folder id plus the shared folder id. `folder` is the skills folder name (see skillsFolderName).
export function skillFolders(st: SkillsState | null, folder: string): { stage: string | null; all: string | null } {
  return { stage: st?.ids[folder] ?? null, all: st?.ids[SHARED] ?? null }
}

// Direct files in the stage folder and in _all (subfolders such as _tool are never counted), with their modified times.
export function skillFiles(st: SkillsState | null, folder: string): SkillRef[] {
  if (!st) return []
  return [...(st.files[folder] ?? []), ...(st.files[SHARED] ?? [])]
}

// The panel's own tool files (the Gemini prompts) in <folder>/_tool, found and cached by modified time.
export type ToolFile = { id: string; name: string; modified: string }
export async function listToolFiles(drive: Drive, st: SkillsState | null, folder: string): Promise<ToolFile[]> {
  const parent = st?.ids[folder]
  if (!parent) return []
  const sub = (await listChildren(drive, parent, true)).find(f => String(f.title ?? f.name ?? '') === TOOL_FOLDER)
  if (!sub) return []
  return (await listChildren(drive, sub.id, false)).map(f => ({ id: String(f.id), name: String(f.title ?? f.name ?? ''), modified: String(f.modifiedTime ?? '') }))
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
  { folder: 'prevalid', name: 'skill_prevalid_scan.md', src: ['prevalid/skill_prevalid_scan.md'] },
  { folder: 'brief', name: 'skill_brief_document.md', src: ['brief/skill_brief_document.md'] },
  { folder: 'doccompleto', name: 'skill_fulldoc.md', src: ['doccompleto/skill_fulldoc.md'] },
  { folder: 'build', name: 'skill_build_plan_output.md', src: ['build/skill_build_plan_output.md'] },
  { folder: 'titulo', name: 'skill_titulo_output.md', src: ['titulo/skill_titulo_output.md'] },
  { folder: 'thumb', name: 'skill_thumb_output.md', src: ['thumb/skill_thumb_output.md'] },
  { folder: 'publicar', name: 'skill_launch_output.md', src: ['publicar/skill_launch_output.md'] },
  { folder: 'metricas', name: 'skill_results_output.md', src: ['metricas/skill_results_output.md'] },
  { folder: SHARED, name: 'skill_gate_request.md', src: ['_all/skill_gate_request.md'] },
  { folder: SHARED, name: 'skill_output_protocol.md', src: ['_all/skill_output_protocol.md'] },
  { folder: 'brief', name: 'skill_brief_reference_candidates.md', src: ['brief/skill_brief_reference_candidates.md'] },
  { folder: 'reveng', name: 'skill_reveng_validate.md', src: ['reveng/skill_reveng_validate.md'] },
  { folder: 'reveng', name: 'skill_reveng_build_template.md', src: ['reveng/skill_reveng_build_template.md'] },
  { folder: 'reveng', name: 'validate_extraction.py', src: ['reveng/validate_extraction.py'] },
  { folder: 'reveng', name: 'ref_how_to_reverse_engineer_roblox_games.md', src: ['reveng/ref_how_to_reverse_engineer_roblox_games.md'] },
  { folder: 'reveng/_tool', name: 'prompt_gemini_extract.txt', src: ['reveng/_tool/prompt_gemini_extract.txt'] },
  { folder: 'reveng/_tool', name: 'prompt_gemini_audit.txt', src: ['reveng/_tool/prompt_gemini_audit.txt'] },
  { folder: SHARED, name: 'skill_scoring_rubric.md', src: ['_all/skill_scoring_rubric.md', 'skill_scoring_rubric.md'] },
]

// Creates the missing folders and the missing seed files. Never overwrites: a file whose name exists is compared, and when
// it differs the new text goes up as <name>.new. A folder path such as reveng/_tool is created level by level.
export async function seedSkills(drive: Drive, rootId: string, readSeed: (relPath: string) => Promise<string | null>): Promise<{ created: string[]; skipped: string[]; missing: string[]; replaced: string[]; proposed: string[] }> {
  const out = { created: [] as string[], skipped: [] as string[], missing: [] as string[], replaced: [] as string[], proposed: [] as string[] }
  const ids: Record<string, string> = {}
  for (const f of await listChildren(drive, rootId, true)) ids[String(f.title ?? f.name ?? '')] = f.id
  const ensureFolder = async (path: string): Promise<string | null> => {
    if (ids[path]) return ids[path] as string
    const parts = path.split('/')
    const name = parts[parts.length - 1] as string
    const parentPath = parts.slice(0, -1).join('/')
    const parentId = parentPath ? await ensureFolder(parentPath) : rootId
    if (!parentId) return null
    if (parentPath) {
      const sub = (await listChildren(drive, parentId, true)).find(f => String(f.title ?? f.name ?? '') === name)
      if (sub) {
        ids[path] = sub.id
        return sub.id
      }
    }
    const made = parse(await drive('create_file', { title: name, parentId, contentMimeType: FOLDER_MIME }))
    if (made && typeof made.id === 'string') {
      ids[path] = made.id
      out.created.push(`folder ${path}`)
      return made.id
    }
    return null
  }
  for (const name of [...SKILL_STAGES, SHARED]) await ensureFolder(name)
  for (const m of SEED_MAP) {
    const folderId = await ensureFolder(m.folder)
    if (!folderId) continue
    let text: string | null = null
    for (const src of m.src) {
      text = await readSeed(src)
      if (text) break
    }
    if (!text) {
      out.missing.push(m.name)
      continue
    }
    const have = await listChildren(drive, folderId, false)
    const same = have.find(f => String(f.title ?? f.name ?? '') === m.name)
    let title = m.name
    let replaceId: string | null = null
    if (same) {
      let current = ''
      try {
        current = unwrapDoc(await drive('read_file_content', { fileId: same.id }))
      } catch {
        current = ''
      }
      if (current && current.trim() === text.trim()) {
        out.skipped.push(m.name)
        continue
      }
      const curV = parseSeedVersion(current) ?? 0
      const newV = parseSeedVersion(text) ?? 0
      if (newV <= curV) {
        out.skipped.push(`${m.name} (Drive has version ${curV}, seed has ${newV})`)
        continue
      }
      // The Drive connector cannot edit file content, so "replace in place" is: upload the new version, then trash the old one.
      // Only an unedited file (modified time equals created time) is replaced; an edited one gets a .proposed.md next to it.
      if (String(same.modifiedTime ?? '') === String(same.createdTime ?? '') && String(same.modifiedTime ?? '') !== '') {
        replaceId = String(same.id)
        out.replaced.push(m.name)
      } else {
        title = m.name.replace(/\.md$/i, '') + '.proposed.md'
        if (have.some(f => String(f.title ?? f.name ?? '') === title)) {
          out.skipped.push(`${m.name} (a .proposed.md already exists)`)
          continue
        }
        out.proposed.push(m.name)
      }
    }
    const made = parse(await drive('create_file', { title, parentId: folderId, contentMimeType: 'text/plain', disableConversionToGoogleType: true, textContent: text }))
    if (replaceId && made && typeof made.id === 'string') {
      try {
        await drive('trash_file', { fileId: replaceId })
      } catch {
        out.proposed.push(`${m.name} (new version uploaded, the old file could not be trashed: trash it by hand)`)
      }
    }
    out.created.push(title)
  }
  return out
}
