# R6 StratShare

English-language Rainbow Six strategy editor and read-only JSON viewer.

## Requirements

- Node.js `>=22.13.0`
- pnpm `11.16.0`

## Commands

```bash
pnpm install
pnpm dev
pnpm build
pnpm test
pnpm db:generate
```

## Structure

For Linux/Docker deployment with Cloudflare Tunnel, see [SELFHOSTING.md](./SELFHOSTING.md).
The existing build remains the Sites build; `pnpm run build:selfhost` creates
the independent Node build with accounts disabled.

- `app/`: editor, viewer, data registries, auth helper, styles
- `public/maps/`: map/floor layouts
- `public/operators/`: operator sprites plus protected fallbacks/portraits
- `public/map-mod-icons/`: Map Mods sprite plus protected fallbacks
- `db/`, `drizzle/`, `examples/d1/`: protected account/persistence roadmap
- `.openai/hosting.json`: existing Sites project/bindings

All implementation constraints, preserved behavior, asset references, and roadmap rules are authoritative in [`AGENTS.md`](./AGENTS.md).
