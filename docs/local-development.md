# Локальная разработка

## Demo mode без Docker

```bash
npm install
cp .env.example .env
npm run dev
```

Откройте `http://localhost:5173` на компьютере. Для телефона камера требует HTTPS: запустите `VITE_HTTPS=true npm run dev` и откройте `https://<MAC-LAN-IP>:5173`. Vite создаст локальный сертификат; на телефоне один раз подтвердите предупреждение о локальном сертификате. Команда поднимает Vite на всех сетевых интерфейсах, а оба клиента ходят в API через относительный `/api`; отдельный API-адрес в браузере не нужен. Демо-вход: `admin` / `admin`. Демо-данные сохраняются в `data/openboots.db`, а production-секреты в этот режим не попадают.

Проверки:

```bash
npm run build
npm test
npm run lint
```

Backend по умолчанию использует порт `3001`, чтобы не конфликтовать с частыми локальными сервисами на `3000`. Для production build используйте `npm run build` и `PORT=3001 npm run start`; это единый origin без Vite proxy. Для HTTPS staging используйте `docker compose -f docker-compose.https.demo.yml up -d --build` с доменом и DNS, описанными в [deployment](deployment.md).

## InvenTree + PostgreSQL локально

В репозитории есть локальный Compose-профиль с PostgreSQL 17, Redis, InvenTree server и worker. Для запуска:

```bash
cp .env.inventree.example .env.inventree
# при необходимости измените локальные пароли в .env.inventree
docker compose --env-file .env.inventree -f docker-compose.inventree.local.yml up -d
docker compose --env-file .env.inventree -f docker-compose.inventree.local.yml exec inventree-server invoke update
```

InvenTree API будет доступен на `http://localhost:8091`. Создайте API token в InvenTree и задайте в OpenBoots:

```bash
CORE_MODE=inventree
INVENTREE_BASE_URL=http://localhost:8091
INVENTREE_TOKEN=token-kept-outside-the-repository
```

Для локальной разработки безопаснее хранить token в отдельном файле и использовать `INVENTREE_TOKEN_FILE`. В проверенном стенде BFF работает через официальный Caddy InvenTree на `http://localhost:8090`; Compose-профиль выше использует прямой API-порт `8091`.

В production BFF должен быть единственным клиентом InvenTree со стороны браузера. Остатки, stock transactions, locations, customers и sales orders в режиме `inventree` читаются и изменяются через InvenTree REST API; SQLite хранит только BFF-сессии, idempotency и контекст источника заказа.
