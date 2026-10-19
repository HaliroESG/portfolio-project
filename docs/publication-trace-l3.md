# L3 — publications traçables, candidat hors ligne

Date : 18 octobre 2026. Statut : candidat corrigé localement après la revue L3 V1 ; **contre-revue indépendante requise**. Son résultat exact est conservé dans les preuves du contrôleur, sans réécrire le candidat scellé.
Ce document ne prouve ni la qualité des sources réelles, ni leur droit d’usage, ni une livraison Production.

## Périmètre et impacts

- Chemin retenu : normaliseurs natifs, contrats purs, fixtures et lecteurs existants. Les alternatives provider-native/manuelles exigeraient un accès externe et ne corrigeraient pas les règles de qualification ; aucun nouveau service ni reconstruction.
- Backend : corrections locales de qualification, identité SEC et statistiques. Aucun job de collecte exécuté. Les tests de synchronisation utilisent uniquement des doubles en mémoire.
- Supabase : aucune lecture, écriture ou migration. Les cinq champs de preuve comptable ajoutés à `InterimFinancialRecord` ne sont **pas** sérialisés dans le payload historique.
- Frontend : types logiques alignés, projection de preuve explicite, indicateurs de couverture séparés ; mêmes tables, sélecteurs et pagination. `ttm_evidence_state=UNATTESTED` est un garde de lecture, pas une colonne supposée existante.
- UI : tableau, calendrier et détail conservés. 5 exercices / 8 périodes / 24 événements restent des limites de consultation annoncées. Aucun ordre, conseil applicable ou bouton de mutation ajouté.

## Événement, publication et preuve

Une date passée ne transforme jamais ESTIMATED en REPORTED. Un EPS réellement renseigné (y compris zéro) peut établir un résultat **observé par un agrégateur**, pas une confirmation officielle. HIGH / INFERRED décrivent le rapprochement fiscal, pas la preuve d’une publication.

Les nouveaux normaliseurs conservent dans `metadata.publication_evidence` la version, la base, la référence et la date civile de l’occurrence. Le lecteur vérifie leur liaison à la ligne : provider, type, date, accession et URL documentaire SEC, ou référence symbole/date et EPS de l’agrégateur. « Dépôt référencé par SEC » signifie un document référencé dans les submissions, **pas** une lecture/vérification de son contenu.

Les anciennes lignes REPORTED ou CONFIRMED sans cette liaison restent consultables sous un libellé **non attesté**. Aucune réécriture de données historiques n’a lieu. CANCELLED reste distinct et ne devient jamais REPORTED.

Le contrat pur `prepare_publication` est limité à OFFLINE_SYNTHETIC, horloge injectée, autorité opérationnelle fausse. Il sépare date civile, instant avec offset explicite, période fiscale, date de dépôt et observation de preuve. Un instant naïf n’est pas transformé en UTC. Une date inconnue reste inconnue. Les révisions conservent un identifiant natif explicite, un prédécesseur et un lien d’amendement déclaré ; une chaîne manquante, cyclique ou une révision contradictoire échoue. Un lot de révisions doit partager la même horloge d’évaluation ; aucun « dernier état courant » n’est choisi en cas de branchement.

Pour REGULATORY_FILING déclaré REPORTED, la date de dépôt doit être présente et égale à la date civile de l’occurrence, elle-même bornée par l’observation et l’horloge. Sinon la preuve reste non attestée. Une annonce de résultats EARNINGS reste distincte d’un dépôt réglementaire.

## Identités et réconciliation future

SEC : identité documentaire par CIK, accession et document, jamais par année + 10-Q ; la clé de ligne conserve aussi l’instrument destinataire pour ne pas écraser deux catégories d’actions du même émetteur. Les dépôts amendés sont conservés séparément. Le lien au dépôt amendé ne se déduit pas de la date et reste absent si la source ne l’atteste pas.

Yahoo : une étiquette Q3 déduite ne remplace pas l’identité datée. Le rapprochement fiscal ne renomme plus une occurrence. Deux observations du même événement (estimation puis résultat observé) se réunissent de façon idempotente en conservant les états vus ; des dates ou révisions incompatibles exigent une réconciliation explicite.

