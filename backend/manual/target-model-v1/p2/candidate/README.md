# P2 — paquet SQL/ACL hors ligne

Candidat local uniquement. Aucun connecteur Supabase, import réel ou activation.
Les quatre SQL historiques sont embarqués **sans changement d'octet**, dans l'ordre :
contrat, droits table/séquence, droits de la vue, contrôle propriétaire. Une seule
transaction, aucun état intermédiaire livré. Le remplacement de la vue n'est pas
une migration purement additive.

## Exécuteur
Le point d'entrée vérifie le manifeste mais n'exécute rien. La fonction de répétition
accepte uniquement une instance PostgreSQL 17.6 synthétique, socket Unix privé,
identifiant système et empreinte de catalogue explicites. Aucun environnement
d'authentification n'est utilisé. Le catalogue, RLS et objets préexistants sont
vérifiés sous transaction/verrous ; les droits globaux restent inchangés.
Tout résultat ambigu est STOP sans relance automatique. Une intention consommée
ne se réutilise pas ; une base déjà migrée est refusée.

## Limites d'acceptation
Les tests ne prouvent pas l'état Supabase actuel. L'empreinte synthétique n'est pas
une empreinte de Production. Le transport réel, son identité, la sauvegarde et sa
restauration, la fenêtre exclusive et le préflight frais restent des gates séparés.
Des politiques de lecture permissives existantes ne sont pas supprimées : le
paquet s'arrête. Les tables cibles doivent être vides (condition constatée au P1,
mais à confirmer de nouveau avant tout acte réel).

Les 216 fichiers précédemment scellés restent inchangés : SHIP11 importeur/lecteurs
n'est pas une nouvelle revue SQL. Aucun changement de types frontend ici ; le
contrat déjà implémenté passe de 12 à 15 champs modèle et de 16 à 32 champs conseil.
Créer la définition RPC ne l'appelle pas. L'import réel active les modèles et
requiert une autorisation distincte. Ni les commandes de l'application ni les
instruments ne sont activés par P2.


## P2-ACL-001 — droits hérités
Le garde évalue les rôles effectifs via PostgreSQL USAGE, y compris l’héritage
transitif. PUBLIC est traité séparément avant tout appel portant sur son OID zéro.
Il refuse les politiques permissives existantes ; il ne les répare pas.
Trois régressions paramétrées couvrent les deux tables, PUBLIC, rôle direct,
héritage simple/transitif, appartenance non héritée/non SET et rôle distinct.
Chaque refus conserve le catalogue et les droits globaux ; les cas sûrs restent
accessibles uniquement aux profils autorisés. Suite : huit tests existants + trois
régressions, PostgreSQL 17.6 synthétique, sans accès Supabase.
