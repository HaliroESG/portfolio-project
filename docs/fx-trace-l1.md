# L1 — FX traçable, candidat hors ligne

18 octobre 2026. Implémentation locale uniquement, dépendante du contrat L0 corrigé.
Ce document ne constitue ni une acceptation indépendante, ni une preuve runtime.

## Périmètre et impacts

- Backend : nouveau module pur `fx_contracts.py`, sans client, réseau, environnement
  ni écriture. `bridge.update_currencies()` est inchangé et n'est jamais importé par
  le harnais. Le module prépare une enveloppe logique, pas un payload d'upsert.
- Supabase : **aucune migration, lecture distante ou mutation**. Les sélecteurs
  existants restent `id,symbol,rate_to_eur,last_update`, puis le repli ancien schéma.
  Aucun champ enrichi n'est supposé disponible en base.
- Frontend : contrat `FxTraceV1` aligné avec Python ; projection de fixtures séparée
  du lecteur réel. `/fx`, `/currencies` et le panneau FX partagent `useFxRates`, le
  même cache SWR et `FxRateDetails`. Les anciennes valeurs sont consultables,
  jamais promues en cotations certifiées par une collecte récente.
- Aucune commande métier, donnée réelle, activation, publication Git ou déploiement.

## Contrat de référence

Le pilote est fermé : `USDEUR=X`, `CHFEUR=X`, `GBPEUR=X`, `JPYEUR=X`.
`FX:<devise>:EUR` signifie **EUR pour une unité de la devise**. Aucun ticker d'action,
crypto, identifiant incomplet, paire inversée implicite ou code hors pilote n'est
accepté par le préparateur. Une paire inverse doit être normalisée par un futur
adaptateur explicitement revu, pas devinée ici.

Chaque entrée contient le ticker exact, une référence de convention de clôture et
l'observation L0 complète : valeur positive finie et bornée, unité, date/précision
source, collecte, fournisseur, identifiant natif, preuve, version d'adaptateur et run.
Une valeur manquante reste `null`. EUR=1 n'est qu'une identité mathématique explicite
dans la présentation : sans fournisseur, date de marché, collecte ni variation.
Une ligne EUR portant une autre valeur est `CONFLICT`, sans taux affiché.

Le calendrier est injecté et versionné. Il nomme fournisseur, convention de clôture,
date d'évaluation, dernière séance attendue et liste ordonnée des séances. La base
de date est explicitement `UTC_SOURCE_DATE`. Il n'y a pas de calendrier réel encodé,
ni de règle universelle « lundi-vendredi ». Un calendrier absent, inapplicable ou
une observation absente de ses séances laisse l'âge en séances inconnu. Le nombre
de jours calendaires L0 reste distinct de cet âge.

Le contrat prend l'heure de référence en entrée ; il ne consulte jamais l'horloge
machine. Une collecte dominicale peut désigner la séance du vendredi sans inventer
de cotation le dimanche. Une horloge/date future ou une date inconnue empêche la
validation. Le calendrier synthétique ne prouve aucun calendrier fournisseur réel.

## Variation et conflits

`change_pct = cours_courant / cours_précédent - 1`.
La variation inverse est `cours_précédent / cours_courant - 1`, soit
`1 / (1 + change_pct) - 1`, et non un changement de signe.
Exemple synthétique : 0,90 → 0,99 donne +10 %, l'inverse −9,0909 %.

Conditions cumulatives : cours courant validé, séance courante attendue et précédente
immédiatement antérieure, même paire/unité/fournisseur/version de méthode, même
convention de clôture et précision. Pour les horodatages, l'heure UTC doit également
être identique. Un changement d'heure de clôture nécessite une politique future
explicite ; L1 préfère refuser plutôt que supposer la comparabilité.

Les entrées sont ordonnées par **date source**, pas par collecte. Tous les inputs
normalisés restent dans l'enveloppe pour audit. Une répétition strictement identique
conserve la première collecte ; elle ne rafraîchit pas artificiellement l'âge.
Deux valeurs/provenances/méthodes différentes pour la même séance bloquent la série
en `CONFLICT`. Une révision corrective nécessitera un contrat de réconciliation
distinct : aucun « dernier écrit gagnant » n'est implémenté. Un doublon avec collecte
future ne peut pas être masqué par une copie antérieure valide.

Les références de droits `rights_ref` font partie de cette comparaison L1, même
si elles ne participent pas à l'identifiant de révision L0. Deux références
différentes, ou une référence absente face à une référence présente, imposent
`CONFLICT` et rendent les deux variations indisponibles. Un conflit peut donc
ne contenir qu'un seul `revision_id` : les références divergentes restent dans
`observations`. Leur tri et les représentants d'audit `current` / `previous`
sont déterministes, sans départager ni certifier des droits. Une répétition avec
la même référence conserve la première collecte. L0 n'est pas modifié ; aucune
référence synthétique ne constitue une validation des droits fournisseur réels.

