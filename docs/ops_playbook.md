# Ops Playbook (Portfolio Project)

## 1) etl_runs vide
### Symptômes
- DataHealthPanel: ETL section vide
- `smoke:supabase`: etl_runs row_count = 0

### Checks
1. Vérifier exécution GitHub Action `Financial Data Sync`
2. Vérifier table + grants/policies (`etl_runs`)
3. Vérifier secrets backend (`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`)

### Actions
- Lancer le workflow manuellement
- Vérifier que `bridge.py` écrit RUNNING puis SUCCESS/FAILED
- Si RLS actif: policy SELECT anon/authenticated (lecture uniquement)

---

## 2) market_watch stale
### Symptômes
- Freshness market = STALE/MISSING
- `/` et `/geo` montrent données datées

### Checks
- `select max(last_update) from public.market_watch;`
- Logs de `bridge.py` dans Actions

### Actions
- Relancer ETL
- Vérifier provider data (Yahoo/FRED)
- Vérifier `GSHEET_NAME` + credentials Google si sync source KO

---

## 3) null-rate élevé
### Symptômes
- DataHealthPanel null-rate avec ⚠️
- nombreux `INSUFFICIENT_HISTORY`

### Checks
- `market_watch` null coverage sur `rsi_14`, `macd_line`, `momentum_20`
- historique suffisant par ticker

### Actions
- Backfill historique (period plus long)
- vérifier symbol resolution ISIN→ticker
- appliquer migrations techniques si colonnes manquantes

---

## 4) currencies vide
### Symptômes
- `/fx` en EMPTY/STALE
- `currencies` row_count 0

### Checks
- `select count(*) from public.currencies;`
- job ETL `update_currencies()`

### Actions
- relancer ETL
- vérifier accès provider FX
- vérifier grants/policies SELECT si frontend ne lit pas

---

## 5) historical_prices_trident_sync FAILED
### Symptômes
- Data Operations affiche `historical_prices_trident_sync` en CRITICAL/FAILED
- `/trident` peut afficher `NO PRICE HISTORY` pour des tickers qui devraient être couverts

### Checks
- GitHub Actions > `Financial Data Sync` > scope `trident`
- Secret `SUPABASE_SERVICE_KEY` présent et bien service-role/secret, pas anon/publishable
- `etl_runs.error` du dernier job `historical_prices_trident_sync`

### Actions
- Relancer `Financial Data Sync` en manuel avec `scope=trident`, `trident_mode=full`
- Pour backfill complet: renseigner `trident_price_start_date=1999-01-01`
- Ne pas ajouter de policy write publique pour `anon`; les writes historiques doivent rester backend/service-role

---

## 6) technical coverage 0%
### Symptômes
- Data Operations: `Technical Coverage 0/39` ou équivalent
- Colonnes `rsi_14`, `macd_*`, `momentum_20`, `trend_state` nulles dans `market_watch`

### Checks
- `historical_prices` contient assez d'historique pour les tickers du portefeuille
- `bridge_sync` a tourné après le backfill historique
- `backend/technical_state.py` compile et ne renvoie pas d'état silencieux

### Actions
- Relancer d'abord `scope=history`, puis `scope=core`
- Si un actif n'a pas assez d'historique, garder un état explicite `INSUFFICIENT_HISTORY` ou `UNKNOWN`
- Objectif produit: couverture technique >90% ou statut non-calculable visible

---

## 7) macro_indicators stale
### Symptômes
- Source `Macro Indicators` en STALE
- Cockpit marché avec données macro anciennes

### Checks
- `select max(last_update) from public.macro_indicators;`
- Logs du job `macro_sync`
- Accès réseau/provider depuis GitHub Actions

### Actions
- Relancer `Financial Data Sync` avec `scope=core`
- Si le provider est indisponible, laisser l'état STALE visible au frontend

---

## 8) Supabase RLS / grants
### Symptômes
- Smoke Supabase FAIL sur une table attendue
- Frontend affiche schema unreadable ou empty alors que les données existent
- ETL write échoue malgré `SUPABASE_URL` configuré

### Checks
- Distinguer lecture frontend anon et writes backend service-role
- Vérifier que la clé scheduler n'est pas anon/publishable
- Vérifier les grants SELECT anon/authenticated uniquement pour les vues/tables lues par le frontend

### Actions
- Corriger les secrets GitHub/Vercel pour utiliser `SUPABASE_SERVICE_KEY` côté backend
- Ne jamais ouvrir `INSERT`, `UPDATE` ou `UPSERT` public pour contourner un échec ETL
- Si une vue Supabase est ajoutée, préférer `security_invoker=true`

---

## 9) Vercel preview failed
### Symptômes
- Déploiement Vercel rouge ou preview inaccessible
- GitHub status check frontend failed

### Checks
- `npm run lint`
- `npx tsc --noEmit`
- `npm run build`
- Variables `NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### Actions
- Corriger d'abord build/typing localement
- Rejouer `Frontend Runtime Smoke` si les secrets Supabase runtime sont disponibles
- Vérifier absence d'overlay framework et d'overflow mobile sur `/`, `/trident`, `/geo`, `/fx`, `/compare`, `/targets`
