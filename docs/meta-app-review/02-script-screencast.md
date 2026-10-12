# 02 — Script du screencast

Règles Meta à respecter à la lettre : compte Instagram Business/Creator **réel** (pas un compte de test factice sans usage réel), écran de consentement OAuth visible à l'écran, données affichées dans l'UI (pas seulement dans des logs/console), commentaire en anglais (voix off ou sous-titres) même si l'app est en français.

Une seule vidéo continue de 2 à 3 minutes suffit pour couvrir les deux permissions.

1. **0:00** — Écran d'accueil Naya connecté, aller dans Réglages.
2. **0:10** — Cliquer "Connecter Instagram" ; montrer la redirection vers `instagram.com/oauth/authorize`.
3. **0:20** — Se connecter avec un vrai compte Instagram professionnel (Business ou Creator) ; montrer l'écran de consentement Meta qui liste explicitement les permissions demandées.
4. **0:35** — Accepter ; retour sur Naya, montrer le compte connecté affiché dans l'UI (username + user ID visibles) → couvre `instagram_business_basic`.
5. **0:50** — Aller dans le calendrier éditorial, créer un post (image ou carrousel), écrire une légende, choisir "Publier maintenant" ou une date de programmation.
6. **1:20** — Montrer le post passer au statut "Publié" dans Naya (ID ou lien de la publication affiché).
7. **1:35** — Ouvrir Instagram (app ou web) sur ce même compte réel et montrer que le post est bien apparu sur le profil → preuve côté plateforme, pas seulement côté Naya.
8. **1:50** — Sous-titre ou voix off de clôture : "This demonstrates instagram_business_basic (profile retrieval) and instagram_business_content_publish (scheduled publishing) used together in Naya's core scheduling feature."

Erreurs qui font rejeter un screencast, à éviter explicitement : compte de test sans activité réelle, écran de consentement absent de la vidéo, donnée visible seulement dans la console développeur.
