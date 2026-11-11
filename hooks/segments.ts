// Video segments for the Gemini extraction prompts. Pure: windows, time labels and prompt filling.
export const SEGMENT_SECONDS = 600
export const OVERLAP_SECONDS = 10
export const MAX_SEGMENTS = 12

// MM:SS, or H:MM:SS from one hour on.
export function fmtTime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  const two = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${two(m)}:${two(r)}` : `${two(m)}:${two(r)}`
}

export const clampSegment = (n: number): number => Math.max(1, Math.min(MAX_SEGMENTS, Math.floor(Number.isFinite(n) ? n : 1)))

// Segment n covers (n-1)*600 to n*600 seconds, plus a 10 second overlap at the end.
export function segmentWindow(n: number): { index: number; startSec: number; endSec: number; start: string; end: string } {
  const index = clampSegment(n)
  const startSec = (index - 1) * SEGMENT_SECONDS
  const endSec = index * SEGMENT_SECONDS + OVERLAP_SECONDS
  return { index, startSec, endSec, start: fmtTime(startSec), end: fmtTime(endSec) }
}

export const segmentLabel = (n: number): string => {
  const w = segmentWindow(n)
  return `${w.start} to ${w.end}`
}

// Replaces {INDEX}, {START} and {END} everywhere. Any other placeholder (such as the audit's paste marker) stays.
export function fillPrompt(template: string, n: number): string {
  const w = segmentWindow(n)
  return template.split('{INDEX}').join(String(w.index)).split('{START}').join(w.start).split('{END}').join(w.end)
}

export const PROMPT_FILES = { extract: 'prompt_gemini_extract.txt', audit: 'prompt_gemini_audit.txt' } as const
export type PromptMode = keyof typeof PROMPT_FILES

// The Drive connector turns every line break into a Markdown hard break (two trailing spaces). Take them off a prompt read from Drive.
export function tidyPrompt(text: string): string {
  return text
    .split(String.fromCharCode(10))
    .map(l => l.replace(/ {2}$/, ''))
    .join(String.fromCharCode(10))
    .trim()
}
