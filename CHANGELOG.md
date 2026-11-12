# Changelog

## 0.9.5

- The panel reads the Drive documents of every active prototype (not only the selected one) every minute, and the top Refresh button reads them too. Before, a prototype that was only the default choice was never read, so the potential and the statuses never updated.
- A line under the prototype header shows when the documents were read (or why they could not be), with links to the status and potential documents and a `Refresh docs` button.
- The creation card follows Drive: when both documents exist the docs step is done, and the old waiting text of the chat step is cleared.
- Done stages are green and show an `Open doc` link next to `Copy prompt`.
- Copy prompt is instant: the prompts are kept in memory and checked against Drive every 90 seconds (a click uses a prompt checked in the last 3 minutes, otherwise it reads Drive first; the file is read again only when its modified time changed).

## 0.9.4

Fewer tokens in every stage.

- No tagged blocks any more (only `@@FAIL`). The result lives in the Drive documents, so the reply is at most 4 short lines with no narration. `_all/skill_output_protocol.md` is version 3 and shorter.
- The panel no longer reads prototype chat transcripts and no longer calls a model (Haiku) every 5 minutes to rewrite a chat memory.
- Status and potential documents are plain text files (no Google Doc conversion, no escaping). The status document has a `SUMMARIES` section, one line per finished stage.
- Pre-validation research is capped at 5 web sources and 3 competitor pages.
- Each card shows a suggested model (Sonnet, or Opus for Full doc and Build) in its opened details.

## 0.9.3

- Copy prompt reads Drive on every click and takes the newest prompt file by name in the stage folder, so an edit in Drive is used at once.
- The Copy prompt buttons sit inside the card, on the right, centered.
- The panel finds the prototype chat by its title (the one you create by hand), saves its id and link, writes the link into the status document, and shows the chat beside the panel when the prototype is selected. Pasting the link stays as a fallback.

## 0.9.1

- The Radar and Factory buttons have the same spacing as Refresh and More.

## 0.9.0

The panel is a cover over Drive. The chat does the work and keeps two documents; the panel shows them and copies prompts.

- Creating a prototype: ID, Drive folder, then two standing documents in the folder (`<proto_id>_00_status`, `<proto_id>_00_potential`). The chat is created by Lucas (the app does not let a plugin start one): the card shows the title to copy and a box to paste the chat link, which is written into the status document. Older prototypes get a `Create status and potential docs` button.
- Stage cards are static. Each has a `Copy prompt` button; opening a card lists the skills, the prompt and the documents of the stage by name, each a link to Drive. Reverse engineering has `Copy Gemini prompt` and `Copy validation prompt`.
- Standard prompts live in Drive as `prompt_<stage>.md` next to the skills. The panel fills `{{proto_id}}`, `{{folder_url}}`, `{{gen}}` and copies the text. Each prompt tells the chat to read the status document and every document it lists, use the skill and template, save the stage document, and update the status and potential documents.
- The panel reads the status and potential documents from Drive (every 60 seconds for the selected prototype, and on `Refresh now`): stage statuses, document links, the current stage and the potential scores come from there.
- Stage order: Pre-validation, 2-page brief, Reverse engineering, Title, Thumbnail, Full doc, Build, Publish, Metrics. Document numbers follow (`_04_titles`, `_05_thumb-prompts`, `_06_fulldoc`, `_07_build-plan`).
- Skills rewritten with document templates in Drive (`template_*_doc.md`). The Pre-validation document uses the 8-criteria layout (POTENTIAL, CONFIDENCE, CRITERIA, KNOCKOUTS, COMPARABLES, RECOMMENDATION). The full doc has 14 sections that the build reads.

### Deliberate parity changes

- Factory card presses toggle the card instead of opening the full stage screen; new rows under each card; new creation scenarios; stage order change (156 key and position changes).

### Decisions taken

- The old `@@` tag reader and the per-stage action buttons stay in the code but are no longer reachable from the cards; they are removed in a later version once the Drive flow is proven.
- The Pre-validation scan card of 0.8.2 is not shown any more (its parser expects the old format).
- Not tested live: document creation, replacement and prompt copy against the real Drive connector.

