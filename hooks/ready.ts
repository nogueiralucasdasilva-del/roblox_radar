// The Ready check: one line per thing that must work before a prototype goes through the Factory. Pure evaluators: the
// probes (Drive calls, tool list, receipts) are done by the caller and handed in, so every rule is unit tested.
import { IDEA_STAGES } from './model'
import type { SkillsState } from './skills'
import { SHARED, skillsFolderName } from './skills'

export type Level = 'green' | 'amber' | 'red'
export type ReadyItem = { id: string; label: string; level: Level; text: string }
export type ReadyReport = { at: string; items: ReadyItem[] }

export const PROTOCOL_FILE = 'skill_output_protocol.md'
export const MIN_PROTOCOL_VERSION = 2
export const COLLECTION_MAX_AGE_HOURS = 26

export function overallLevel(items: readonly ReadyItem[]): Level {
  if (items.some(i => i.level === 'red')) return 'red'
  if (items.some(i => i.level === 'amber')) return 'amber'
  return 'green'
}

export type Probe = { ok: boolean; error?: string }

export function evalDrive(search: Probe, read: Probe, create: Probe & { trashed?: boolean | null }): ReadyItem {
  const bad = [!search.ok ? `search: ${search.error ?? 'failed'}` : '', !read.ok ? `read: ${read.error ?? 'failed'}` : '', !create.ok ? `create: ${create.error ?? 'failed'}` : ''].filter(Boolean)
  if (bad.length > 0) return { id: 'drive', label: 'Drive search, read, create', level: 'red', text: bad.join('; ') }
  if (create.trashed === false || create.trashed === null || create.trashed === undefined) {
    return { id: 'drive', label: 'Drive search, read, create', level: 'amber', text: 'Search, read and create work. The test file could not be trashed: delete _readycheck_* in roblox_radar_protos by hand.' }
  }
  return { id: 'drive', label: 'Drive search, read, create', level: 'green', text: 'Search, read and create answer.' }
}

export function evalFolders(results: { name: string; ok: boolean; error?: string }[]): ReadyItem {
  const bad = results.filter(r => !r.ok)
  return bad.length > 0
    ? { id: 'folders', label: 'Folder ids', level: 'red', text: bad.map(b => `${b.name}: ${b.error ?? 'not found'}`).join('; ') }
    : { id: 'folders', label: 'Folder ids', level: 'green', text: `${results.map(r => r.name).join(', ')} resolve.` }
}

type StageRef = { id: string; name?: string; skills_folder?: string }

// Every Factory stage folder has at least one direct file, and the output protocol is version 2 or higher.
export function evalSkills(st: SkillsState | null, stages: readonly StageRef[]): ReadyItem {
  const id = 'skills'
  const label = 'Skills per stage'
  if (!st || !st.ok) return { id, label, level: 'red', text: st?.error ?? 'The skills folder has not been read yet.' }
  const empty: string[] = []
  for (const sid of IDEA_STAGES) {
    const stage = stages.find(s => s.id === sid) ?? { id: sid }
    const folder = skillsFolderName(st, stage)
    if ((st.files[folder] ?? []).length === 0) empty.push(folder)
  }
  const proto = (st.files[SHARED] ?? []).find(f => f.name === PROTOCOL_FILE)
  const problems: string[] = []
  if (empty.length > 0) problems.push(`no skill file in: ${empty.join(', ')}`)
  if (!proto) problems.push(`${SHARED}/${PROTOCOL_FILE} is missing`)
  else if ((proto.version ?? 0) < MIN_PROTOCOL_VERSION) problems.push(`${PROTOCOL_FILE} is version ${proto.version ?? 'unknown'}, needs ${MIN_PROTOCOL_VERSION} or higher (run /seed-skills)`)
  return problems.length > 0 ? { id, label, level: 'red', text: problems.join('; ') } : { id, label, level: 'green', text: `Every stage folder has files; protocol is version ${proto?.version}.` }
}

