# L2 — Macro traçable, hors ligne

Date : 2026-10-18. Statut : **implémenté et testé localement, non accepté par revue indépendante, non activé**.

## Portée et architecture

Le flux reste `backend → Supabase → frontend`. Le nouveau contrat `macro-trace/v1` est logique et synthétique : il ne crée aucune table, colonne ou migration, aucun nouveau lecteur Supabase enrichi et aucun producteur activé.

- `backend/macro_contracts.py` prépare des observations et calculs purs à partir d'entrées déjà chargées ; horloge, période attendue, calendrier et unités sont injectés.
- `frontend/types.ts` décrit les mêmes enveloppes. La parité vérifie les sorties Python réelles contre ces types.
- `projectOfflineMacroTrace` sert uniquement les fixtures. Ce garde de présentation n'est pas un validateur de schéma physique ni une source de données runtime.
- `projectLegacyMacro` reste le chemin de l'application : valeur historique consultable, date source/période/unité non attestées. Une collecte récente ou des colonnes ajoutées au cache ne certifient rien.
- Le détail « Source, période et méthode » est ajouté à MacroHealth, avec affichage clavier/mobile. Les cartes neutres ont un contraste lisible ; une carte ouverte occupe deux colonnes.
- `operational_authority=false` et `tactical_usable=false` sont invariants, même pour une fixture VALIDATED. Les régimes et cibles restent en quarantaine.

### Impact attendu, non exécuté sur les systèmes

| Surface | Impact du code candidat | Ce qui n'a pas été fait |
| --- | --- | --- |
| Backend | Contrat pur ; parseur CSV strict partagé ; retrait des doublons et calculs de secours de bridge ; comptage des mises à jour confirmées | Aucun import de bridge/macro_sync ni lancement d'ETL réel |
| Supabase | Aucun changement de schéma ou payload existant ; nouveau contrat non raccordé | Aucune lecture réelle, écriture, migration ou nettoyage historique |
| Frontend | Types macro alignés sur la nullabilité du lecteur actuel ; détails explicites ; aucun nouveau sélecteur | Aucun remplacement d'une donnée historique par une fixture ; aucune recette authentifiée ou déploiement |

## Séries et unités

Le registre est une **convention candidate** de correspondance, pas une attestation du format réel d'un fournisseur ni de ses droits.

| Clé logique | Source / identifiant natif | Unité canonique | Cadence | Propriétaire logique |
| --- | --- | --- | --- | --- |
| VIX / MOVE | YAHOO / ^VIX, ^MOVE | INDEX_POINTS | Quotidienne | macro_sync |
| DXY | YAHOO / DX-Y.NYB | INDEX_POINTS | Quotidienne | macro_sync |
| US10Y | YAHOO / ^TNX | PERCENT | Quotidienne | macro_sync |
| CPIAUCSL / CPILFESL | FRED / même identifiant | INDEX_POINTS | Mensuelle | fred_observations |
| UNRATE | FRED / UNRATE | PERCENT | Mensuelle | fred_observations |
| SPREAD_10Y_2Y | FRED / T10Y2Y | PERCENTAGE_POINTS | Quotidienne | fred_observations |
| T10YIE | FRED / T10YIE | PERCENT | Quotidienne | fred_observations |
| HY_OAS | FRED / BAMLH0A0HYM2 | PERCENTAGE_POINTS | Quotidienne | fred_observations |
| JPYUSD | YAHOO / JPYUSD=X | RATIO | Quotidienne | macro_sync |

Les noms de propriétaires ne prouvent pas l'existence d'un nouveau collecteur actif. JPYUSD n'est pas ajouté à la boucle d'écriture de macro_sync.

Les références L0 ne permettent pas le caractère `^`. L2 encode explicitement `^VIX`, `^MOVE`, `^TNX`, `^FVX` en `yahoo-index:VIX`, etc. pour L0, tout en préservant l'identifiant natif d'origine dans `provider_native_id`. La liaison de source et l'identité de preuve utilisent aussi l'original : une chaîne déjà encodée fournie comme identifiant natif ne peut pas usurper une observation Yahoo. ^FVX est encodable pour diagnostiquer un mauvais proxy, jamais admis comme source T10Y2Y.

Conversions permises et versionnées :

- unité identique → `identity/v1` ;
- RATIO → PERCENT, facteur 100 ;
- BASIS_POINTS → PERCENT ou PERCENTAGE_POINTS, facteur 0,01.

Aucun facteur 10/100 n'est inféré du ticker. Unité absente/incohérente, source ou producteur incohérents : valeur certifiée indisponible, preuve conservée.

