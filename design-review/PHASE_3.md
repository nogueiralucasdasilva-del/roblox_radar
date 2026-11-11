# Phase 3: header, cards, full screen shell

What changed (looks only, no behavior):
- Header: brand row (`ROBLOX RADAR`, version), status line (click to expand, now as aligned Receipts / Memory / Stages rows), the two mode buttons as one segmented control (Radar, Factory), then Refresh (filled) and More (quiet), then a divider.
- Cards (Radar and Factory share one card): number badge, name, check on done stages, state chip on the right, sub line, detail lines. A thin connector line sits between cards.
- Factory: stages that are not the current one and not done are two-line cards (`COMPACT_CARDS` in `hooks/register.tsx`, set to `false` for full cards).
- Full screen view: Back, previous and next as buttons, numbered stepper as one segmented control, title row, divider.

How to see each state in the app:
1. `/panel`, Radar: header and 3 cards plus the Auditor bar.
2. Click Factory: prototype drop-down, potential, nine stage cards.
3. Click a card: full screen view with the stepper.
4. Click the dot status line: expanded Receipts / Memory / Stages rows.
5. Resize the pane narrow (under 70 columns), medium, wide, and look at each.

Not verified: real colors and spacing on screen. Put screenshots in `design-review/shots/`.
