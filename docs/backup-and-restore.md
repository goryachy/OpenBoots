# Backup и restore

## InvenTree production

Бэкап должен охватывать PostgreSQL и весь внешний volume InvenTree (media, static, generated reports, Caddy state). Минимальная ежедневная процедура:

```bash
docker compose exec inventree-db pg_dump -U "$INVENTREE_DB_USER" -d "$INVENTREE_DB_NAME" -Fc > backups/inventree-$(date +%F).dump
tar -czf backups/inventree-files-$(date +%F).tgz "$INVENTREE_EXT_VOLUME"
```

Храните копии вне VPS и периодически проверяйте restore на отдельной машине. Официальный InvenTree stack также поддерживает `invoke export-records` для переносимого JSON-экспорта; это дополнительный слой, а не замена бинарному backup PostgreSQL.

Restore:

```bash
docker compose down
tar -xzf backups/inventree-files-YYYY-MM-DD.tgz -C /
docker compose up -d inventree-db
docker compose exec -T inventree-db pg_restore -U "$INVENTREE_DB_USER" -d "$INVENTREE_DB_NAME" --clean --if-exists < backups/inventree-YYYY-MM-DD.dump
docker compose up -d
```

Проверьте `/api/system/health/`, login, locations, stock и PDF после восстановления до открытия склада.

## Demo mode

Остановите BFF, скопируйте `data/openboots.db` вместе с `data/` в защищённое хранилище и восстановите файл перед стартом. Demo DB не является production inventory authority.