## 0.8.3

- The main-chat route marks the prompt and background as data for `start_session` (the main chat used to answer them as if it were the new chat). If the main chat ends its turn without starting the chat, the card shows the failure with `Retry chat`.
- Version bump so the plugin cache picks the fix up (0.8.2 was already cached).

## 0.8.2

Factory readiness: Lucas can start a prototype and go through all nine stages with no silent failure. Every failure shows its cause and the next step.

### What changed

- Phase 1, chat creation: creating a prototype shows a four-step sequence (prototype, Drive folder, chat, first message) with a state and error per step, `Retry chat`, an Open chat link, and the exact permission rule text when the host refuses to start a session. An existing chat is found by stored id, exact title or the proto id prefix, so a retry never makes a duplicate.
- Phase 2, readiness: a Ready check (More section, one coloured dot in the header) tests chat tools, Drive read and write, the skills folders, skill versions, duplicate actions, scheduled tasks and radar freshness. A self-test runs the fixture replies through the real parser, the real state code and the real stage cards, in a scratch store. `/panel selftest` runs it from the command line.
- Skills carry `seed_version` and declared actions. `/seed-skills` replaces an unedited Drive file (create new, trash old) or uploads `<name>.proposed.md` when the Drive file was edited. The skills row shows the file name, version, date and a warning for `.proposed.md`.
- Step 0 line in every request (follow the protocol, including the Drive check). A request with no answer after 10 minutes shows `No reply yet` and `Ask chat for status`; an answer without tags shows `The chat replied without tags` and `Ask chat to reformat`. Neither auto-resends.
- Parser tolerance: fenced blocks, CRLF, wrapped transcripts, trailing spaces; verdicts and fails only count after their own request header.
- Phase 3, pre-validation scan (0.8.1 sections B, C, D): `hooks/scan.ts` reads the scan lines (POTENCIAL, NOUN_VERB, WEDGE, ENGINE, FUNCIONA, FALHA, up to 3 CONCORRENTE, KO, CONFIANCA, EVIDENCIA, evidence tags F, I, H, V, dead clone under 5 percent of peak). A valid scan marks the stage done and applies provisional scores (6 of 10 criteria) until the brief re-scores them; an invalid scan keeps the raw text with an amber notice naming the missing keys. The card shows the potential chip, confidence, wedge, competitors, knockouts and the decision row (Write 2-page brief primary, Adjust idea with a 200 character note, Stop here with a second press). The brief request carries the latest scan, clipped to 600 characters. The Factory hero card shows the potential and wedge line. Section A (the Drive skill) was not executed here: the shipped v2 seed files are used.
- Phase 4: `test/walk.test.ts` walks one prototype through all nine stages on the fixture replies (ask, reply, output, gate, advance, archive) and prints one report line per stage.
- Version 0.8.2. Tests 80, smoke and parity (87 scenarios) pass.

### Parity baseline changes (deliberate)

- Six new scan card scenarios added (three width tiers, BAIXO, unrecognized scan, chosen decision). The 81 earlier scenarios are unchanged.
- The self-test now runs 20 fixtures (13 golden, 7 pre-validation).

### Decisions taken

- The pre-validation stage shows the scan panel instead of the generic latest output block; its older generations sit under `Show history`.
- `Stop here` sends one line to the chat, sets `decision: 'stopped'` and archives through the existing Archive flow.
- Live Drive and chat checks were not run in this task (no live host session): the walk uses fixtures. The first real run of each stage is still to be seen by Lucas.
- Other Drive seed files without `seed_version` get it at the next `/seed-skills`.

## 0.8.0

The panel is a shell. Reverse engineering replaces Template match. Each prototype has its own Drive folder.

### What changed

