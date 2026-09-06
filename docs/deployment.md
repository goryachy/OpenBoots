# Production deployment

Рекомендуемая первая production-схема — один небольшой Linux VPS с Docker Compose: InvenTree, PostgreSQL, Redis, worker и Caddy по официальному compose-набору InvenTree; OpenBoots BFF можно запустить как отдельный Node service за тем же reverse proxy. Это проще и надёжнее для постоянного PostgreSQL и файлов media, чем бесплатный serverless tier со сном и эфемерным диском.

1. Получите домен и направьте DNS на VPS.
2. Скачайте stable compose-файлы InvenTree из `contrib/container` и задайте сильные `INVENTREE_DB_PASSWORD`, `INVENTREE_SITE_URL=https://inventory.example.com`, `INVENTREE_EXT_VOLUME`.
3. Выполните миграцию и создайте admin через команды из `docs/local-development.md`.
4. В InvenTree создайте API token с минимальными нужными permissions.
5. Запустите BFF с environment variables из `.env` менеджера процесса:

```bash
NODE_ENV=production CORE_MODE=inventree PORT=3000 npm run start
```

6. Отдайте frontend через `npm run build` и reverse proxy `/api` на BFF. HTTPS обязателен для camera API; Caddy в официальном InvenTree stack умеет automatic HTTPS при доступных 80/443.
7. Не публикуйте `INVENTREE_TOKEN`, `JWT_SECRET`, Viber token или DB password в Git, browser bundle, issue или логах.

Обязательные переменные OpenBoots:

| Variable | Purpose |
|---|---|
| `NODE_ENV` | `production` включает secure cookies |
| `JWT_SECRET` | длинный случайный секрет session signing |
| `CORE_MODE` | `demo` только local/CI; `inventree` production boundary |
| `INVENTREE_BASE_URL` | URL InvenTree |
| `INVENTREE_TOKEN` | server-only API token |
| `VIBER_BOT_TOKEN` | optional official Viber bot token |
| `VIBER_RECEIVER_ID` | optional subscribed receiver ID |
| `VIBER_API_URL` | optional, default official send_message endpoint |

Для first launch обязательно смените demo admin credentials или отключите demo mode.
