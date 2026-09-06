# Чеклист мобильной проверки

Открыть приложение по HTTPS на телефоне, установить PWA на Home Screen, войти, открыть SCAN и проверить:

1. Разрешение камеры и видимый scan frame.
2. EAN-13 / Code 128 из реальной коробки; повторный scan не дублирует товар.
3. Приёмка: выбрать location один раз, 20 scans дают +20, ADD QUANTITY работает, отмена убирает последний event.
4. Неизвестный код даёт CREATE PRODUCT и LINK TO EXISTING; OCR открывает камеру, заполняет подсказки, но сохраняет только после редактируемой формы.
5. Остаток показывает location rows и total; transfer требует разные места и подтверждение.
6. NEW ORDER: customer name/phone, source location, scans, draft, confirm, повторное нажатие не списывает второй раз.
7. PDF открывается из браузера и системно шарится; цены в нём отсутствуют.
8. Product detail → Viber preview: price есть, текст можно изменить/скопировать; без official config отображается fallback.
9. Product detail → label открывает printable Code 128 page.

Если камера или OCR недоступны, ручной ввод и Bluetooth HID должны оставаться рабочими; обычное сканирование не должно зависеть от OCR.
