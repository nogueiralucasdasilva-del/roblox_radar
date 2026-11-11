// Real app conversations behind the panel: each idea card and each stage gets its own Claude session,
// started once and reopened on every later click. The panel is only the skin; the chat is the app's own.
import type { Stage } from '../types'
import type { ChatLink, Idea } from './model'
import { clip } from './model'
export type { ChatLink }
import { MEMORY_FOLDER_ID, ideaFacts } from './memory'
import { chatTitleOf } from './factory'
import { protoFacts } from './actions'


const STYLE =
  'Write in English, even when Lucas writes in Portuguese. Be direct, no flattery, no em dashes, no emoji. Mark what is a fact (with its source and date) and what is your inference.'

export function ideaChatTitle(i: Idea): string {
  if (i.proto_id) return chatTitleOf(i.proto_id, i.title)
  return clip(`Radar idea: ${i.title}`, 58)
}

export function stageChatTitle(s: Stage): string {
  return clip(`Radar stage: ${s.name}`, 58)
}

export function ideaBackground(): string {
  return `Roblox Radar is Lucas Nogueira's (Ritz Deli Games) pipeline that turns cultural trend signals into Roblox game prototypes: collection, screening, pre-validation, 2-page brief, template match, full doc, build, title, thumbnail, publish, metrics. This conversation belongs to one idea card in the Radar panel. The panel keeps the idea's memory in the Drive folder roblox_radar_memory (id ${MEMORY_FOLDER_ID}) and reads this conversation to update it.`
}

// One chat per prototype for its whole life. The panel sends each Factory request here and reads the tagged blocks back.
export function protoOpening(i: Idea, task?: string): string {
  return [
    `This is the chat for the prototype ${i.proto_id} "${i.title}" in the Roblox Radar Factory. Lucas will come back to this same conversation for every stage of this prototype. ${STYLE}`,
    `Prototype facts: ${protoFacts(i)}`,
    i.memory ? `Memory of this prototype so far:\n${i.memory}` : '',
    i.note ? `Origin note: ${i.note}` : '',
    `Older material lives in the Drive folder roblox_radar_memory (id ${MEMORY_FOLDER_ID}); search there when you need it.`,
    'The panel sends requests to this chat, one stage at a time, each with its own instructions and the tagged blocks to end your reply with. Follow them exactly: the panel reads those blocks from this conversation.',
    task ? `First request:\n${task}` : 'Say in two lines where this prototype stands, then wait for the first request.',
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function ideaOpening(i: Idea, task?: string): string {
  return protoOpening(i, task)
}

export function stageBackground(): string {
  return `Roblox Radar is Lucas Nogueira's (Ritz Deli Games) pipeline that turns cultural trend signals into Roblox game prototypes. This conversation is the standing chat of one pipeline stage, opened from the Radar panel. The panel keeps each stage's memory in the Drive folder roblox_radar_memory (id ${MEMORY_FOLDER_ID}) and reads this conversation to update it.`
}

export function stageOpening(stage: Stage, updated: string, context: readonly string[]): string {
  return [
    `This is the chat for the "${stage.name}" stage (id ${stage.id}) of the Roblox Radar pipeline. Lucas will come back to this same conversation every time he opens the stage. ${STYLE}`,
    `Stage snapshot recorded on ${updated}; it may be stale, so verify live status before stating it:`,
    JSON.stringify(stage),
    ...context,
    'Say in three lines what this stage holds right now and what is open, then wait for Lucas.',
  ].join('\n\n')
}

// The session id a start_session result carries. Tries JSON first, then the id patterns the app uses.
export function parseSessionId(text: string): string | null {
  try {
    const o = JSON.parse(text)
    const v = o?.session_id ?? o?.sessionId ?? o?.id ?? o?.session?.id
    if (typeof v === 'string' && v) return v
  } catch {
    // not JSON
  }
  const m =
    text.match(/session_?id["'\s:=]+["']?([A-Za-z0-9_-]{6,})/i) ??
    text.match(/\b(local_[A-Za-z0-9_-]{6,})/) ??
    text.match(/\b(cse_[A-Za-z0-9_-]{6,})/) ??
    text.match(/#([A-Za-z0-9_-]{8,})\)/)
  return m && m[1] ? m[1] : null
}

export function parseLink(text: string): string | null {
  try {
    const o = JSON.parse(text)
    if (typeof o?.link === 'string' && o.link) return o.link
  } catch {
    // not JSON
  }
  const m = text.match(/"link"\s*:\s*"([^"]+)"/) ?? text.match(/\b(claude:\/\/[^\s"')]+)/)
  return m && m[1] ? m[1] : null
}
