# 03 — Instructions pour les reviewers Meta

À coller dans le champ "Instructions" de la demande App Review (en anglais).

```
1. Go to https://hellonaya.app and log in with the test account below.
   Email: [compte de test dédié — à créer]
   Password: [mot de passe]

2. Once logged in, go to Settings (top right menu) → "Connect Instagram".

3. Click "Connect Instagram". You will be redirected to Instagram's OAuth consent screen.
   Log in with the test Instagram Business account provided below and accept the requested
   permissions.

4. After the redirect back to Naya, the connected Instagram account (username) is displayed
   in Settings. This confirms the instagram_business_basic permission (profile read).

5. Go to "Editorial calendar" (left sidebar) → "New post". Create a post with an image and a
   caption, then click "Publish now".

6. The post status changes to "Published" within a few seconds. This confirms the
   instagram_business_content_publish permission (media creation + publishing).

7. You can verify the post was published by visiting the test Instagram account directly at
   instagram.com/[handle du compte de test].
```

## Compte de test à préparer avant soumission

- Un compte Naya dédié à la review (pas ton compte perso), avec accès complet aux fonctionnalités de programmation — si Naya a un paywall, donne un plan gratuit/illimité à ce compte plutôt que de demander au reviewer de payer.
- Un vrai compte Instagram professionnel (Business ou Creator) dédié aux tests, distinct de ton compte personnel, pour ne pas exposer tes propres abonnés/données au reviewer.
- Vérifie que ce compte fonctionne **au moment précis** de la soumission : Meta teste en direct, la vidéo ne suffit pas.
- Vérifie que `WAITLIST_MODE` n'empêche pas ce compte de test d'accéder à l'app.
