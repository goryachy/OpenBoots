# OpenBoots Architecture Contract

## Objective

Deliver a small mobile-first PWA for barcode-led receiving, stock lookup, transfers, customer orders, price-free delivery notes, reviewed OCR product creation, internal labels, movement history, and Viber publication preparation.

## Scope and non-goals

Production inventory authority is InvenTree through a server-side BFF. PostgreSQL and persistent media belong to the InvenTree deployment. The browser never receives InvenTree credentials. The MVP does not include accounting, CRM pipelines, payments, marketplaces, WooCommerce, or unofficial Viber automation.

## Actors and permissions

Authenticated operator: search products, scan, receive, transfer, create drafts, confirm sales, generate documents, preview/copy Viber text. Administrator: manage locations and integration configuration through InvenTree. The BFF enforces authentication and validates all input; production authorization is delegated to InvenTree permissions and the demo adapter has an equivalent operator role.

## Core workflows

- Scan: normalized camera, native `BarcodeDetector`, keyboard/HID, and manual input all produce the same barcode command.
- Receive: a persisted session has one destination location; every scan increments one unit; explicit quantity adds N units; undo removes only the latest uncommitted event.
- Unknown barcode: present create or link; linking adds an alias to an existing product and never creates a duplicate.
- Transfer: persisted draft records source/destination and line quantities; confirmation is one inventory-core operation and rejects insufficient stock.
- Sale: persisted DRAFT order; scans add lines without stock mutation; CONFIRMED validates current stock and deducts atomically; CANCELLED is terminal. Confirmation accepts an idempotency key and returns the same result for a retry.
- Delivery note: generated only for a confirmed order, with customer, products, quantities, date and number; no price fields or price values are rendered.
- OCR: image/text recognition is assistive; parser produces confidence hints and editable fields; save requires the product form submission.
- Viber: preview and editable message always work; official publishing is attempted only when configured. Otherwise the user gets copy/open fallback. Personal-account automation is prohibited.
- Count: scan physical quantities into a separate draft, compare against expected, and apply adjustments only after explicit confirmation.

## Data and failure model

The BFF stores workflow drafts, idempotency records, audit/movement records, and demo data in a persistent local database for demo mode. In production, product/stock/customer/order state is delegated to InvenTree; BFF workflow records contain only orchestration metadata and external IDs. Client state is disposable and never authoritative. Failed network calls leave a draft open, display a safe Russian message, and permit retry. A timeout on confirm is treated as unknown until the idempotency-key retry/readback resolves it.

Inventory operations use adapter-level transactions / InvenTree stock operations. Demo mode serializes mutations in a database transaction. Concurrent confirms re-read stock under the transaction; negative stock is impossible. Duplicate confirm and duplicate transfer requests are idempotent.

## Integration boundaries

`InventoryCore` abstracts product, location, stock, customer, order, movement, report and label operations. `InvenTreeInventoryCore` calls the documented REST endpoints and maps responses; `DemoInventoryCore` is intentionally local-only and is selected explicitly. `ViberAdapter` has an official API implementation boundary and a copy/open fallback. OCR is exposed through `OcrService` and its deterministic parser is independently testable.

## UX decisions

The home screen makes SCAN primary and keeps all main actions within one tap. Mobile layout uses large controls, bottom navigation, camera-first scanner, safe error messages, and no desktop-only tables. Unfinished receiving/transfer/order drafts survive refresh and are resumable; stale drafts can be cancelled by the operator.

## Acceptance criteria

1. Authenticated mobile UI loads with SCAN as primary action.
2. Camera/keyboard/manual barcode inputs normalize to one scan command.
3. Known barcode lookup returns one product without duplication.
4. Unknown barcode offers CREATE PRODUCT and LINK TO EXISTING PRODUCT.
5. Repeated receive scans increment by one; explicit bulk quantity increments by N.
6. Receive location is selected once and latest scan can be undone before session commit.
7. Products support brand, model/article, color, structured size run, pairs per box, decimal price, aliases, note and optional photo metadata.
8. Stock is displayed by arbitrary location with total and in-stock filter.
9. Transfer confirmation atomically decreases source and increases destination and rejects insufficient stock.
10. Orders remain DRAFT while scanning and do not mutate stock.
11. Sale confirmation atomically validates/deducts stock and is safe under duplicate requests/concurrent attempts.
12. Customer can be searched by phone and recent orders are shown.
13. Delivery note is available for open/print/share and contains no price.
14. OCR/photo input yields editable pre-filled fields; partial/bad OCR is safe and save is explicit.
15. Viber preview contains mandatory decimal price; unavailable official publish produces copy/open fallback.
16. Internal Code 128 barcode labels are printable.
17. Movement history shows date, operation, quantity and location.
18. Inventory count compares expected vs actual and applies adjustments only after review.
19. Server validation, authenticated sessions, safe errors, rate limiting, no browser InvenTree secrets, and no raw technical errors are present.
20. Local install/build/test/deployment/backup instructions are reproducible and no secret/build artifact is tracked.

## Verification strategy

Vitest tests cover adapter/domain/API workflows, idempotency, concurrency, document redaction, OCR parsing and Viber fallback. Playwright smoke tests cover mobile viewport flows against the demo core when the browser is available. Build/typecheck/lint are mandatory. Real InvenTree proof-of-concept is documented as an environment-dependent check and must be run when `INVENTREE_BASE_URL` is configured.

## Known limits

The repository cannot run InvenTree locally until Docker or an external InvenTree instance is available. The production adapter therefore remains configuration-dependent, while the demo adapter makes all core workflows testable. Native camera/OCR quality still requires real-device validation under HTTPS; the app includes manual/keyboard fallbacks.
