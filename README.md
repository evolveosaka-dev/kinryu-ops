# Kinryu Ops — 朝礼記録・店舗巡回チェック

Mobile-first web app for the staff of 金龍ラーメン 御堂筋店・千日前店 (Avecvous Evolve Ltd.):
shift-start meeting records (朝礼記録) and store patrol checks (巡回チェック).

- Vite + React + TypeScript + Tailwind, HashRouter, PWA — hosted on GitHub Pages
- Supabase (Postgres + Auth + Row Level Security) — all data is protected by RLS
- Locales: ja (source), en, vi, si, ne

Internal spec (`CLAUDE.md`) is kept outside this public repository. Setup guide (Vietnamese): [`docs/SETUP_vi.md`](docs/SETUP_vi.md).

```bash
npm install
cp .env.example .env.local   # fill VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
npm run dev
npm test                     # unit + SQL/RLS tests (PGlite, no Docker needed)
npm run lint && npm run typecheck && npm run i18n:check
```
