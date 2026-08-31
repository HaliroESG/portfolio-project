## Objet

Correction minimale de gouvernance après la revue indépendante `FAIL / FIX_FIRST` de PR14. Cette PR brouillon ne modifie pas le code fonctionnel Family Office de PR12/PR14 et n'autorise aucune mutation Production.

## Changements

- hold ACTIVE lié au head/tree/merge exacts de PR14, imposé avant toute autorisation et conservant HTTP 503 ;
- contextes `Family Office / validate`, `Family Office / prepare` et `Trident / validate` disponibles sur toute PR, avec prepare non-skippable ;
- contexte repository-native `ASTROCYTE Independent Review`, issu uniquement d'une review GitHub native humaine, indépendante et liée au head exact ;
- contrat de protection `main` versionné mais explicitement non configuré, avec source-app GitHub Actions obligatoire à l'activation ;
- heartbeat planifié en historique complet pour le pin PR12 ;
- paquet PR14 rescellé sur `bd1bd273` / tree `074b71df` / merge `a3d07b1d` et CI réellement terminées.

## Frontières

- aucun provider/runtime/web, Supabase, Vercel, Preview, secret/configuration GitHub, migration, dispatch, déploiement, activation, rollback ou merge ;
- aucune auto-approbation, aucun label/comment de confiance ;
- le workflow `pull_request_target` ajouté ici ne peut pas attester sa propre PR d'introduction. Une revue indépendante manuelle du head final reste obligatoire avant toute décision de merge ;
- le hold reste fermé et les commandes Production restent HTTP 503.

## Validation locale

- 55 tests `.github` PASS, dont 17 adversariaux ;
- Actionlint 1.7.7 checksum-pinné PASS ; parité 12 workflows PASS ;
- backend 144 tests PASS ; frontend lint, TypeScript, contrat et build Webpack PASS ;
- préflight PostgreSQL 15 et refus hold sous Python `-I -S` PASS ;
- scan sécurité `90745dec-1315-4340-9362-469e61c695b5`, zéro finding, delta exact-code documenté.

Le détail scellé est sous `output/astrocyte-runs/PR14-GOVERNANCE-CORRECTION-V1/`.

## Revue demandée

Revue indépendante, read-only, du head exact de cette PR brouillon. Ne pas merger.
