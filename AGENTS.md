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

## Feature integration rule

Never implement a product feature as an isolated UI or backend patch.

Do not interpret the screen, component, or endpoint mentioned by the user as
the implementation scope. It is the entry point for investigation, not
necessarily the boundary of the change. Infer the real product capability being
changed and integrate it consistently throughout the application.

Before modifying the code, determine whether the requested change introduces,
removes, or changes a capability of an existing domain entity or workflow. If
it does, perform an impact analysis across the complete feature lifecycle.

For every affected capability, inspect at minimum:

1. Domain model / types.
2. Database / persistence.
3. API contracts.
4. Backend services.
5. Create flow.
6. Edit flow.
7. View/details flow.
8. Lists, search, and results where applicable.
9. Related workflows using the same entity.
10. Mobile / responsive UI.
11. Validation and error states.
12. Permissions where applicable.
13. Tests.
14. Backward compatibility and existing data.

A feature is not complete merely because it works on the screen explicitly
mentioned in the task.

For example, when product images are introduced, verify image handling in the
create-product, edit-product, product-details, persistence, API,
replacement/removal, existing-product-without-images, and all relevant product
representations flows.

Before implementation, produce an Impact Map that lists the affected domain
entities, screens, APIs, storage, workflows, and tests. After implementation,
perform a Feature Completeness Audit against that map. Do not mark the task
complete while an affected flow remains inconsistent.

See `docs/architecture.md` and `docs/local-development.md` for the authoritative product and runtime contract.
