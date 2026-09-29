# Арена переговоров

Интерактивный симулятор развития навыков переговоров — хакатон-проект (ТЗ: «Алабуга», «Симулятор развития навыков переговоров "Арена переговоров"», 2026).

Полное описание продукта, архитектуры и логики симуляции (включая ветвление сценариев) — в [`DOCUMENTATION.md`](./DOCUMENTATION.md). Этот файл — только быстрый старт.

## Быстрый старт (локальный запуск)

Понадобится Node.js 20+ и Docker (для базы данных; вместо Docker можно указать любой другой PostgreSQL в `DATABASE_URL`).

```bash
# 1. Зависимости (postinstall сам вызовет `prisma generate` — Prisma Client не нужно генерировать отдельно)
npm install

# 2. База данных (Postgres в Docker)
docker compose -f docker-compose-pg.yml up -d

# 3. Переменные окружения
cp .env.example .env
# GROQ_API_KEY не обязателен — без него (или при MOCK_LLM="true") движок работает
# полностью офлайн на детерминированных fallback-заглушках, ничего не ломается.

# 4. Схема БД и демо-данные
npx prisma migrate deploy
npx prisma db seed

# 5. Запуск
npm run dev
```

Приложение — на [http://localhost:3000](http://localhost:3000), админка — на `/admin`.

## База данных

Приложению нужна PostgreSQL — без неё API-роуты и админка не заработают.

Проще всего поднять её в Docker-контейнере: в репозитории есть готовый пример —
[`docker-compose-pg.yml`](./docker-compose-pg.yml) (Postgres 16, порт 5432, реквизиты
`postgres`/`postgres`/`simulator_ap` — совпадают со строкой подключения по умолчанию в
`.env.example`).

```bash
docker compose -f docker-compose-pg.yml up -d
```

Дальше на поднятую базу накатываются миграции Prisma — они создают таблицы по схеме
[`prisma/schema.prisma`](./prisma/schema.prisma):

```bash
npx prisma migrate deploy
```

Строка подключения — ключ `DATABASE_URL` — прописывается в `.env` (скопируйте `.env.example` →
`.env`, см. шаг 3 быстрого старта выше). Если используете `docker-compose-pg.yml` как есть, менять
её не нужно — значение по умолчанию уже на него указывает. Если вместо Docker поднимаете свою или
внешнюю PostgreSQL — впишите в `DATABASE_URL` её реальные адрес/логин/пароль/имя базы.

## Тесты и проверки

```bash
npm run test       # vitest, юнит + интеграционные тесты движка и API
npx tsc --noEmit    # типы
npm run lint        # eslint
npm run build       # прод-сборка
```

## Структура

- `app/` — Next.js App Router: страницы (`/`, `/scenario/[id]`, `/play/[sessionId]`, `/admin`) и API-роуты
- `lib/engine/` — детерминированный игровой движок (состояние, правила, переходы включая ветвление сценариев, оценка) — без обращений к БД или LLM
- `lib/llm/` — промпты и клиент для LLM (Groq) с fallback-режимом на каждую функцию
- `prisma/` — схема БД, миграции, сид демо-сценариев (оба сценария с ветвлением)
- `.github/workflows/ci.yml` — CI: типы, линтер, тесты, прод-сборка на каждый push и PR
- `avatar-video/` — отдельный Remotion-проект для рендера видео-аватара оппонента (не часть основного приложения, использовался офлайн для генерации `public/avatar/*.mp4`)

## CI

Каждый push и PR в `main` проверяется в GitHub Actions (`.github/workflows/ci.yml`): `tsc --noEmit`, `eslint`, `vitest`, `next build` — четырьмя параллельными джобами. Секреты/внешние сервисы для CI не нужны: сборка не требует поднятой БД (см. `DOCUMENTATION.md`, раздел 8), а тесты работают на замоканном `MOCK_LLM=true`.
