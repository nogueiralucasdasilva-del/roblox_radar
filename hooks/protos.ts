// The prototype folders in Drive: roblox_radar_protos / <proto_id> / inputs. Idempotent: it searches before it creates,
// so running it twice never makes a second folder. The Drive call is injected, like in skills.ts.
import type { Drive } from './skills'

export const PROTOS_ROOT_NAME = 'roblox_radar_protos'
export const INPUTS_NAME = 'inputs'
const FOLDER_MIME = 'application/vnd.google-apps.folder'

export const folderUrl = (id: string): string => `https://drive.google.com/drive/folders/${id}`

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

const esc = (s: string): string => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")

// Finds a folder by exact name (under a parent when given). Returns its id, or null.
async function findFolder(drive: Drive, name: string, parentId: string | null): Promise<string | null> {
  const q = `title = '${esc(name)}' and mimeType = '${FOLDER_MIME}' and trashed = false${parentId ? ` and parentId = '${parentId}'` : ''}`
  const o = parse(await drive('search_files', { query: q, pageSize: 10, excludeContentSnippets: true }))
  const hit = (Array.isArray(o?.files) ? o.files : []).find((f: any) => f && typeof f.id === 'string' && String(f.title ?? f.name ?? '') === name)
  return hit ? hit.id : null
}

async function makeFolder(drive: Drive, name: string, parentId: string | null): Promise<string> {
  const made = parse(await drive('create_file', { title: name, contentMimeType: FOLDER_MIME, ...(parentId ? { parentId } : {}) }))
  if (!made || typeof made.id !== 'string') throw new Error(`Could not create the Drive folder ${name}.`)
  return made.id
}

export async function ensureProtosRoot(drive: Drive, cachedId: string): Promise<string> {
  if (cachedId) return cachedId
  return (await findFolder(drive, PROTOS_ROOT_NAME, null)) ?? (await makeFolder(drive, PROTOS_ROOT_NAME, null))
}

export type ProtoFolders = { rootId: string; folderId: string; folderUrl: string; inputsId: string }

// roblox_radar_protos / <proto_id> and its inputs subfolder, created only when missing.
export async function ensureProtoFolders(drive: Drive, cachedRootId: string, protoId: string, known?: { folderId?: string; inputsId?: string }): Promise<ProtoFolders> {
  const rootId = await ensureProtosRoot(drive, cachedRootId)
  const folderId = known?.folderId || (await findFolder(drive, protoId, rootId)) || (await makeFolder(drive, protoId, rootId))
  const inputsId = known?.inputsId || (await findFolder(drive, INPUTS_NAME, folderId)) || (await makeFolder(drive, INPUTS_NAME, folderId))
  return { rootId, folderId, folderUrl: folderUrl(folderId), inputsId }
}