PMI reste MISSING (`PMI_SOURCE_USAGE_PERIOD_UNVERIFIED`). PAYEMS reste MISSING (`THOUSANDS_PERSONS_UNIT_NOT_IN_L0_V1`) : l'unité « milliers de personnes » n'existe pas dans L0 v1 et n'est pas déguisée en points d'indice. Une extension séparée de contrat serait nécessaire.

## Dates, cadence et conflits

La date de collecte est distincte de la date source et de la période économique. Une politique synthétique explicite précise la période attendue, sa date limite de publication, sa version et sa référence de calendrier. Aucun calendrier réel ni délai fournisseur n'est supposé certifié.

- Politique absente, inapplicable ou échéance non atteinte → UNKNOWN.
- Période attendue absente / observation ancienne → STALE, même après une collecte ou publication récente.
- Observation future, unité inconnue ou liaison incorrecte → pas de valeur certifiée.
- Doublons divergents, révision ou droits divergents pour une même période → CONFLICT, sans dernier-écrivain-gagnant.
- Replay de la même preuve → une observation, collecte la plus ancienne conservée.
- Valeurs STALE/PARTIAL peuvent rester consultables ; elles ne deviennent pas exploitables tactiquement.

Le parseur FRED accepte exactement `DATE,<serie>` ou `observation_date,<serie>`. La date du CSV est un libellé de période, **pas une preuve de date de publication**. Un en-tête inconnu produit SCHEMA_CHANGED. Les valeurs vides, '.', non finies ou incorrectes restent des trous explicites ; dates invalides et doublons sont signalés. Limites distinctes : CSV 2 millions de caractères / 50 000 lignes lues ; préparation 2 000 observations.

### Correction bornée L2-MACRO-R001

La première revue indépendante a refusé le candidat V1 : une citation CSV non fermée était acceptée, et `float()` transformait `1_2` en `12.0`. Le correctif impose une lecture CSV stricte, en-tête inclus. Une erreur de syntaxe retourne SCHEMA_CHANGED, sans aucune ligne récupérée, même après des lignes valides.

Après décodage CSV, un nombre doit correspondre entièrement à la grammaire ASCII `[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?`. Les décimaux signés et exposants explicites sont acceptés, avec ou sans citation CSV valide. Espaces, séparateurs de milliers, underscores et chiffres Unicode ne sont pas nettoyés ou convertis : INVALID_VALUE, valeur nulle et résultat PARTIAL. Les bornes et contrôles de finitude existants restent inchangés ; vide et '.' restent VALUE_MISSING.

Les deux consommateurs historiques refusent ces états non PARSED. Les tests les exécutent avec des réponses synthétiques ; le code privilégié de bridge n'est pas importé. Aucune forme de payload ni de lecture frontend ne change, aucun writer ou fournisseur n'est exécuté. Les preuves V1 et la revue FIX-FIRST restent historiques ; la contre-revue du candidat corrigé est une décision séparée.

## Calculs

### Misery Index

`(CPI[t] / CPI[t−12] − 1) × 100 + UNRATE[t]`.

Treize mois civils consécutifs de CPI, méthodes comparables et chômage de la même période sont requis. Les anciennes observations peuvent être anciennes par rapport à aujourd'hui, mais pas partielles, futures, incohérentes ou révisées sans résolution. Exemple synthétique : CPI 300 → 306, chômage 4 %, résultat 6 points. Un trou mensuel ne décale pas le calcul par index de ligne. Aucun secours 3,2/3,7.

La période du résultat est conservée séparément de la date de dernière publication source. Quatorze preuves d'entrée sont liées. Aucune autorisation d'usage fournisseur n'est héritée du résultat.

### Courbe 10 ans – 2 ans

Seule la série native T10Y2Y conforme au contrat est utilisée. Le proxy « 10 ans − 5 ans − 0,3 » est supprimé, pas renommé en source réelle.

### Volatilité du yen

Volatilité **réalisée**, pas implicite : 5 prix datés sur 5 séances injectées → 4 rendements logarithmiques ; écart-type d'échantillon (`ddof=1`) × racine(252) × 100. Fenêtre, séances, annualisation et calendrier figurent dans la preuve. Le calcul par différence de logarithmes évite un débordement intermédiaire du ratio.

## Garde-fous des anciens producteurs

