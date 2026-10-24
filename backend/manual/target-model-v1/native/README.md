# A — chemin PostgreSQL natif, préparation hors ligne

Le renderer produit un plan pour **psql**, sans lancer le client ni une connexion.
La CLI annonce uniquement OFFLINE_PLAN_BUILDER_ONLY. Aucun secret n’est lu.
Les quatre SQL P2 et ses gardes restent byte-identiques; le contrôle d’identité
synthétique est remplacé dans le plan par un contrôle réel explicite. L’exécuteur
P2 historique reste intact et refuse toujours une connexion réelle.

## Choix et limites

Client PostgreSQL 17.6 déjà qualifié, connexion directe db.<project>.supabase.co:5432,
pas de pooler, pas de fallback. TLS verify-full, CA explicite et TLS >=1.2,
GSS encryption désactivé pour exiger TLS, pas de fichier de démarrage psql,
pas d’invite de mot de passe, environnement entièrement remplacé. Identité serveur
(system identifier), base, rôle, version et catalogue attendus sont vérifiés avant
DDL. Une session, SERIALIZABLE, verrous et délais bornés, une transaction.

Le serveur réel, ses privilèges sur pg_control_system/pg_stat_ssl, sa version,
la connectivité IPv6, la CA et les credentials ne sont **pas qualifiés** par les
tests hors ligne. Un point indisponible à C impose STOP; aucun contournement
pooler, changement de rôle/version ou achat implicite. Le verrouillage ne
remplace pas une fenêtre administrative exclusive : des modifications de rôle,
policies ou fonctions peuvent provenir d’autres sessions. Les empreintes servent
à détecter une dérive, pas à autoriser ni empêcher toutes les mutations concurrentes.

## Mode opératoire futur, INACTIF dans A

1. **C puis GO D distinct** : obtenir cible, version/commit livré, catalogue frais,
   récupération restaurable et fenêtre sans écrivain ni administrateur concurrent.
   Vérifier le contenu des reçus de sauvegarde/restauration : leurs hashes seuls ne
   prouvent rien. Confirmer les tables cibles vides et les droits requis. Aucun
   modèle ni import n’est inclus. La cible actuelle n’est pas déduite d’un ancien ID.
2. À partir de la preuve fraîche, préparer le binding fermé (pas de password/URL),
   le SQL et le plan en répertoire protégé, hors Git/output public. Revalider les
   hashes P2, le client, les types lecteurs et le commit réellement servi. Sceller
   le plan complet (argv/env/sql/binding) et lier ce hash au GO D exact; le plan
   produit porte toujours `real_execution_authorized=false` : l’autorité vient
   du message humain et du protocole, jamais du renderer.
3. Vérifier juste avant usage que les fichiers CA/mot de passe et chaque parent ne
   sont pas symlinks, sont sous contrôle de l’opérateur et non modifiables par
   autrui. Mot de passe : fichier privé 0600, une seule entrée libpq correspondant
   exactement host/port/base/user, sans wildcard; valeur jamais imprimée ni hashée.
   CA officielle vérifiée et fichier/pin client intègres; ne pas inventer de CA.
   Le renderer ne valide volontairement ni contenu ni présence de ces fichiers.
4. Recontrôler l’expiration (<=24h), l’exclusivité et l’autorité; consommer l’opération
   Governor unique **avant connexion**. Créer une intention privée exclusive et
   durable (création atomique sans écrasement, fsync) liée au hash du plan, à l’UUID
   et au GO. Existence, erreur ou issue ambiguë = arrêt. La tenue de cette intention
   relève du futur opérateur; aucun journal d’exécution réel n’existe dans A.
5. Lancer le tableau argv avec `shell=False`, stdin=SQL scellé et env=le dictionnaire
   complet (jamais hériter os.environ). Utiliser une seule instance psql, sans
   `--single-transaction` supplémentaire puisque BEGIN/COMMIT sont explicites.
   Capturer les sorties dans un espace privé éphémère; délai total 75s. Timeout :
   terminer le client, attendre sa fin, ne pas lancer un second client. Le serveur
   possède aussi des délais de transaction/instruction; ne jamais déduire du timeout
   que COMMIT n’a pas eu lieu. Aucun retry, boucle ou deuxième tentative automatique.
6. Avant COMMIT, erreur provoque l’arrêt de la session et le rollback transactionnel.
   Après COMMIT ou perte de réponse : résultat inconnu, arrêt des mutations.
   Exit 0 + marqueur exact final signifie **COMMIT_ACKNOWLEDGED_REVERIFY**, pas PASS
   métier. Faire la relecture indépendante autorisée de l’état réel et des droits.
   Conserver seulement états, dates, hashes et codes expurgés; aucune sortie SQL
   brute, credential, montant ou cookie dans les artefacts. Supprimer les fichiers
   secrets temporaires selon la procédure approuvée; ne pas altérer les secrets existants.
7. Toute restauration après COMMIT doit être nommément autorisée avec la préimage
   et les effets; ne pas restaurer des droits permissifs. Une rupture/ambiguïté
   clôt la passe. L’import et l’activation PERSO/PRO sont des phases distinctes.

## Tests et portée de SHIP attendu

Tests purs du renderer, des entrées host/identité/injection/expiry, environnement
sans héritage, intégrité P2, ordre des quatre SQL et classification des réponses.
Un test exécute le plan sur une fixture locale Unix privée : le garde refuse avant
DDL, le catalogue reste identique et le cluster est arrêté. Pas de serveur TLS
réel testé, pas de credentials réels, aucune connexion Supabase. Le SHIP demandé
porte sur **la préparation du chemin natif et ses garde-fous hors ligne**.
Il ne vaut ni autorisation ni qualification de la connectivité, ni GO migration.

Backend writes, schéma/données Supabase et lecteurs frontend : aucun changement
pendant A. Lint/build/smoke frontend, CI, revue complète de l’application et
fournisseurs réels restent NOT RUN. Aucun nouveau champ métier créé dans ce lot.
