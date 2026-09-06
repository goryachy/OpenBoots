# OpenBoots

Мобильная PWA для приёмки, поиска остатков, перемещений и лёгких оптовых продаж. Интерфейс рассчитан на сценарий `камера → скан → результат`; desktop поддержан, но primary device — smartphone.

## Быстрый старт

```bash
npm install
cp .env.example .env
npm run dev
```

Откройте `http://localhost:5173`. Демо-вход: `admin` / `admin`.

Production build:

```bash
npm run build
npm run start
```

## Архитектура

React/TypeScript + Vite PWA → Express BFF → `InventoryCore` adapter. `DemoInventoryCore` использует SQLite только для local/CI. Production boundary — `InvenTreeInventoryCore` и InvenTree REST API; browser не получает InvenTree token. InvenTree остаётся authoritative inventory source, PostgreSQL/media принадлежат его deployment.

Основные директории:

```text
src/main.tsx       mobile-first UI and scanner
src/server.js      authenticated BFF routes
src/core.js        inventory workflow and transaction invariants
src/db.js          demo persistence and schema
src/services.js    OCR parser, PDF, labels, Viber adapter
src/tests/         API integration tests
docs/              architecture, run, deployment, backup, mobile, Viber
```

## Проверки

```bash
npm run lint
npm run build
npm test
```

## Важное ограничение

В текущем окружении Docker и браузерная CUA surface недоступны, поэтому live InvenTree и физический мобильный camera/OCR прогон не выполнялись. Для этого есть production integration boundary и пошаговый [mobile QA checklist](docs/mobile-workflows.md). Production deployment, persistent PostgreSQL, HTTPS и backup описаны в [deployment](docs/deployment.md) и [backup](docs/backup-and-restore.md).
