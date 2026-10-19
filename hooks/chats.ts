// Real app conversations behind the panel: each idea card and each stage gets its own Claude session,
// started once and reopened on every later click. The panel is only the skin; the chat is the app's own.
import type { Stage } from '../types'
import type { ChatLink, Idea } from './model'
import { clip } from './model'
export type { ChatLink }
import { MEMORY_FOLDER_ID, ideaFacts } from './memory'


const STYLE =
  'Write in English, even when Lucas writes in Portuguese. Be direct, no flattery, no em dashes, no emoji. Mark what is a fact (with its source and date) and what is your inference.'

export function ideaChatTitle(i: Idea): string {
  return clip(`Radar idea: ${i.title}`, 58)
}

export function stageChatTitle(s: Stage): string {
  return clip(`Radar stage: ${s.name}`, 58)
}

export function ideaBackground(): string {
  return `Roblox Radar is Lucas Nogueira's (Ritz Deli Games) pipeline that turns cultural trend signals into Roblox game prototypes: collection, screening, pre-validation, 2-page brief, template match, full doc, build, title, thumbnail, publish, metrics. This conversation belongs to one idea card in the Radar panel. The panel keeps the idea's memory in the Drive folder roblox_radar_memory (id ${MEMORY_FOLDER_ID}) and reads this conversation to update it.`
}

export function ideaOpening(i: Idea, scan: boolean): string {
  const lines = [
    `This is the chat for the idea "${i.title}" in the Roblox Radar pipeline. Lucas will come back to this same conversation every time he opens the card. ${STYLE}`,
    `Idea: ${ideaFacts(i)}`,
    i.memory ? `Memory of this idea so far:\n${i.memory}` : '',
    `Older material lives in the Drive folder roblox_radar_memory (id ${MEMORY_FOLDER_ID}); search there when you need it.`,
  ]
  if (scan) {
    lines.push(
      'Start now with the quick scan. Use the roblox-concept-validator skill (quick scan only, concept only, never loop design) if it is available. Check the latest dated files in the roblox_trends Drive folder for radar signal, and live Roblox numbers (concurrent players, visits, peaks, dates) for the closest existing games. Use real numbers with dates; if a tool is missing, say which and lower the confidence.',
      `Reply in exactly this format:
Potential: HIGH, MEDIUM or LOW, with high, medium or low confidence. One short sentence saying what you evaluated.

* Noun / verb: the noun and the verb of the fantasy. Whether the hook explains itself in one image, and who the audience is.
* Why it could work: whitespace, proof of demand with numbers, the clip moment.
* Why it could fail: weak or IP-driven demand, falling peaks, saturation, with numbers and dates.
* Radar: what the radar shows for this theme, by name. Say so plainly if it shows nothing.

To move up to the next level: the one change to the hook that would raise the potential.
Should I write the full brief (2 pages, Google Doc)? Yes, No, or Adjust the idea first.`,
      'After that, keep talking with Lucas about this idea. If he says yes, write the full 2-page brief as a Google Doc with the roblox-concept-validator skill and give him the link.',
    )
  } else {
    lines.push('Say in two lines where this idea stands, then wait for Lucas.')
  }
  return lines.filter(Boolean).join('\n\n')
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
