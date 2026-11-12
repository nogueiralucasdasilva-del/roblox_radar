// Creating and opening a prototype's chat, as a sequence with a clear result at every step. Pure orchestration: the app
// calls are injected, so every path (direct works, direct refused, main chat route, both fail, duplicate) is unit tested.
import { parseLink, parseSessionId } from './chats'
import { jsonOf } from './receipts'

export type Attempt = { step: 'find' | 'direct' | 'main' | 'open'; ok: boolean; detail: string; at: string }

export type ChatDeps = {
  // Calls an app tool (server name without the mcp__ prefix). Throws when denied or failed.
  call: (server: string, tool: string, args: Record<string, unknown>) => Promise<string>
  // Sends the request to the main chat route. Resolves when the request was submitted; the chat appears later.
  askMain: (req: { title: string; prompt: string; background: string }) => Promise<void>
  now: () => string
}

export type ChatInput = { protoId: string; title: string; prompt: string; background: string; storedId?: string | null }

export type CreateResult =
  | { status: 'existing' | 'created'; id: string; link: string | null; attempts: Attempt[] }
  | { status: 'main-pending'; attempts: Attempt[] }
  | { status: 'failed'; error: string; permission: boolean; attempts: Attempt[] }

// The permission rules Lucas can add to his settings so the panel can create and open chats from a click.
export const PERMISSION_RULES = ['mcp__ccd_session__start_session', 'mcp__ccd_window__open_session_in', 'mcp__ccd_session_mgmt__list_sessions', 'mcp__ccd_session_mgmt__list_events']

export const isPermissionError = (msg: string): boolean => /classifier|verdict|auto mode|denied|permission|not allowed|refused/i.test(msg)

const norm = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').trim()

// The rows of a list_sessions answer, whatever wraps them: a JSON array, {sessions: [...]}, or an array inside text.
export function sessionRows(text: string): any[] {
  const tryParse = (t: string): any => {
    try {
      return JSON.parse(t)
    } catch {
      return null
    }
  }
  let o: any = tryParse(text) ?? jsonOf(text)
  if (!o) {
    const a = text.indexOf('[')
    const b = text.lastIndexOf(']')
    if (a >= 0 && b > a) o = tryParse(text.slice(a, b + 1))
  }
  return Array.isArray(o) ? o : Array.isArray(o?.sessions) ? o.sessions : Array.isArray(o?.data) ? o.data : []
}

const err = (e: unknown): string => String((e && (e as { message?: string }).message) || e).slice(0, 300)

// Looks for a chat of this prototype: by the stored id, by the exact title, or by the proto id at the start of the title.
// The list is read twice (the Roblox Radar group, then everything) because a plain list of 100 may not reach an old chat.
export async function findExisting(deps: ChatDeps, input: ChatInput, attempts: Attempt[]): Promise<{ id: string; link: string | null } | null> {
  const want = norm(input.title)
  const idPrefix = `${input.protoId.toLowerCase()} |`
  for (const args of [{ limit: 100, group: 'Roblox Radar' }, { limit: 100 }]) {
    try {
      const rows = sessionRows(await deps.call('ccd_session_mgmt', 'list_sessions', args))
      for (const r of rows) {
        const id = r?.sessionId ?? r?.session_id ?? r?.id
        if (typeof id !== 'string') continue
        const t = norm(String(r?.title ?? r?.name ?? ''))
        if ((input.storedId && id === input.storedId) || t === want || t.startsWith(idPrefix)) {
          attempts.push({ step: 'find', ok: true, detail: `found ${id}`, at: deps.now() })
          return { id, link: typeof r?.link === 'string' ? r.link : null }
        }
      }
    } catch (e) {
      attempts.push({ step: 'find', ok: false, detail: `list_sessions ${JSON.stringify(args)}: ${err(e)}`, at: deps.now() })
    }
  }
  attempts.push({ step: 'find', ok: true, detail: 'no existing chat', at: deps.now() })
  return null
}

// Step 3: a chat for the prototype. Never makes a second one: it looks first. Stops at the first route that works.
export async function createChat(deps: ChatDeps, input: ChatInput): Promise<CreateResult> {
  const attempts: Attempt[] = []
  const found = await findExisting(deps, input, attempts)
  if (found) return { status: 'existing', id: found.id, link: found.link, attempts }

  let directError = ''
  try {
    const raw = await deps.call('ccd_session', 'start_session', {
      initiation: 'user_asked',
      title: input.title,
      prompt: input.prompt,
      background: input.background,
      context: 'fresh',
      use_worktree: false,
    })
    const id = parseSessionId(raw)
    if (id) {
      attempts.push({ step: 'direct', ok: true, detail: `start_session gave ${id}`, at: deps.now() })
      let link: string | null = null
      try {
        link = parseLink(await deps.call('ccd_session_mgmt', 'get_session', { session_id: id }))
      } catch {
        // the link is a convenience
      }
      return { status: 'created', id, link, attempts }
    }
    directError = `start_session answered without a session id: ${raw.slice(0, 160)}`
  } catch (e) {
    directError = err(e)
  }
  attempts.push({ step: 'direct', ok: false, detail: directError, at: deps.now() })

  try {
    await deps.askMain({ title: input.title, prompt: input.prompt, background: input.background })
    attempts.push({ step: 'main', ok: true, detail: 'request sent to the main chat', at: deps.now() })
    return { status: 'main-pending', attempts }
  } catch (e) {
    const mainError = err(e)
    attempts.push({ step: 'main', ok: false, detail: mainError, at: deps.now() })
    return { status: 'failed', error: `${directError}. Main chat route: ${mainError}`, permission: isPermissionError(directError) || isPermissionError(mainError), attempts }
  }
}

// Step 4: open the chat beside the panel. The app only does this for chats this session started.
export async function openBeside(deps: ChatDeps, id: string): Promise<{ ok: boolean; error?: string; attempt: Attempt }> {
  try {
    await deps.call('ccd_window', 'open_session_in', { session_id: id, target: 'split' })
    return { ok: true, attempt: { step: 'open', ok: true, detail: `opened ${id} beside the panel`, at: deps.now() } }
  } catch (e) {
    const error = err(e)
    return { ok: false, error, attempt: { step: 'open', ok: false, detail: error, at: deps.now() } }
  }
}

export type StepName = 'proto' | 'folder' | 'docs' | 'chat' | 'open'
export type StepState = 'pending' | 'running' | 'done' | 'failed'
export const STEP_LABEL: Record<StepName, string> = { proto: 'Prototype and ID', folder: 'Drive folder', docs: 'Status and potential docs', chat: 'Chat link', open: 'Chat opened' }
export const STEP_ORDER: StepName[] = ['proto', 'folder', 'docs', 'chat']

// The text of the notice when the chat could not be created: the cause, and the rules that let the app do it from a click.
export function permissionHelp(): string {
  return `Add these permission rules to your Claude settings so the panel can create and open chats from a click: ${PERMISSION_RULES.join(', ')}.`
}