- bridge ne produit plus ^VIX/^TNX, déjà attribués à macro_sync.
- Les anciens calculs avancés de bridge sont retirés. Ils ne sont **pas remplacés par des écritures L2**. Les valeurs historiques en base ne sont pas nettoyées ; le lecteur les conserve non certifiées.
- Les autres symboles de bridge (or, EURUSD, bitcoin) sont inchangés.
- Les deux adaptateurs CSV historiques refusent un résultat non PARSED : aucun succès vide ni suppression silencieuse de trous. Cela peut rendre indisponible un ancien consommateur face à un CSV partiel ; ce refus explicite est intentionnel et doit être traité dans un futur raccordement autorisé.
- macro_sync ne compte une mise à jour comme réussie que si la réponse contient la ligne attendue. Son run devient FAILED si des lignes échouent. Ces chemins sont testés par doubles locaux, jamais exécutés sur Supabase.

Les algorithmes et fonctions de régime/cibles n'ont pas été réécrits. La préparation L2 ne les importe pas, ne les appelle pas et ne génère aucune instruction de transaction.

## Validation et couverture

| Plan | Preuve hors ligne |
| --- | --- |
| TMAC-01 | CPI/chômage manquants ; refus des anciens secours |
| TMAC-02 | T10Y2Y explicite ; ^FVX rejeté |
| TMAC-03 | 13 mois exacts, trou, désalignement, méthode/révision |
| TMAC-04 | Unités et conversions ; non-finis et nombres non sûrs refusés |
| TMAC-05 | Propriétaire unique ; conflits/permutations ; replay et alias natifs |
| TMAC-06 | Quotidien/mensuel, futur, retard de période, politique absente/inapplicable |
| TMAC-07 | Import pur et environnement/réseau interdits ; producteurs simulés ; aucune cible |
| TMAC-08 | Composants réels + SWR avec données synthétiques ; historique READY toujours quarantiné |
| TMAC-09 | Deux formes CSV, schéma inconnu, trous, doublons, longue série bornée |
| TMAC-10 | PMI indisponible sans substitution |

Preuves historiques du candidat V1 : 502 tests backend, dont 89 L2 ; 28 fixtures Python/TypeScript, 5 contrôles de types négatifs et 12 contrôles négatifs de projection ; suites frontend et parités L0/L1 PASS. Rendu navigateur : 24 scénarios, largeurs 1440/390, clavier, erreur cache/reprise, zéro erreur page et zéro requête externe. Ce banc n'est pas la route /mdss complète ni une recette Production.

Après correction L2-MACRO-R001 : 67 cas supplémentaires, dont 20 échouaient avant le correctif ; 156 tests L2 et 569 tests backend PASS. Parités L0/L1, 28 fixtures macro Python/TypeScript, 5 contrôles négatifs de types, 12 de projection, suites frontend, lint et TypeScript PASS (sept avertissements lint hérités). Ces tests sont réexécutés sans réseau. Aucun fichier frontend n'est modifié par cette correction ; le rendu navigateur historique n'a pas été réexécuté à cette passe.

Commandes reproductibles (réseau et environnement protégés par le banc lors de la validation) :

- Depuis backend : `python3.11 -B -m pytest -q -p no:cacheprovider -p source_contracts_offline_guard --ignore=tests/test_allocation_contracts_postgres.py`, avec `PYTHONPATH=.:tests` et `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1`.
- Depuis frontend : `npm run test:macro-trace`, `npm run test:macro-trace-browser -- --output-dir <répertoire-de-preuve>`, `npm run test:source-contracts`, `npm run test:fx-trace`, `npm run test:frontend`, `npm run lint`, `npx tsc --noEmit --incremental false`.

Limites conservées, sans dérogation :

- Build Next complet BLOCKED : les polices Geist/Geist Mono nécessitent Google Fonts, interdit par le test hors ligne. Aucun changement des polices/configuration et aucune ouverture réseau.
- Validateur statique global FAIL sur les deux contrôles déjà présents avant L2 : targets.portfolio_drift_mobile_cards et arbitrage.decision_dashboard ; aucun nouvel échec. Sept avertissements lint préexistants, zéro erreur.
- Première revue indépendante L2 : FIX-FIRST (L2-MACRO-R001). Contre-revue du candidat corrigé : en attente, non anticipée par les tests locaux.
- Smoke Supabase, Postgres réel, sources réelles, CI, authentification/runtime Production : NOT RUN.
- Aucun commit, push, PR, merge, activation, déploiement ou changement Supabase.

La prochaine étape est la contre-revue indépendante autorisée du manifeste corrigé exact et du diff L2 accumulé. Un résultat technique local ne vaut ni SHIP, ni acceptation de source réelle, ni ouverture d'un gate programme.

