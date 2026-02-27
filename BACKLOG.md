# Product Backlog - Portfolio Project

Last update: 2026-02-27

## État backlog vs réel (PR-1..PR-4)

- BL-001 Technical indicators completeness: **IN_PROGRESS** (UI states + types + stats OK; manque parité prod + backfill + preuve non-null).
- BL-002 FX consistency: **DONE (phase 1)** (fallback/states OK).
- BL-003 Single source of truth dashboard: **DONE** (projections explicites, suppression `select('*')`).
- BL-004 Portfolio definition: **DONE (phase 1)**.
- BL-005 Multi-portfolio aggregation: **DONE (phase 1)**.
- BL-006 Geo allocation réelle: **DONE**.
- BL-007 Geo timeframe: **DONE**.
- BL-008 Fetch optimization: **IN_PROGRESS** (projections + SWR unifié OK; manque preuve en prod / métrique).
- BL-009 Data health observability: **IN_PROGRESS** (panel enrichi + stats structurées OK; manque parité prod + lecture ANON prouvée).

---

## P0 — Ops parity + preuves prod (priorité absolue)

### P0-01 — Baseline vérité prod (objets/colonnes/vues/RLS/grants)
- Statut: **IN_PROGRESS**
- Problème: incertitude sur `market_watch` (table vs vue), permissions ANON, drift migrations.
- Scope: data/docs
- Livrable: snapshot SQL prod exécuté + export résultats (docs/artifact).
- Risques/Notes: Hypothèse: accès SQL editor prod/staging.
- Critères d’acceptation: sorties complètes `relkind/relrowsecurity/columns/policies/grants` sur tables clés.
- Dépendances: runbook parité PR-2A.
- Preuve attendue: export SQL + capture résultats + artifact schema-check.

### P0-02 — Parité colonnes techniques `market_watch` (si manquantes)
- Statut: **TODO**
- Problème: `macd_* / rsi_14 / momentum_20 / trend_*` absentes ou non visibles en prod.
- Scope: data/backend
- Livrable: migration appliquée sur l’objet réellement lu (`market_watch`).
- Risques/Notes: si `market_watch` est une vue, fix via `view_definition` (intervention humaine).
- Critères d’acceptation: 7 colonnes techniques présentes dans `information_schema.columns`.
- Dépendances: P0-01.
- Preuve attendue: SQL columns check + `select macd_line, rsi_14 ... limit 1` OK.

### P0-03 — Décision exposition `market_watch` (table vs vue)
- Statut: **TODO**
- Problème: une vue peut masquer colonnes et casser le contrat frontend.
- Scope: data/docs/frontend
- Livrable: décision documentée + action (corriger vue OU standardiser table).
- Risques/Notes: éviter changement frontend si possible.
- Critères d’acceptation: `relkind` stable + `select` colonnes attendues via ANON.
- Dépendances: P0-01.
- Preuve attendue: SQL relkind + (si vue) définition validée + smoke ANON.

### P0-04 — `etl_runs` lisible via ANON (sans fuite sensible)
- Statut: **TODO**
- Problème: `etl_runs` vide côté frontend si grants/RLS bloquent, ou table non alimentée.
- Scope: data/backend/frontend
- Livrable: lecture ANON validée (grants + policies conditionnelles), contenu safe.
- Risques/Notes: `error/stats` potentiellement sensibles; décision table brute vs vue publique.
- Critères d’acceptation: requête ANON `etl_runs` retourne ≥1 ligne après run ETL.
- Dépendances: P0-01.
- Preuve attendue: SQL + section ETL non vide dans DataHealthPanel.

### P0-05 — Run ETL prod de validation + preuve de fraîcheur
- Statut: **TODO**
- Problème: schéma OK ne garantit pas des données fraîches.
- Scope: backend/data/CI
- Livrable: run ETL réussi, `etl_runs` alimentée, `market_watch.last_update` récent.
- Risques/Notes: dépend fournisseurs externes.
- Critères d’acceptation: `max(last_update)` récent + nouvelle entrée `etl_runs` avec `duration_sec`.
- Dépendances: P0-02, P0-04.
- Preuve attendue: logs workflow + SQL recency.

### P0-06 — Pack SQL guardé + runbook incident 5 minutes
- Statut: **TODO**
- Problème: corrections manuelles risquées (drift / RLS).
- Scope: data/docs
- Livrable: pack SQL idempotent + runbook ultra court validé.
- Risques/Notes: ne pas activer RLS si non active.
- Critères d’acceptation: pack appliquable sans casser la lecture existante.
- Dépendances: P0-01.
- Preuve attendue: doc + exécution staging.

---

## P1 — Gating & fiabilité continue

### P1-01 — CI bloquant `contract-check` (PR + main)
- Statut: **IN_PROGRESS**
- Problème: risque de régression projections/types et retour de `select('*')`.
- Scope: CI/frontend
- Livrable: job CI exécutant `npm run contract-check` en mode bloquant.
- Risques/Notes: faible.
- Critères d’acceptation: PR fail si contract-check fail.
- Dépendances: PR-2B.
- Preuve attendue: run CI sur PR.

