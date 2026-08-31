## Objet

Correction minimale de gouvernance après la revue indépendante `FAIL / FIX_FIRST` de PR14. Cette PR brouillon ne modifie pas le code fonctionnel Family Office de PR12/PR14 et n'autorise aucune mutation Production.

## Changements

- hold ACTIVE lié au head/tree/merge exacts de PR14, imposé avant toute autorisation et conservant HTTP 503 ;
- contextes `Family Office / validate`, `Family Office / prepare` et `Trident / validate` disponibles sur toute PR, avec prepare non-skippable ;
- contexte repository-native `ASTROCYTE Independent Review`, issu uniquement d'une review GitHub native humaine, indépendante et liée au head exact ;
- contrat de protection `main` versionné mais explicitement non configuré, avec source-app GitHub Actions obligatoire à l'activation ;
- heartbeat planifié en historique complet pour le pin PR12 ;
- configuration Git statique Vercel aux deux racines possibles, limitée aux branches `codex/*governance*`, afin d'empêcher de nouvelles Previews pour les seuls changements de gouvernance ;
- paquet PR14 rescellé sur `bd1bd273` / tree `074b71df` / merge `a3d07b1d` et CI réellement terminées.

## Frontières

- deux Previews Vercel automatiques (`frontend` et `quant-terminal-ui`) ont été créées sur le head antérieur par l'intégration Git ; aucune n'a été appelée, ouverte, promue ou déployée en Production par l'agent ;
- aucun accès provider/runtime, Supabase, secret/configuration GitHub, migration, dispatch, déploiement Production, activation, rollback ou merge ;
- la configuration Vercel ajoutée est statique, versionnée et limitée aux branches `codex/*governance*`; les branches non spécifiées conservent le comportement par défaut ;
- aucune auto-approbation, aucun label/comment de confiance ;
- le workflow `pull_request_target` ajouté ici ne peut pas attester sa propre PR d'introduction. Une revue indépendante manuelle du head final reste obligatoire avant toute décision de merge ;
- le hold reste fermé et les commandes Production restent HTTP 503.

## Validation locale

- 56 tests `.github` PASS, dont 18 ciblant directement la gouvernance PR14/PR15 ;
- Actionlint 1.7.7 checksum-pinné PASS ; parité 12 workflows PASS ;
- backend 144 tests PASS ; frontend lint, TypeScript, contrat et build Webpack PASS ;
- préflight PostgreSQL 15 et refus hold sous Python `-I -S` PASS ;
- scan sécurité initial `90745dec-1315-4340-9362-469e61c695b5`, zéro finding ; le delta Vercel doit recevoir une nouvelle revue sécurité exacte avant fusion.

Le détail scellé est sous `output/astrocyte-runs/PR14-GOVERNANCE-CORRECTION-V1/`.

## Revue demandée

Revue indépendante, read-only, du nouveau head exact de cette PR brouillon, incluant la preuve d'absence de nouveau déploiement Vercel sur le commit correctif. Ne pas merger sans autorité explicite.
