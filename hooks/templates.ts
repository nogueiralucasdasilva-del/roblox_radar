// The template library lives in Drive, one Google Doc per template. The panel reads the folder, so a new or edited
// doc shows up in the Template match stage on its own.
import { unwrapDoc } from './receipts'

export const TEMPLATE_FOLDER_ID = '1uUUsQ-t8Kl1LCVJZTG3nNuz_lwHS22uv'
export const TEMPLATE_PREFIX = 'template_'

export type Template = {
  id: string // Drive file id
  name: string
  family: string
  status: 'ready' | 'draft'
  summary: string
  link: string | null
  modified: string
}

const HEADER = /^\s*(template|name|family|status|summary)\s*:\s*(.+?)\s*$/i

// Reads the four header lines of a template doc. Missing lines fall back to the doc title.
export function parseTemplate(docText: string, file: { id: string; title: string; viewUrl?: string | null; modifiedTime?: string | null }): Template {
  const body = unwrapDoc(docText)
  const found: Record<string, string> = {}
  for (const line of body.split('\n').slice(0, 30)) {
    const m = HEADER.exec(line)
    if (!m || !m[1] || !m[2]) continue
    const key = m[1].toLowerCase() === 'name' ? 'template' : m[1].toLowerCase()
    if (!found[key]) found[key] = m[2]
  }
  const fromTitle = file.title.replace(new RegExp(`^${TEMPLATE_PREFIX}`), '').replace(/_/g, ' ').trim()
  return {
    id: file.id,
    name: found.template ?? fromTitle,
    family: (found.family ?? fromTitle).toLowerCase(),
    status: /^ready/i.test(found.status ?? '') ? 'ready' : 'draft',
    summary: found.summary ?? '',
    link: file.viewUrl ?? null,
    modified: file.modifiedTime ?? '',
  }
}
