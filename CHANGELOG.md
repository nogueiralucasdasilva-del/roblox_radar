# Changelog

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
