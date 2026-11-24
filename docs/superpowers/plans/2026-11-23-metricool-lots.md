# Inspirations Metricool (REA) : lots à construire

Branche : feat/reseaux-par-projet (contient déjà : premier commentaire, couverture des Reels, légende par
réseau, réseaux par projet). Source : docs/superpowers/specs/2026-11-23-metricool-rea.md.
Décisions prises par Claude (Jeanne a délégué). API officielles seulement. Aucun déploiement avant la fin
de tous les lots, la revue, et l'accord explicite de Jeanne (migrations puis push).

Règles communes : français, tests vitest pour toute logique, i18n fr/en (garde JSX : aucun texte en dur),
tout passe par req.userId, migrations additives seulement (numérotées à la suite), MIGRATIONS.md tenu à jour.

1. Options de post : alt_text (images Instagram), collaborators (Instagram, ≤ 3 comptes publics),
   share_to_feed (Reel affiché dans le fil), audio_name (Reel) ; LinkedIn carrousel PDF (images → document).
2. Gestion des posts : notes internes, historique, dupliquer vers une autre marque, corbeille et
   restauration, actions groupées dans le calendrier (déplacer, dupliquer, supprimer).
3. Bibliothèque : textes enregistrés et posts modèles réutilisables.
4. Aperçu grille Instagram par marque.
5. SmartLinks (page « lien en bio » publique par marque, clics comptés) et liens courts avec UTM
   (www.hellonaya.app/l/<code>).
6. Autolists : créneaux récurrents par marque, file de posts, option « en boucle » (evergreen).
7. Meilleure heure : grille jour × heure par réseau, source affichée (données propres si disponibles,
   sinon études générales).
8. Validation client : portail par lien privé sans compte, règles (un seul / tous), statuts, commentaires ;
   un post en attente de validation ne part pas.
9. Groupes de marques : filtrer calendrier et composeur sur plusieurs projets.
10. « Finir sur le téléphone » : pour ce que les API ne permettent pas, tâche avec légende à copier et
    médias à télécharger.

Hors champ : Google Business, Pinterest, Threads, X, boost publicitaire, recherche de hashtags,
identification de produits, spoiler, langue du post.
