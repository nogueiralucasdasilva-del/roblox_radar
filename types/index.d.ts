export type Pendency = { id: string; text: string; owner: string; since: string; done: boolean }
export type Item = { name: string; state: string }
export type Stage = {
  id: string
  name: string
  sub: string
  gate: boolean
  desc: string
  inputs: string
  outputs: string
  build: 'built' | 'partial' | 'not_built'
  build_note: string
  owner_chat: string
  trigger_ids: string[]
  status_doc: string
  docs: Item[]
  skills: Item[]
  pendencies: Pendency[]
  gate_note?: string
  no_task_note?: string
  flag: { level: 'warn' | 'err'; text: string } | null
  checked_at: string | null
  extra_tabs?: { id: string; label: string }[]
}
export type SourceStatus = 'working' | 'attention' | 'stale' | 'broken' | 'unknown'
export type Source = {
  id: string
  name: string
  family: string
  cadence: string
  status: SourceStatus
  collected_label: string
  collected_at: string | null
  note: string
  evidence: string
}
export type SourcesFile = { asof: string; origin: string; summary: string; sources: Source[] }
export type ReportItem = { title: string; verdict: string; note: string; ip?: boolean }
export type Report = {
  id: string
  date: string
  kind: 'themes' | 'hooks'
  title: string
  channel: string
  posted: string
  summary: string
  sections: { name: string; items: ReportItem[] }[]
  gaps?: string
}
export type ReportsFile = { asof: string; origin: string; reports: Report[] }
export type SeedFile = {
  ideas: { title: string; note: string; origin: 'advisor' | 'own' }[]
  knowledge: Record<string, { kind: string; text: string; source: string; tag: string }[]>
}
export type Data = { updated: string; note: string; stages: Stage[] }

declare module 'claude-code' {
  interface PluginState {
    'radar-panel': { selected: string | null; tab: string; rev: number; open: string[] }
  }
}
