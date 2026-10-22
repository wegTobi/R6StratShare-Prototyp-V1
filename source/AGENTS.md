# R6 StratShare: Project Rules

## Non-negotiable preservation

- Preserve every working feature, data contract, visual detail, layout, interaction, responsive behavior, and accessibility label unless the user explicitly requests a change.
- Never delete or replace files/directories because they appear unused, empty, duplicated, placeholder-only, or future-facing.
- Protected resources include all media, fallback images, individual icons/portraits, sprite sheets, skeleton modules, `db/`, `drizzle/`, `examples/`, `.agents/`, auth helpers, and planned account/persistence structures.
- Scope edits to the requested behavior. No speculative cleanup, dependency replacement, broad rewrite, or unrelated formatting churn.
- Preserve backward-compatible JSON import/export. New persisted fields must tolerate older JSON without them.
- Treat current code, tests, and assets as authoritative when this file omits implementation detail.

## Product

- Product: English-only Rainbow Six strategy editor/viewer; UI text must target English-speaking users.
- Visual language: R6 Tracker Network-inspired, dark charcoal surfaces, restrained turquoise/green accents, compact operational layout; avoid yellow-led branding, oversized cards, decorative gradients, and marketing-page composition.
- Primary modes in `.side-rail`: Strat Editor and View Strat. No Assets or Export rail tab.
- Preserve established spacing, colors, typography, icon sizing, custom scrollbars/dropdowns, hover states, dialogs, and responsive wrapping.

## Strat Editor invariants

- Top control row contains Map, Floor, Side, Players, Phase, Starts At; controls remain compact, aligned, and visually consistent.
- Map change with entered data uses the site-styled confirmation dialog, then resets the full strat.
- Side change with affected data uses the site-styled dialog; reset operators and gadget plans only; preserve roles and marked positions.
- Role, operators, gadget plan, and notes start empty. Role placeholder: `Set a role...`.
- Gadget placeholder: `Placement, reason, lineups...`; notes placeholder describes the player's overall function.
- Player slots: editable role, up to 3 side-valid operators, gadget plan, notes, and draggable map marker; no user-facing Position field.
- Slot reset `X` clears marker, role, operators, gadget plan, and notes for that slot.
- Operator picker shows 5 columns and 3 visible rows with themed scrolling. Selected operators appear above it and can be removed via a corner `X` on hover.
- A slot marker uses its first selected operator icon; otherwise use its numbered, slot-colored marker. Slot colors remain distinct: turquoise, blue, compatible yellow, then established colors.
- Slot markers keep constant screen size while map zoom changes and remain draggable on their own floor.
- Map viewport remains 16:9. Mouse wheel over it zooms without scrolling the page; zoomed map supports panning; all attached drawings/markers track map transforms.
- Map/floor labels come from `app/map-data.ts`; do not guess unresolved `Layout N` floor names.

## Phases

- A strat has 1-10 phases; default labels are `Phase 1`, `Phase 2`, etc.
- Phase menu supports select, one-click inline rename, add, and hover-revealed corner `X` delete without horizontal scrolling.
- `Starts At` is stored per phase.
- Adding a phase copies the complete current phase state except drawing strokes, which start empty.
- Switching/deleting phases must save and restore the correct independent phase snapshot.

## Drawing

- Drawing mode is available on Attack and Defense via the pencil control at the lower-left map edge.
- Preserve adjustable wide stroke range, compact slider, swatches for white/black/clear red/light green/dark blue, and a visually separate row of currently available slot colors.
- Preserve undo and icon-only eraser. Erasing must not prevent later drawing over the erased area.
- Drawing data is phase- and floor-aware.

## Defense Map Mods

- Map Mods is Defense-only and visually distinct but subdued beside slot tabs.
- Tools/order: Standing Rotation, Crouching Rotation; Vault Rotation, Popped Hatch; Headholes, Footholes; Reinforcement, Shield; Proximity Alarm, Barbed Wire; Observation Blocker, Bulletproof Camera.
- Placed icons have no colored background, grow/shrink with map zoom according to map coordinates, and support direct selection and dragging on their own floor.
- Controls per grouped type: icon + count, clockwise `90` and `45` buttons, then `+` and `-`; preserve current manually tuned horizontal offsets unless explicitly changed.
- Group the placed-item list by modification type. Show icon and count, not long names. At more than 3 groups/items per current behavior, use themed vertical scrolling, auto-scroll to the latest placement, and keep delete `X` clear of the scrollbar.
- Rotation and size are individual per placed marker; deletion targets the selected marker.
- Slot and Map Mod markers from other floors remain visible in a muted grayscale state. Off-floor markers are not draggable until their floor is active.

## View Strat and JSON

- View Strat accepts saved strat JSON and renders the strategy read-only with phase/floor navigation and all visual state.
- Editor JSON details panel contains compact generated JSON + Copy JSON and adjacent paste/load controls; preserve themed scrollbars and spacing.
- JSON must preserve map, floor/layout IDs, side, player count, phases, starts-at values, slots, operator slugs, role, gadget, notes, marker coordinates/floors, drawings, and Map Mod type/coordinates/floor/rotation/size.
- Imported legacy JSON must degrade safely via defaults instead of failing for newly optional fields.

## Assets and data

- Maps: `public/maps/**`; registry/labels: `app/map-data.ts`.
- Operator sprite: `public/operators/operator-icons-sheet.png`, 7x11 cells, 80x80 each; mapping/aliases: `app/operator-data.ts`; renderer: `app/OperatorIcon.tsx`.
- Preserve individual operator fallbacks and future assets in `public/operators/icons/**` and `public/operators/portraits/**`.
- Map Mods sprite: `public/map-mod-icons/map-mods-sheet.png`, 3x4 cells, 80x80 each; preserve all individual PNG/WebP fallbacks in the same directory.
- Drawing eraser: `public/icons/eraser-streamline-solar.svg`.
- Preserve every other file in `public/`, including currently unused starter/media placeholders and `public/og.png`.
- Never rename asset paths or operator/map slugs without migration and fallback handling.

## Architecture and roadmap

- Stack: Vinext/Vite, React 19, TypeScript, pnpm; preserve package manager, lockfile, Cloudflare-compatible output, and `.openai/hosting.json`.
- Main surfaces: `StratAppShell.tsx`, `StratBuilder.tsx`, `StratViewer.tsx`; shared registries/components: `map-data.ts`, `operator-data.ts`, `OperatorIcon.tsx`; styles: `globals.css`.
- Planned Account project is protected scope: retain `app/chatgpt-auth.ts`, `db/`, `drizzle/`, `examples/d1/`, hosting bindings, and empty/skeleton account/persistence structures for later sign-in, user-specific data, and saved strategies. Do not prematurely implement or remove them.
- Authentication identity may use Sites/ChatGPT headers through `app/chatgpt-auth.ts`; do not recreate reserved auth routes.

## Change workflow

- Inspect `git status` before edits; preserve unrelated/user changes.
- Use targeted patches. Show users only changed excerpts/diffs when code display is necessary; never regenerate a whole file for a local edit.
- Prefer existing patterns/helpers; add abstractions only for real duplication or contract safety.
- If a first fix fails, collect the smallest relevant browser/console/test logs before broader changes.
- Validate behavior changes with focused tests in `tests/rendered-html.test.mjs`, then run build. Do not weaken tests to force success.
- Because `.openai/hosting.json` exists, publish validated deployable changes through the existing Sites project unless the user requests local-only work.
- Final response: outcome, validation, deployed URL when applicable; no filler or lengthy recap.