- One request builder (`hooks/request.ts`). Every stage action and the principles gate become the same four-part text: the prototype line, the Skills line (read every file of the stage skills folder and `_all`, ignore subfolders), the Output line (the prototype Drive folder and the exact document name), and the Context lines (earlier documents, the chosen reference, params). `hooks/actions.ts` (was `prompts.ts`) is only the action registry.
- The output protocol lives in Drive (`_all/skill_output_protocol.md`). The parser stays in the mod and now reads `@@REFS`, `@@VERDICT` and `@@FAIL` too. A verdict or failure counts only after the request it answers; a failure returns a pending request to "not started" with its reason.
- Prototype Drive folder `roblox_radar_protos/<proto_id>/inputs`, created once when the prototype is created (or lazily at its next action for older prototypes). Idempotent: searched before created. `Open folder` link in the prototype header. A Drive failure shows an amber note and is retried.
- Standard document names `<proto_id>_<NN>_<kind>_v<gen>` (`hooks/docnames.ts`). `@@DOC` registers documents in `idea.docs[stage]`; `Open doc` link on the stage panel and on the stage card; older 0.7.x output links show too. Best effort check with `get_file_metadata`: a warning when the name is not the standard one or the file is not inside the prototype folder.
- Stage `template` is shown as Reverse engineering (id unchanged, `skills_folder: reveng`). Four steps: Copy prompt JSON (segment 1 to 12, Extract or Audit, filled from the Drive prompt files and copied), Upload doc (local files or a folder, classified, numbered and uploaded with standard names), Validate doc (generic request, verdict chip PASS, PASS WITH GAPS, FAIL), Build template doc. The stage is done with a passing verdict plus a template doc.
- The 2-page brief now yields three reference candidates (`@@REFS`), shown on the brief card and on the Reverse engineering card, where `Choose` stores the choice and sends one line to the chat. `Find references` runs the `refs` action for older prototypes.
- Skills row counts `reveng` and ignores `_tool`. `/seed-skills` seeds nested folders and uploads `<name>.new` when a Drive file differs.
- Version 0.8.0. New unit tests (request builder, doc names, tag parser, segments, upload planning, folder idempotence, connector read-back escaping).

### Removed from the code during the shell audit (moved to Drive skills, or dropped)

- All per-action work instructions in `prompts.ts` (scan format, brief output lines, full doc contents, build plan rules, title and thumbnail rules, launch and results rules). Their text is now in the seed skills `prevalid/skill_prevalid_scan.md`, `brief/skill_brief_document.md`, `doccompleto/skill_fulldoc.md`, `build/skill_build_plan_output.md`, `titulo/skill_titulo_output.md`, `thumb/skill_thumb_output.md`, `publicar/skill_launch_output.md`, `metricas/skill_results_output.md`.
- The protocol block and the "read the Drive skills" sentence built in code (now `request.ts` and `_all/skill_output_protocol.md`).
- The gate prompt with its fallback sentence (now `_all/skill_gate_request.md`).
- The old Template match actions (find 3 reference games, reverse-engineering packet, register research, build template doc) and the research input.
- The knowledge repository text that titles and thumbnails used to inject into the prompt. The repository still exists in the panel but is no longer sent to the chat: put that knowledge in the Drive skills of the stage.
- The legacy idea agent flows (`scanPrompt`, `briefPrompt`, `ideaChatPrompt`, `startIdeaJob`, `onIdeaDone`) and the non-prototype chat opening.

### Decisions taken

- Stage id stays `template`; the Drive skills folder is `reveng` (`skills_folder`), with a fallback to the folder named by the stage id.
- No Drive folder rename when the ABBR changes: the ABBR can no longer change since 0.7.4, and the stored folder id would be kept anyway.
- The library path (`fetchTemplates`, `chooseTemplate`) is kept but hidden behind `SHOW_LIBRARY_PATH = false`; the `template_mode` field stays, unused.
- Clipboard order: the app clipboard (`$.ui.copy`), then an OS tool started without a shell (`clip`, `pbcopy`, `wl-copy`, `xclip`), then a file in Downloads plus an expandable block in the panel. Not verified inside the app.
- Upload uses the Drive connector with a JSON file type first (tested: the connector accepts it and keeps the size), and falls back to a text file (a Google Doc) if refused. The connector returns file text Markdown-escaped on read-back; the loader and the prompt reader undo that.
- `Upload doc` is the submit button of its input (an `Input` only gives its text on submit), so when that is the next step, the highlighted marker is the "next" tag and not a filled button.
- Parity baseline updated for the deliberate changes only: the two template path toggles and the research input are gone; new buttons for references, the four steps, segment and mode pills, the economy toggle and `Open doc` / `Open folder` links.
- The validator script (`validate_extraction.py`) was not run here: the package is untrusted data and the task forbids executing anything from it.
- Drive permission rule needed for the document check: `get_file_metadata` (the other Drive tools in use are already allowed).