## Présentation et compatibilité

Les taux actuels `currencies` n'attestent pas la source, la date de cotation ou les
séances comparables. La projection de ces lignes est `UNKNOWN`, `MISSING`, collecte
ancienne `STALE`, ou `CONFLICT`, jamais `VALIDATED`. La variation commune reste N/A.
Les champs supplémentaires d'un ancien cache, même `status: VALIDATED`, sont ignorés.
La clé SWR est versionnée ; le cache local ancien reste un cache non certifié.

L'ancien rapprochement `rateDailyChange` par jour de collecte a été retiré. Son
ancien test P0 a été remplacé par l'assertion plus stricte de non-certification ;
l'inversion et la comparaison sont maintenant testées sur les dates sources L1.

`/currencies` conserve aussi les paires explicites Market Watch dans une section
distincte. Ce sont des observations indépendantes, pas un remplacement des taux de
conversion. La performance brute reste visible lorsque son ancien état source le
permet, mais avec libellé **non vérifiée**, sans couleur verte/rouge de validation.
Elle n'est jamais utilisée pour fabriquer la variation de la référence EUR.

Le panneau d'en-tête ne fabrique plus 0 à partir d'un taux manquant. Il expose erreur,
absence, chargement, cache et traçabilité ; fermeture par clavier/clic conservée.
Les chiffres, dates et états sont identiques dans les trois surfaces grâce au lecteur
et au composant partagés. Le détail développé donne les motifs et le calendrier.

`projectOfflineFxTrace` est réservé aux fixtures typées issues du normaliseur Python.
Il n'est importé par aucun lecteur runtime. Ce n'est pas un validateur universel de
réponses provider arbitraires. Ses gardes contrôlent les bindings et la cohérence des
variations ; les fixtures validées portent toujours `OFFLINE_SYNTHETIC` et
`operational_authority: false`, avec un avertissement visible dans le harnais.

## Consommateurs préservés

| Consommateur | Vérification locale | Limite |
| --- | --- | --- |
| PortfolioData | Quatre taux injectés dans le vrai lecteur ; valorisations EUR attendues conservées | Pas de certification de l'historique réel ni refonte de ses replis |
| Targets | Valeur déjà libellée en EUR conservée ; devise non réinterprétée | Pas de recalcul d'allocation |
| Screener | Taux et date FX de valorisation conservés ; pas de remplacement par collecte | Pas de recalcul des scores/valorisations historiques |
| Supports | Catalogue sans lecteur de conversion FX dans cet état du code | Injection FX non applicable ; aucun lecteur ajouté |

Le plan TFX-09 présupposait une conversion FX dans Supports : l'inspection corrige
cette hypothèse, sans déclarer une intégration inexistante. Les fichiers de ces
consommateurs et le writer historique sont inchangés.

## Validation hors ligne

- `python3.11 -B -m pytest -q tests/test_fx_contracts.py` : identité fermée, nombres,
  dates, calendrier, comparable/non comparable, inversion, replay, doublons, pureté.
- `npm run test:fx-trace` : sorties Python compilées contre `FxTraceV1`, projection,
  contrôles négatifs, ancien schéma/cache, quatre devises et consommateurs existants.
- `npm run test:fx-trace-browser` : vrais composants et SWR avec I/O synthétiques,
  1440 et 390 px, parité des trois surfaces, états dégradés, détails et clavier.
  Le shell d'application et la police sont locaux : ce n'est pas un test authentifié.
- Suite backend hors intégration PostgreSQL, suite frontend, lint, TypeScript,
  diff et validateur statique. Les résultats exacts sont dans le dossier de preuve
  du contrôleur, avec commandes et empreintes. Une compilation Next empêchée par
  les restrictions hors ligne n'est pas présentée comme PASS.
- `smoke:supabase`, tests réels fournisseurs, CI, transactions et production : non
  exécutés. Aucun install/download nécessaire ; réseau externe refusé.

## Gates encore fermées

Une revue indépendante exacte est requise avant SHIP. La présente autorité est solo
et ne permet pas de créer ce reviewer. Aucun nouveau thread n'est lancé implicitement.

Après revue/acceptation seulement, un chantier distinct devra vérifier le contrat
physique live en lecture seule, les droits de collecte/stockage/affichage, un calendrier
source versionné, les méthodes et la politique de revisions. Toute extension du writer,
migration, alimentation, activation ou mise en production exigera son autorité propre.
Les lots macro/publications suivants ne sont pas lancés par l'achèvement local de L1.
