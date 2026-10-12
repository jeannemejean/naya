# 06 — Checklist finale avant de cliquer sur "Submit for Review"

Ordre recommandé — ne pas sauter d'étape, un seul point manquant suffit à faire rejeter la demande et à repousser la resoumission.

1. [ ] Corriger le texte marketing (`settings.tsx`) qui promet Facebook, ou retirer le code mort Facebook (`00`).
2. [ ] Confirmer en prod (Railway) : `TOKEN_ENCRYPTION_KEY`, `IG_APP_ID`/`IG_APP_SECRET` = vraies valeurs de prod ; migration `platform_user_id` appliquée (`00`).
3. [ ] Icône 1024×1024 + tous les champs du dashboard app (`05`).
4. [ ] Business Verification validée dans Meta Business Manager, sans restriction (`04`).
5. [ ] Tech Provider Verification validée (`04`).
6. [ ] `WAITLIST_MODE` désactivé, ou accès direct garanti pour le reviewer.
7. [ ] Compte de test Naya + vrai compte Instagram Business/Creator de test créés et fonctionnels (`03`).
8. [ ] Au moins 1 appel API réussi par permission avec ce compte de test, dans les 30 jours précédant la soumission (connexion + publication d'un post réel).
9. [ ] Screencast filmé (`02`) — écran de consentement OAuth visible, username et post publié visibles dans l'UI.
10. [ ] Instructions testeur rédigées avec les vrais identifiants du compte de test (`03`).
11. [ ] Justifications de permissions collées (`01`) — vérifier qu'elles ne mentionnent que `instagram_business_basic` et `instagram_business_content_publish`.
12. [ ] Advanced Access demandé sur les deux permissions.
13. [ ] Soumission de l'App Review.

Si un seul point de 1 à 8 n'est pas coché, ne pas soumettre.
