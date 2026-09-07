# Публикация по HTTPS

Рекомендуемая production-схема — один небольшой Linux VPS с Docker Compose: InvenTree, PostgreSQL, Redis, worker и Caddy по официальному compose-набору InvenTree; OpenBoots BFF запускается отдельным Node service за reverse proxy. Это надёжнее serverless-хостинга с эфемерным диском.

## Что уже подготовлено

В репозитории есть HTTPS staging-конфигурация для проверки интерфейса и PWA:

```bash
export OPENBOOTS_DOMAIN=staging.example.com
export JWT_SECRET='replace-with-a-long-random-secret'
docker compose -f docker-compose.https.demo.yml up -d --build
```

Caddy автоматически получает сертификат Let's Encrypt. Для этого DNS-запись домена должна указывать на VPS, а порты 80 и 443 должны быть доступны извне.

Этот compose-файл использует demo SQLite и явно включает `ALLOW_DEMO_PRODUCTION=true`; он предназначен только для staging/приёмочного теста. Его нельзя использовать как боевой склад.

## Production с InvenTree

1. Получите домен и направьте DNS на VPS.
2. Скачайте stable compose-файлы InvenTree из `contrib/container` и задайте сильные `INVENTREE_DB_PASSWORD`, `INVENTREE_SITE_URL=https://inventory.example.com`, `INVENTREE_EXT_VOLUME`.
3. Выполните миграцию и создайте admin через команды из `docs/local-development.md`.
4. В InvenTree создайте API token с минимальными нужными permissions. Для текущего адаптера нужны чтение и изменение parts, stock, locations, customers, sales orders, shipments и stock tracking; на первом развёртывании можно использовать отдельного технического пользователя и затем сузить permissions по журналу 403.
5. Запустите BFF с environment variables из секретного менеджера:

```bash
NODE_ENV=production CORE_MODE=inventree PORT=3001 npm run start
```

6. Отдайте frontend через `npm run build` и reverse proxy `/api` на BFF. HTTPS обязателен для camera API; Caddy умеет automatic HTTPS при доступных 80/443.
7. Не публикуйте `INVENTREE_TOKEN`, `JWT_SECRET`, Viber token или DB password в Git, browser bundle, issue или логах.

Обязательные переменные OpenBoots:

| Переменная | Назначение |
|---|---|
| `NODE_ENV` | `production` включает secure cookies |
| `JWT_SECRET` | длинный случайный секрет подписи сессий |
| `CORE_MODE` | `demo` только local/CI; `inventree` — production boundary |
| `INVENTREE_BASE_URL` | URL InvenTree |
| `INVENTREE_TOKEN` или `INVENTREE_TOKEN_FILE` | API-токен только для сервера |
| `VIBER_BOT_TOKEN` | необязательный токен официального Viber Bot API |
| `VIBER_RECEIVER_ID` | необязательный ID подписанного получателя |
| `VIBER_API_URL` | необязательный URL официального `send_message` |

Важно: live proof-of-concept основных endpoint-ов выполнен на InvenTree 1.5.2: health, locations, parts, barcode lookup/link, stock add/remove/transfer, customers, Sales Order + line + shipment allocation/ship, stock tracking и UAH sale price. Перед production нужно отдельно выполнить приёмку на чистой базе, создать технического пользователя с минимальными правами и проверить ваш реальный домен/HTTPS.
