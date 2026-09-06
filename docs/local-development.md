# Локальная разработка

## Demo mode без Docker

```bash
npm install
cp .env.example .env
npm run dev
```

Откройте `http://localhost:5173`. Демо-вход: `admin` / `admin`. Демо-данные сохраняются в `data/openboots.db`, а production-секреты в этот режим не попадают.

Проверки:

```bash
npm run build
npm test
npm run lint
```

Если порт 3000 занят, запустите `PORT=3001 npm run start` и откройте `http://localhost:3001` после `npm run build`.

## InvenTree локально

На текущей машине Docker не установлен, поэтому live InvenTree proof-of-concept здесь не запускался. Для него установите Docker Desktop, скачайте официальный production compose-набор InvenTree (`docker-compose.yml`, `.env`, `Caddyfile`) и выполните `docker compose run --rm inventree-server invoke update`, затем `docker compose run inventree-server invoke superuser`, затем `docker compose up -d`. После создания API token задайте в OpenBoots:

```bash
CORE_MODE=inventree
INVENTREE_BASE_URL=https://inventree.example.com
INVENTREE_TOKEN=token-kept-outside-the-repository
```

В production BFF должен быть единственным клиентом InvenTree со стороны браузера. Demo mode предназначен для разработки и CI, а не для warehouse production.