Deux EPS réellement observés et contradictoires pour la même occurrence sont refusés dans les deux ordres, y compris zéro et négatifs. Un doublon identique reste rejouable ; l’ordre d’arrivée ne choisit pas le bénéfice publié.

**Avant toute activation future :** inventorier hors écriture les clés historiques, préparer une correspondance ancienne/nouvelle, détecter les collisions, préserver l’historique et faire revoir le plan. Ne pas simplement rejouer les nouvelles clés par-dessus les anciennes : cela pourrait créer des doublons. Les lignes sans accession/doc/date exigent une preuve source ; aucun identifiant ni rattachement n’est inventé. Le contrat de révisions synthétique n’est pas connecté à un stockage live.

## TTM — quatre périodes comparables

Le contrat exige exactement quatre trimestres discrets : même instrument, devise non nulle, définition comptable et périmètre de consolidation ; dates de début/fin explicites, sans trou ni chevauchement ; succession fiscale cohérente. Deux bases sont explicites : trois mois calendaires complets, ou trimestres de 12/13/14 semaines totalisant 52/53 semaines. Les exercices décalés sont admis.

Un semestre/YTD n’est pas additionné comme un trimestre. **Aucune conversion YTD n’est implémentée** : elle reste interdite tant qu’un adaptateur ne fournit pas des entrées comparables et une dérivation documentée. Les données legacy limitées aux dates de fin ne satisfont pas L3.

`complete` prouve la comparabilité des quatre périodes, pas la présence de chaque métrique. Chaque somme exige quatre valeurs finies ; une valeur nulle invalide seulement le total concerné. Les zéros et FCF négatifs restent légitimes. Les nombres non sûrs pour JavaScript sont rejetés/masqués.

`backend/sql/contracts/publication_ttm_v1.sql` est une **requête de contrat hors ligne**, pas une migration ni le remplacement de la vue historique. La même matrice est exécutée en Python et sur PostgreSQL 15 éphémère en mode single-user : aucun socket serveur, aucune connexion Supabase. Les entrées mal typées ne doivent pas être qualifiées par coercition SQL.

Les deux bornes de période exigent un texte civil canonique YYYY-MM-DD et une date existante : aucun raccourci, espace, horodatage, jour impossible ou valeur spéciale PostgreSQL n’est converti silencieusement en preuve TTM. Python rejette ces entrées ; l’oracle SQL les masque avec complete=false et totaux nuls.

## Couvertures distinctes

- Population d’instruments chargés, accompagnée du reçu paginé.
- Valeurs annuelles/intermédiaires réellement renseignées, période et devise propres.
- Événements chargés dans une fenêtre donnée, avec COMPLETE/PARTIAL de lecture — jamais exhaustivité des émetteurs.
- Documents SEC référencés, résultats agrégateur, publications déclarées sans preuve.
- Valorisation : date propre conservée ; aucune nouvelle collecte ne la rend fraîche.

Le statut ETL SUCCESS ne certifie aucune de ces dimensions. Des échecs de lecture par symbole conservent les événements partiels, signalent FAILED/PARTIAL et ne deviennent pas des succès financiers grâce au seul calendrier.

L’absence de données financières pour un symbole effectivement ciblé, même retournée sans exception, termine la collecte en FAILED. Le mode daily ne cible que les publications dues ; un symbole hors cible n’est pas un échec de tentative. Sans cible due, le traitement calendrier peut réussir mais la couverture financière reste explicitement PARTIAL : aucun compte financier n’est réputé collecté.

La correction L3-PUB-R001..R004 ne change aucune forme de payload, aucun enum, table, sélecteur ou type frontend. Les contrôles existants de types et de lecteurs restent applicables ; aucune écriture Supabase n’a été exécutée.

### Correctif R005 — compteurs de tentative (19 octobre 2026)

`items_total`, `items_success` et `items_failed` décrivent exclusivement les instruments ciblés par la collecte financière du passage. Le total est égal aux succès plus les échecs ; une réponse financière vide ou une exception compte comme échec, mais un instrument non ciblé ne compte dans aucun de ces trois champs. Sans cible due, ils valent tous zéro : le succès éventuel du calendrier ne prouve aucune collecte financière.

