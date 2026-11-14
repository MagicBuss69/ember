# Ember visual & reward plan

## Visual direction

- **Palette:** Warm charcoal base (`#100e0c`), elevated surfaces with subtle amber edge light, accent ember orange (`#ff8a3d`) → gold (`#ffc089`), crystal mint for economy (`#6ee0c5`). Theme variants (pine/frost/ink) keep structure; only hue shifts.
- **Typography:** Outfit for UI; Fraunces for level numbers, deltas, and celebration headlines. Tight display tracking on hero numbers.
- **Depth & glow:** Cards use 1px hairline borders + soft outer glow on accent elements (rings, full-day progress, rival lead). No box-shadow spam — one shadow token for sheets/modals.
- **Ember motif:** Radial accent bloom behind Today hero; brand dot as live ember; streak line gets animated flame tiers; section-cleared states use a small ember burst glyph.
- **Iconography:** Existing inline SVG set; chevrons on done drawers; checkmarks stay square-rounded for game feel.
- **Dark polish:** `color-scheme: dark`; sunken wells for progress troughs; nav bar frosted with accent tint on active tab.

## Reward loop

| Moment | Feedback |
|--------|----------|
| Quest check-off | Checkbox tick scale, quest settle, GPU particle burst at checkbox, optional sine blip, haptic tick, `+25 XP` floater |
| Combo (≤4s between checks) | Combo counter on floater (`×2 combo`…) |
| Level up | Modal, sparks, medallion, crystal award line, level haptic pattern, level chime |
| Streak | Flame icon; CSS pulse from day 2+; crystal toasts unchanged |
| Crystals | Gem shine on HUD when balance rises |
| Daily complete | Ring already pulses; center-screen confetti + toast when last quest of the day completes |
| Progress | SVG ring + level bar scaleX; pulse classes on gain |
| Rivals | Dual race tracks with you/ghost markers; tone-colored hero delta |

## Motion rules

- **GPU only:** `transform` and `opacity` on animated elements; `will-change` only during animation.
- **Reduced motion:** `prefers-reduced-motion` cuts durations; particles/confetti skipped; collapse becomes instant hide.
- **No libraries:** Canvas/DOM particles as positioned divs; Web Audio API for optional sounds (default **off**).

## Completed-quest UX

- When not in **Reorder** mode, done quests collapse out of the active list after a short collapse animation.
- Each slot shows **Done (N)** (or **Section cleared** when N = all quests in slot); tap to expand and undo.
- Expanded state persisted in `settings.doneSlotsOpen` keyed by `d|{date}|{slot}`.
- Same behavior on Today, Week day, and Calendar day views. Template view unchanged (no done state).

## Implementation map

- `src/styles.css` — tokens, glow, done drawer, section cleared, rival markers, streak heat, FX particles, daily banner.
- `src/ui/fx.js` — particle burst, confetti, helpers.
- `src/ui/bits.js` — slot splitting, done drawer, section cleared.
- `src/main.js` — combo timing, collapse choreography, FX hooks, drawer toggle action.
- `src/domain.js` / `src/backup.js` — `doneSlotsOpen`, `sound` default false.
- Screens — pass `doneSlotsOpen`; rivals race markers; streak heat classes.