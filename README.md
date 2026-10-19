<img src="assets/icon.png" width="96" alt="Roblox Radar symbol">

# Roblox Radar panel (mod)

Control surface for the Roblox Radar pipeline.

- **Home:** the 12 stages as a numbered snake flow (1 to 4 left to right, 5 to 8 right to left, 9 to 12 left to right), with the registry bar and the learning loop.
- **Click a stage:** it opens full screen. Chat is the first tab, then the tabs that belong to the stage, then Overview, Tasks, Pending, Skills and docs, and Log (only when the stage has scheduled tasks or log entries).
- **Stage tabs:** Sources (collection), Reports (advisor), Ideas (pre-validation), Prototypes (brief to metrics, each card with its proto_id), Knowledge (Title and Thumbnail repositories), Registry.
- **Idea flow:** send an idea from an advisor report, or add your own, in Pre-validation. Set its status (pending, promising, rejected). Promote it stage by stage. The proto_id is created when it enters the brief. The format RB-date-slug is provisional.
- **Chats:** every stage has its own chat with a bounded context. A long chat rolls over into a new one with a summary. Lines starting with `INSTRUCTION:` or `KNOWLEDGE:` in an agent answer are saved as a standing instruction or a repository entry.

## Install

Desktop app: click + next to the prompt box, Plugins, Add marketplace `nogueiralucasdasilva-del/roblox_radar`, then Add plugin `radar-panel`.

Terminal:

```
/plugin install radar-panel --marketplace nogueiralucasdasilva-del/roblox_radar
```

## Use

- `/panel` opens the pane, `/stage <id>` selects a stage.
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