`universe_count` et `coverage_dimensions.universe_instruments` conservent la population complète ; `coverage_pct` conserve son dénominateur univers. Par exemple, AAPL seul dû et collecté dans un univers AAPL/MSFT donne total=1, succès=1, échec=0 et couverture=50 %, sans masquer la qualité PARTIAL.

Le correctif ne change pas la forme JSON des statistiques, les payloads financiers/événements, les tables ou `frontend/types.ts`. Le consommateur `DataHealthPanel.extractEtlMetrics` lit déjà les trois compteurs canoniques et la couverture séparément ; son taux de réussite reste non calculable (`null`) quand le total vaut zéro. Les ratios historiques existants ne sont ni réécrits ni certifiés par ce changement. Aucun job réel n'est exécuté.

### Correctif R006 — tendance de santé des données (19 octobre 2026)

La tendance des huit derniers passages d'un même job choisit **une seule métrique pour toute la série** : taux de réussite s'il est disponible, sinon couverture, sinon score de statut explicitement nommé. Un point absent dans cette métrique reste `null` : ni une couverture à zéro ni un statut SUCCESS/FAILED ne le remplacent. Un FAILED peut donc conserver son taux mesuré, distinct du statut critique du passage.

Le cas R005 « aucun instrument dû » garde un taux non calculable quand `items_total=0`. À côté d'un passage à 100 % de réussite et 50 % de couverture, le graphique montre `[100, null]`, jamais `[100, 0]`. Les zéros mesurés restent des zéros. Les valeurs non finies ou hors 0–100 ne sont pas des ratios exploitables.

Les points sont affichés chronologiquement. Les absences ont un tiret neutre, une description accessible datée et une légende « not computable », sans barre de hauteur fictive. Les valeurs à zéro ont un repère de base et une valeur explicite ; le score de statut est étiqueté `/100`, pas `%`. Moins de quatre points calculables ne produit aucune direction. Sinon, la comparaison existante des moyennes des moitiés ancienne/récente et son seuil de ±2 points sont conservés, uniquement sur la métrique choisie.

Le helper pur est testé par `test:data-health-trend` (inclus dans `test:frontend`). `test:data-health-trend:browser` rend le vrai `DataHealthPanel` sur un transport en mémoire, sans client Supabase ni requête extérieure, aux formats bureau et mobile. Aucun backend, contrat de payload, type Supabase, schéma, seuil de qualité ou commande opérationnelle n'est changé par R006.

## Validation et limites

Fixtures : `backend/tests/fixtures/publication_contracts_v1.json`.
Tests : `test_publication_contracts.py`, `test_equity_publications_l3.py`, tests historiques adaptés, `npm run test:publication-trace`, et régression P0.
Le test SQL requiert les binaires PostgreSQL 15 locaux ; leur absence produit SKIP, jamais une preuve de parité.

Le dossier Governor SOURCE-PUBLICATIONS-L3-V1 du contrôleur contient les empreintes, résultats exacts, préimages et le harnais navigateur synthétique. Les tests navigateur utilisent la vraie page et ses lecteurs, mais un transport en mémoire et un AppShell simplifié ; ils ne valident ni authentification, ni serveur Next complet, ni navigateur personnel connecté.

La compilation Production reste à qualifier dans un cadre adapté : le mode réseau interdit bloque les ports auxiliaires de Turbopack et le téléchargement des polices Google du chemin webpack. Ne pas lever cette limite ni remplacer les polices dans ce lot. Deux échecs statiques hérités Allocations/Arbitrage restent hors périmètre.

## Suite, sous gates séparées

1. Revue indépendante de l’exact paquet L3 scellé — autorisation d’un nouveau chat requise.
2. Si SHIP : consolidation L0/L1/L2/L3 et préparation L4, sans confondre acceptation locale et livraison.
3. Toute PR/CI, branche, migration de contrat, réconciliation historique, collecte réelle, activation ou déploiement exige son autorité spécifique. Aucune de ces actions n’est exécutée ici.
