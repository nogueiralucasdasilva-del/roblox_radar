import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createChat, findExisting, isPermissionError, openBeside, permissionHelp } from '../hooks/chatflow'
import type { Attempt, ChatDeps } from '../hooks/chatflow'

const input = { protoId: 'P003-MONSTER', title: 'P003-MONSTER | Monster Truck', prompt: 'prompt text', background: 'bg text' }

type Script = { list?: any[] | Error; start?: string | Error; mainErr?: Error; open?: Error }

// A fake app: records every call, answers from the script.
function fake(script: Script) {
  const calls: { server: string; tool: string; args: Record<string, unknown> }[] = []
  let main = 0
  const deps: ChatDeps = {
    call: async (server, tool, args) => {
      calls.push({ server, tool, args })
      if (tool === 'list_sessions') {
        if (script.list instanceof Error) throw script.list
        return JSON.stringify(script.list ?? [])
      }
      if (tool === 'start_session') {
        if (script.start instanceof Error) throw script.start
        return script.start ?? '{}'
      }
      if (tool === 'get_session') return JSON.stringify({ link: 'claude://x/local_new' })
      if (tool === 'open_session_in') {
        if (script.open) throw script.open
        return 'ok'
      }
      return ''
    },
    askMain: async () => {
      main++
      if (script.mainErr) throw script.mainErr
    },
    now: () => '2026-11-11T10:00:00.000Z',
  }
  return { deps, calls, mainCalls: () => main }
}

test('direct start works: one start_session call, a session id, a link, no main chat request', async () => {
  const f = fake({ start: JSON.stringify({ session_id: 'local_new' }) })
  const r = await createChat(f.deps, input)
  assert.equal(r.status, 'created')
  assert.equal((r as { id: string }).id, 'local_new')
  assert.equal((r as { link: string | null }).link, 'claude://x/local_new')
  assert.equal(f.calls.filter(c => c.tool === 'start_session').length, 1)
  const start = f.calls.find(c => c.tool === 'start_session')!
  assert.equal(start.args.title, 'P003-MONSTER | Monster Truck')
  assert.equal(start.args.initiation, 'user_asked')
  assert.equal(f.mainCalls(), 0)
  assert.ok(r.attempts.some(a => a.step === 'direct' && a.ok))
})

test('direct refused, then the main chat route works: status main-pending, both attempts logged', async () => {
  const f = fake({ start: new Error('mcp__ccd_session__start_session denied: no allow rule') })
  const r = await createChat(f.deps, input)
  assert.equal(r.status, 'main-pending')
  assert.equal(f.mainCalls(), 1)
  const steps = r.attempts.map(a => `${a.step}:${a.ok}`)
  assert.deepEqual(steps.filter(s => s !== 'find:true'), ['direct:false', 'main:true'])
  assert.ok(r.attempts.find(a => a.step === 'direct')!.detail.includes('denied'))
})

test('both routes fail: failed with both causes, and permission help applies', async () => {
  const f = fake({ start: new Error('denied by the classifier'), mainErr: new Error('The main chat refused the request') })
  const r = await createChat(f.deps, input)
  assert.equal(r.status, 'failed')
  const failed = r as { error: string; permission: boolean }
  assert.equal(failed.permission, true)
  assert.ok(failed.error.includes('denied by the classifier') && failed.error.includes('main chat refused'))
  assert.ok(permissionHelp().includes('mcp__ccd_session__start_session'))
  assert.ok(permissionHelp().includes('mcp__ccd_window__open_session_in'))
})

test('start_session answering without a session id counts as a failed direct attempt', async () => {
  const f = fake({ start: 'started, no id here' })
  const r = await createChat(f.deps, input)
  assert.equal(r.status, 'main-pending')
  assert.ok(r.attempts.find(a => a.step === 'direct')!.detail.includes('without a session id'))
})

test('a duplicate is never created: the stored id, the exact title or the proto id prefix is reused', async () => {
  for (const list of [
    [{ sessionId: 'local_old', title: 'P003-MONSTER | Monster Truck' }],
    [{ sessionId: 'local_old', title: 'p003-monster | something I renamed' }],
    [{ sessionId: 'local_stored', title: 'Totally different title' }],
  ]) {
    const f = fake({ list, start: JSON.stringify({ session_id: 'local_new' }) })
    const r = await createChat(f.deps, { ...input, storedId: 'local_stored' })
    assert.equal(r.status, 'existing')
    assert.equal(f.calls.filter(c => c.tool === 'start_session').length, 0)
    assert.equal(f.mainCalls(), 0)
  }
})

test('the list is read twice (group, then all) and a failing list does not stop the creation', async () => {
  const f = fake({ list: new Error('list_sessions failed'), start: JSON.stringify({ session_id: 'local_new' }) })
  const r = await createChat(f.deps, input)
  assert.equal(r.status, 'created')
  assert.equal(f.calls.filter(c => c.tool === 'list_sessions').length, 2)
  assert.equal(f.calls.filter(c => c.tool === 'list_sessions')[0]!.args.group, 'Roblox Radar')
  assert.ok(r.attempts.some(a => a.step === 'find' && !a.ok))
})

test('opening beside the panel: ok, or refused with the cause', async () => {
  const ok = await openBeside(fake({}).deps, 'local_new')
  assert.equal(ok.ok, true)
  const f = fake({ open: new Error('this session did not start that conversation') })
  const no = await openBeside(f.deps, 'local_old')
  assert.equal(no.ok, false)
  assert.ok(no.error!.includes('did not start'))
  assert.equal(f.calls[0]!.args.target, 'split')
})

test('permission errors are recognised', () => {
  assert.equal(isPermissionError('mcp__x denied: classifier said no'), true)
  assert.equal(isPermissionError('network timeout'), false)
})

test('findExisting with a rows wrapper object', async () => {
  const f = fake({ list: undefined })
  f.deps.call = async () => JSON.stringify({ sessions: [{ id: 'local_a', title: 'P003-MONSTER | Monster Truck', link: 'claude://a' }] })
  const attempts: Attempt[] = []
  const r = await findExisting(f.deps, input, attempts)
  assert.equal(r?.id, 'local_a')
  assert.equal(r?.link, 'claude://a')
})
