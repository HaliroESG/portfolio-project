# Release Checklist (Schema + Data + UI)

## SQL verify
- [ ] Objets/colonnes: `market_watch`, `etl_runs`, colonnes techniques présentes
- [ ] RLS/policies/grants lecture anon/authenticated validés
- [ ] `max(last_update)` market récent

## Smoke Supabase (anon)
- [ ] `cd frontend && npm run smoke:supabase`
- [ ] market_watch OK (colonnes techniques lisibles)
- [ ] currencies / valuation_snapshots / news_feed / etl_runs OK

## UI smoke
- [ ] `/` charge sans silence (state explicite)
- [ ] `/geo` charge sans crash
- [ ] `/fx` charge + état explicite
- [ ] DataHealthPanel montre freshness + null-rate + ETL runs

## Build/quality
- [ ] `npm run contract-check`
- [ ] `npm run lint`
- [ ] `npm run build`