## 0.7.5

Design polish only. No behavior change.

- New design tokens (`hooks/theme.ts`, additions only) and a presentational kit (`hooks/ui/kit.tsx`): chip, tint, pill, button kinds, meter, rule, kv, notice, empty state, rail, section title, width tiers.
- Header, segmented Radar/Factory control, unified cards with a state chip and connectors, full screen shell with a segmented stepper.
- Radar: sources, advisor reports, loose ideas, tasks, receipts restyled with chips, tints and aligned tables.
- Factory: picker menu with aligned columns, hero card (ID chip, potential chip, stage progress meter, criteria), compact two-line cards for stages that are not current and not done (`COMPACT_CARDS`), stage panel with one primary button per block, numbered template steps, chosen items marked.
- More section, knowledge, templates, skills table and the error view restyled.
- Parity guard (`npm run parity`): buttons, hotkeys, inputs and links of 60 smoke scenarios match the 0.7.4 baseline.
- Not used because the host types are not available here: hover, alignSelf, space-between, a stretching rail. The rail is a glyph column, and the template steps use indentation instead of a vertical line.

## 0.7.4

- A proto ID never changes once created. The ABBR editor, its button and the rename logic are removed. Archive stays.
- Decision: ABBR is chosen once, automatically, when the prototype is created (the earlier "editable ABBR" rule is dropped).

## 0.7.3

Layout in the order Lucas asked for.

- Top to bottom: the name, the general status, two big highlighted buttons (Radar and Factory), the other buttons (Refresh, More), then the cards.
- Radar and Factory cards share one look and sit one under the other, full width.
- Factory: a drop-down menu to choose the proto ID, the potential readings right below it, then the nine stages one under the other, with a check on the stages that are done. The old prototype table and stage filter are gone. With no choice made, the prototype with the highest potential is shown.
- The ABBR editor and Archive moved into a "Prototype settings" toggle.

## 0.7.2

Back to the map of numbered cards, one map per mode.

- Radar shows its cards: 1 Collection, 2 Screening and advisor, 3 Loose ideas, plus the Auditor bar. A card opens full screen (back to Pipeline, previous and next, numbered stepper), as in 0.6.x.
- Factory shows the nine stage cards for the selected prototype (DONE, ASKED, NOT STARTED, NOT REACHED, the current stage marked, the latest output on the card). Without a selection it shows the prototype list and how many prototypes sit at each stage.
- Cards are wider so stage names are not cut. The criteria bars start collapsed.
- The sub-tab bar of 0.7.1 is removed.

## 0.7.1

Layout fix after the first look at the real screen.

- Fixed: Factory showed a blank pane when there were prototypes (a box inside a button and text inside text are not allowed by the app). The prototype list is now built only from buttons and texts.
- Radar now has sub-tabs: Collection, Advisor, Loose ideas (one at a time). The two main tabs, Radar and Factory, are real tabs with the active one highlighted and a count on Factory.
- A drawing error no longer blanks the pane: it shows the cause with "Back to Radar" and "Try again".
- Bad saved tab values (mode, sub-tab, stage, prototype) fall back to safe defaults.
- New offline render smoke test (`npm run smoke`): renders Radar and Factory in 27 states (empty, with prototypes, every stage, archived, gates, old store shape, forced error) and checks the element tree.

## 0.7.0

Radar and Factory, in the same pane.

