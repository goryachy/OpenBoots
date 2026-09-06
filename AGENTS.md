# OpenBoots project instructions

## Purpose

OpenBoots is a mobile-first PWA and small BFF for wholesale physical-goods inventory workflows. InvenTree is the production inventory authority; the local demo adapter exists only for development and automated tests when InvenTree is unavailable.

## Stack and commands

- Node.js 20+; TypeScript; React; Vite; Express; Zod.
- `npm install` installs dependencies.
- `npm run dev` starts the local server and Vite client.
- `npm run build` runs TypeScript checking and builds the client.
- `npm test` runs the API and domain tests.
- `npm run lint` runs ESLint.
- `npm run start` serves the production build.

## Runtime boundaries

- `INVENTREE_BASE_URL` enables the production InvenTree adapter. Never expose InvenTree credentials to the browser.
- `CORE_MODE=demo` is for local development and tests only.
- No secrets, database files, OCR images, or build output may be committed.

## Invariants

- Inventory mutations go through the inventory-core adapter, never through client-side counters.
- Receiving defaults to one physical box per scan; bulk quantity is explicit.
- Sales are DRAFT until confirmation; confirmation validates stock again and is idempotent.
- Delivery notes never contain prices; Viber previews do contain the sale price.
- OCR is assistive and never saves without user review.

See `docs/architecture.md` and `docs/local-development.md` for the authoritative product and runtime contract.