### P1-02 — CI smoke Supabase via ANON (non-bloquant)
- Statut: **TODO**
- Problème: besoin de preuve continue de lisibilité ANON prod/staging.
- Scope: CI/frontend/data
- Livrable: `smoke:supabase` + job `continue-on-error=true` + artifact.
- Risques/Notes: secrets absents => skip propre obligatoire.
- Critères d’acceptation: artifact produit si secrets présents; skip propre sinon.
- Dépendances: P0-01.
- Preuve attendue: artifact CI + logs.

### P1-03 — Enforcement progressif `schema_check` (flag)
- Statut: **IN_PROGRESS**
- Problème: drift schéma possible sans blocage.
- Scope: CI/backend/docs
- Livrable: mode bloquant main activable (`SCHEMA_CHECK_ENFORCE=true`).
- Risques/Notes: nécessite process de traitement alertes.
- Critères d’acceptation: drift réel échoue job; secrets absents => skip propre.
- Dépendances: PR-2A.
- Preuve attendue: run CI main avec flag.

---

## P2 — Hardening produit/ops

### P2-01 — Hardening exposition publique `etl_runs`
- Statut: **TODO**
- Problème: `error/stats` potentiellement trop verbeux pour ANON.
- Scope: data/frontend/docs
- Livrable: décision + implémentation (vue publique filtrée OU sanitation backend) + frontend aligné si besoin.
- Risques/Notes: trade-off sécurité/observabilité.
- Critères d’acceptation: ANON lit uniquement champs approuvés; DataHealthPanel reste utile.
- Dépendances: P0-04.
- Preuve attendue: SQL + smoke ANON.

### P2-02 — Mesure objective BL-008 (réduction appels Supabase)
- Statut: **TODO**
- Problème: optimisation fetch à prouver quantitativement.
- Scope: frontend/ops
- Livrable: baseline vs post-PR-4 (req/min) + conclusion.
- Risques/Notes: instrumentation à définir.
- Critères d’acceptation: baisse mesurable et reproductible.
- Dépendances: P0 stable.
- Preuve attendue: rapport + capture métrique.

### P2-03 — Tuning SLA DataHealth (7 jours)
- Statut: **IN_PROGRESS**
- Problème: faux positifs staleness/null-rate.
- Scope: frontend/docs
- Livrable: seuils calibrés + doc.
- Risques/Notes: aucune variable sensible côté frontend.
- Critères d’acceptation: 7 jours sans alert fatigue et anomalies réelles détectées.
- Dépendances: P0-05.
- Preuve attendue: snapshots UI + historique smoke.

---

## Release train (R1..R3)

### R1 — Ops Parity Proof
- Contenu: P0-01..P0-06.
- Go/No-Go: go si colonnes tech visibles + `etl_runs` lisible ANON + `max(last_update)` récent + DataHealth non vide.
- Checklist: appliquer pack SQL, run ETL, vérifier preuves SQL, smoke UI `/` `/geo` `/fx`.

### R2 — CI Gating Progressive
- Contenu: P1-01..P1-03.
- Go/No-Go: go si artifacts stables 7 jours et drift maîtrisé.
- Checklist: activer jobs CI, tester fail attendu sur drift simulé, vérifier skip propre sans secrets.

### R3 — Hardening produit/ops
- Contenu: P2-01..P2-03.
- Go/No-Go: go si pas de régression UX et observabilité exploitable.
- Checklist: valider périmètre public, mesurer req/min, calibrer seuils.

---

## Décisions à trancher

- RLS: policies seulement si RLS déjà active vs grants-only si RLS off (recommandation: respecter l’état existant, ne pas activer RLS par défaut).
- `etl_runs` public: table brute vs vue filtrée (recommandation: vue filtrée si `error/stats` sensibles).
- `market_watch` si vue: corriger vue vs pointer table canonique (recommandation: corriger vue si `market_watch` est le contrat exposé).

---

## Mapping BL-001..BL-009

| Backlog | Statut | Preuve | Next action |
|---|---|---|---|
| BL-001 | IN_PROGRESS | UI states + types + stats | Parité prod + backfill + preuve non-null |
| BL-002 | DONE | `/fx` fallback/states | Monitor staleness |
| BL-003 | DONE | projections explicites + no select(*) | CI contract-check bloquant |
| BL-004 | DONE | modèle portefeuille | Tests d’intégration ultérieurs |
| BL-005 | DONE | agrégation multi-PF | Monitor régression |
| BL-006 | DONE | geo allocation | None |
| BL-007 | DONE | timeframe geo | None |
| BL-008 | IN_PROGRESS | SWR unifié + projections | Mesure req/min |
| BL-009 | IN_PROGRESS | DataHealth enrichi + stats ETL | Parité prod + preuve ANON |

---

## Risques P0 (max 5)

- `market_watch` vue incomplète -> mitigation: décision + fix vue + smoke ANON.
- migrations appliquées sur mauvais projet Supabase -> mitigation: snapshot + pack SQL idempotent.
- grants/RLS ANON bloquants -> mitigation: grants SELECT + policies conditionnelles sans activer RLS.
- ETL échoue silencieusement -> mitigation: run manuel + preuve `etl_runs` + logs.
- CI verte sans secrets -> mitigation: skip explicite + artifact obligatoire si secrets présents.
