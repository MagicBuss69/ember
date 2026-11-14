# Today screen redesign (System window)

## Goals

- Always show **progress** while scrolling: compact sticky header with day ring, crystal XP fill, rank badge, and quests/time left.
- **Urgency**: “N quests left · HH:MM until midnight” (Stockholm) in System typography.
- **Quest panel**: glassy “Daily Quest” container per theme; penalty quests flagged in red.
- Keep done drawers, reorder, date nav, and 412×915 safe layout (no horizontal overflow).

## Layout

1. **Sticky system header** (`#today-sticky`)
   - Collapsed: rank chip · crystal meter · mini ring · countdown line.
   - Expanded (scroll top): full hero with date nav, streak, system panel stats.
   - `position: sticky; top: 0` inside `main`; condense via `data-compact="true"` from scroll listener.

2. **System daily panel** (below sticky when expanded, or inline in compact)
   - Title: `DAILY QUEST`
   - Sub: quests remaining + time left today.

3. **Slots** unchanged structurally; penalty slot section at top if `isPenaltyQuest`.

## Motion

- Check-off: shard burst → flies toward crystal (transform only).
- Sticky cross-fade between compact/expanded using opacity + scale on crystal only.

## Frost flagship

- Glass panels: `backdrop-filter`, icy border, blue inner glow on sticky header.
- Other themes reuse structure with theme tokens (`--panel-glass`, `--system-glow`).