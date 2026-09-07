# OpenBoots

Мобильная PWA для приёмки, поиска остатков, перемещений и лёгких оптовых продаж. Интерфейс рассчитан на сценарий `камера → скан → результат`; desktop поддержан, но primary device — smartphone. В интерфейсе есть настройки складов, dropdown брендов и карточки с разбивкой остатка по местам хранения.

## Быстрый старт

```bash
npm install
cp .env.example .env
npm run dev
```

Откройте `http://localhost:5173` на компьютере или `http://<MAC-LAN-IP>:5173` на телефоне. Оба устройства используют один и тот же frontend и API-маршрут `/api`. Демо-вход: `admin` / `admin`.

Production build:

```bash
npm run build
npm run start
```

HTTPS staging через Caddy описан в [инструкции публикации](docs/deployment.md). Для боевого запуска сначала требуется live-подключение InvenTree + PostgreSQL; demo SQLite намеренно защищён от незаметного production-запуска.

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

## InvenTree + PostgreSQL

Режим `CORE_MODE=inventree` подключает BFF к InvenTree REST API: складские остатки не дублируются в SQLite. Проверенный локальный стенд использует InvenTree 1.5.2, PostgreSQL 17, Redis, worker и Caddy; для воспроизводимого запуска используйте `docker-compose.inventree.local.yml` и инструкции в [local development](docs/local-development.md). Для внешней публикации нужен домен/VPS или другой надёжный HTTPS-хостинг; production-схема описана в [deployment](docs/deployment.md).

Физическую камеру телефона и OCR нужно проверить по [mobile QA checklist](docs/mobile-workflows.md); backend-интеграция OCR и ручная проверка полей уже реализованы.
