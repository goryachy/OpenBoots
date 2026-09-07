# Интеграция с Viber

OpenBoots реализует безопасный `ViberAdapter` boundary. Preview доступен всегда и требует `salePrice`; пользователь может отредактировать текст, скопировать его и открыть Viber deep link.

Автопубликация включается только с официальным Viber bot token и subscribed receiver ID:

```bash
VIBER_BOT_TOKEN=...
VIBER_RECEIVER_ID=...
```

Текущий endpoint использует официальный `send_message`. Если переменные не заданы, если target не настроен или API вернул ошибку, BFF возвращает `fallback: true`; пользователь не теряет подготовленный текст. Логин в личный Viber, browser automation и рассылка в неофициальные группы не используются.

Важное ограничение официальной модели: bot должен быть создан на коммерческих условиях, а `send_message` работает с subscribed user ID. Поэтому для обычного рабочего чата/группы может потребоваться отдельный официальный Viber Business setup; до его появления fallback — штатный режим.
