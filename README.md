<img src="assets/icon.png" width="96" alt="Roblox Radar symbol">

# Roblox Radar panel (mod)

Control surface for the Roblox Radar pipeline.

- **Two modes:** a switch at the top, `Radar | Factory`. `/panel radar` and `/panel factory` open the pane in a mode.
- **Radar mode:** collection (sources with status), screening and advisor (latest report open), and Loose ideas (an inbox of raw ideas). The auditor is a small bar. "Send to Factory" creates a prototype.
- **Factory mode:** a list of prototypes sorted by potential, then one selected prototype at a time: header with proto ID, editable ABBR, potential score and criteria bars, a stepper with a check per stage, and a panel per stage with its main action, its output, "Open chat", "Refresh now" and "Advance".
- **Proto IDs:** `P<seq>-<ABBR>`, for example `P001-MONSTER`. The counter is never reused. One app chat per prototype, titled `<proto id> | <title>`, filed in the Roblox Radar sidebar group.
- **Chat first:** the panel is a dashboard and launcher. Buttons send a request to the prototype's chat. The chat ends its reply with tagged blocks (`@@OUTPUT`, `@@DOC`, `@@CHOSEN`, `@@SCORES`, `@@GATE`) and the panel files them on the card. While a request waits, that chat is read every 30 seconds.
- **Potential score:** weights live in `data/scoring.json` (edit freely). The panel computes the overall percentage; `safety` is a gate below 40.
- **Skills live in Drive**, folder `roblox_radar_skills`, one subfolder per stage id plus `_all`. Every request tells the chat to read every file of its stage folder and `_all`. Add or edit files in Drive: no code change. `/seed-skills` recreates missing folders and seed files, never overwriting.
- **More:** one toggle with Overview, Pending, Skills and docs, Log, and a Skills row (files per stage, newest date).

## Install

Desktop app: click + next to the prompt box, Plugins, Add marketplace `nogueiralucasdasilva-del/roblox_radar`, then Add plugin `radar-panel`.

Terminal:

```
/plugin install radar-panel --marketplace nogueiralucasdasilva-del/roblox_radar
```

## Use

- `/panel` opens the pane, `/panel radar` or `/panel factory` picks the mode, `/stage <id>` focuses a stage, `/seed-skills` seeds the Drive skills.
- Text selector that works anywhere: start a message with `#brief`, `#build`, etc. (`#clear` resets).

## Live state (receipts)

- Every scheduled task (free scout, collection, advisor, thumbnails, status phase 1, status phase 2) ends its run by writing one receipt, a small Google Doc with a JSON body, into the Drive folder `roblox_radar_receipts`. Receipts are never edited.
- The mod lists that folder through the Google Drive connector, reads new receipts, and builds Sources, Reports, stage health, last run and late detection (no receipt 2 hours after the expected run) from them.
- Needs the Google Drive connector enabled in the local session. Without it the mod falls back to the snapshots below and says so in the Receipts tab.
- Format: see `claude/receipts_contrato.md` in the Roblox Radar project.

## Data

- `data/*.json` are fallback snapshots (status report of 2026-10-18, Slack posts read on 2026-10-19). They are used only until the first live receipts arrive, and for stage definitions, which are not receipts.
- Ideas, statuses, proto_ids, chats and repository entries you create live in the mod's own store and survive sessions.
- Stages run inside chats (concept validator, pre-validation) do not write receipts yet.
- The pane renders only on terminal, desktop and VS Code surfaces. The web client has none.

## Development

- `npm test` runs the unit tests of the pure modules (`factory.ts`, `scoring.ts`, `outputs.ts`) with `node:test`.
- `npm run typecheck` typechecks the sources against a loose stub of the host module.
- `hooks/register.test.ts` runs only inside the app's own test runner.
- `seed/` is gitignored: it holds the initial skill files used by `/seed-skills`.