- Mode switch `Radar | Factory`, persisted. Commands `/panel radar`, `/panel factory`, `/seed-skills`.
- Radar mode: collection, screening and advisor, Loose ideas inbox, auditor bar. Registry bar and view removed. "Learning feeds back" line and row notes removed.
- Factory mode: prototype list sorted by potential, selected prototype header with criteria bars, stepper with checks, one panel per stage (primary action, output, Open chat, asked X ago, Refresh now, Mark done, Advance).
- "Send to Factory" (from a report or the inbox) creates `P<seq>-<ABBR>`, the idea at pre-validation, its chat titled `<id> | <title>`, files the chat in the Roblox Radar group, queues the memory event, shows "Created ... and its chat" with an Open chat button, and opens the chat beside the panel (`AUTO_OPEN_CHAT_ON_SEND`).
- Chat is no longer a tab: "Open chat" button on each stage or prototype. The batch "create chats for all ideas" is gone.
- Template match: Find 3 reference games, Reverse-engineering packet, Register research, Build template doc, plus the library picker (`template_mode`).
- Titles and thumbnail prompts: every generation kept, "Mark as chosen", "Discard", "Generate 5 more" (passes the previous angles).
- Advance runs the principles gate in the chat first. PASS and PASS WITH RISKS advance on their own; BLOCK needs an override.
- Potential score from `data/scoring.json`; `safety` is a gate.
- Tagged output protocol (chat to panel), outputs stored per prototype with the skill file versions that were present, persisted through the Drive memory outbox.
- Skills moved to Drive (`roblox_radar_skills`). No skill text in the mod.
- Header status collapsed to one dot line. The old live-task warning line in the header is gone: a live-task problem shows only inside the Tasks tab, in one short line.
- `skipped_cost` now shows as stale.
- Stage data: `group` and `default_tab` added to `data/stages.json`; the `registro` stage removed.
- Store migration (key `rr1`, backward compatible), unit tests with `node:test`.

### Decisions taken

- Base: local 0.6.7 and GitHub main (0.6.8) have identical code (only the version string differs), so work started from origin main. No separate "snapshot of local 0.6.7" commit was needed. The working copy is `C:\Users\lucas\Documents\GitHub\roblox_radar`; the installed plugin folder was not touched.
- Folder names: the new UI files live in `hooks/ui/` (not `hooks/views/`) because `views/` next to `views.tsx` makes the import `./views` ambiguous. The Factory orchestration stays inside `register.tsx` because it shares private helpers with the chat code.
- ABBR: first significant word (stop words like the, a, of are skipped), uppercase letters only, max 7. On collision the initial of the second word is appended; if still taken, a number.
- Chat auto-open after "Send to Factory": on.
- Weights: demand 14, timing 12, whitespace 12, clickability 14, virality 12, social_coplay 10, core_loop 8, retention 8, feasibility 6, monetization 4. Overall = weighted average over the criteria that have a score (a missing criterion does not count as zero); the header shows "n/10 criteria scored".
- Migration: ideas with a proto_id become prototypes with new IDs in creation order (old value in `legacyProtoId`); rejected ideas also get an ID and stay archived; the rest go to the inbox and keep their chat link and memory, which travel with them when sent. The Radar seed ideas now go to the inbox.
- Existing chats are renamed to the new title with `set_session_title` when the app allows it (on send, on Open chat, and when the ABBR changes).
- Stage order unchanged. A prototype can open any stage view; actions are enabled only for stages it has reached.
- Overall percentage, never from the chat. Gate: PASS and PASS WITH RISKS advance by themselves; BLOCK and a low safety score need Lucas to confirm.
- `list_events` returns a plain-text transcript (not JSON) limited by message count, so the panel reads 120 events instead of 40. An unterminated `@@OUTPUT` is read from the Drive file `<proto_id>_<stage>_<gen>.md` (folder `roblox_radar_protos`), which the prompt asks the chat to write for long outputs.
- Inbox ideas are not written to the Drive memory outbox (only prototypes are), so a reinstall restores prototypes but not the inbox.
- The panel could not be run here (no screenshots, the host test runner is not available): UI was checked by typecheck against a loose stub, unit tests of the pure modules, and reading the code.
