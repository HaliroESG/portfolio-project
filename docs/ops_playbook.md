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