// Two files in one folder that declare the same action. Different versions: the newer wins (amber, listed). Same version: red.
export function evalDuplicates(st: SkillsState | null): ReadyItem {
  const id = 'duplicates'
  const label = 'Duplicate actions'
  if (!st || !st.ok) return { id, label, level: 'amber', text: 'Skills not read yet.' }
  const red: string[] = []
  const amber: string[] = []
  for (const [folder, files] of Object.entries(st.files)) {
    const byAction = new Map<string, typeof files>()
    for (const f of files) for (const a of f.actions ?? []) byAction.set(a, [...(byAction.get(a) ?? []), f])
    for (const [action, list] of byAction) {
      if (list.length < 2) continue
      const versions = new Set(list.map(f => f.version ?? 0))
      const text = `${folder}: action ${action} in ${list.map(f => `${f.name} (v${f.version ?? '?'})`).join(' and ')}`
      if (versions.size === list.length) amber.push(`${text}, the newer wins`)
      else red.push(`${text}, same version`)
    }
  }
  if (red.length > 0) return { id, label, level: 'red', text: [...red, ...amber].join('; ') }
  if (amber.length > 0) return { id, label, level: 'amber', text: amber.join('; ') }
  return { id, label, level: 'green', text: 'No action is declared twice in one folder.' }
}

const CHAT_TOOLS = ['start_session', 'open_session_in', 'list_sessions', 'list_events']

export function evalChatTools(toolNames: readonly string[]): ReadyItem {
  const missing = CHAT_TOOLS.filter(t => !toolNames.some(n => n.endsWith(`__${t}`)))
  return missing.length > 0
    ? { id: 'chat', label: 'Chat tools', level: 'red', text: `missing: ${missing.join(', ')}` }
    : { id: 'chat', label: 'Chat tools', level: 'green', text: `${CHAT_TOOLS.join(', ')} exist in the tool list.` }
}

export function evalScheduled(live: { ok: boolean; error?: string }): ReadyItem {
  return live.ok
    ? { id: 'tasks', label: 'Scheduled tasks', level: 'green', text: 'The live task list answers.' }
    : { id: 'tasks', label: 'Scheduled tasks', level: 'amber', text: `The live task list is not available (optional connector). ${live.error ?? ''}`.trim() }
}

export type CollectionReceipt = { finished_utc: string; items: { name: string; status: string }[] }

export function evalRadar(r: CollectionReceipt | null, nowMs: number): ReadyItem {
  const id = 'radar'
  const label = 'Radar freshness'
  if (!r) return { id, label, level: 'red', text: 'No collection receipt found.' }
  const hours = (nowMs - Date.parse(r.finished_utc)) / 3600000
  const count = (...s: string[]) => r.items.filter(i => s.includes(i.status)).length
  const dead = r.items.filter(i => ['dead', 'missing', 'failed'].includes(i.status)).map(i => i.name)
  const counts = `${count('ok')} ok, ${count('stale', 'skipped_cost')} stale, ${dead.length} dead${dead.length > 0 ? ` (${dead.join(', ')})` : ''}`
  const age = `newest collection ${hours < 1 ? 'under 1 h' : `${Math.round(hours)} h`} old`
  const level: Level = hours > COLLECTION_MAX_AGE_HOURS * 2 ? 'red' : hours > COLLECTION_MAX_AGE_HOURS ? 'amber' : 'green'
  return { id, label, level, text: `${age}; legs: ${counts}.` }
}

export type SelfResultLite = { file: string; ok: boolean; detail: string }

export function evalSelftest(results: readonly SelfResultLite[] | null): ReadyItem {
  if (!results) return { id: 'selftest', label: 'Parser self-test', level: 'amber', text: 'Not run yet.' }
  const failed = results.filter(r => !r.ok)
  return failed.length > 0
    ? { id: 'selftest', label: 'Parser self-test', level: 'red', text: `${failed.length} of ${results.length} failed: ${failed.slice(0, 3).map(f => `${f.file} (${f.detail})`).join('; ')}` }
    : { id: 'selftest', label: 'Parser self-test', level: 'green', text: `${results.length} fixtures pass.` }
}
