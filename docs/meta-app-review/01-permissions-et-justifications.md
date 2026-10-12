# 01 — Permissions à demander (liste définitive)

Basée sur le flux Instagram API with Instagram Login réellement implémenté (`social-oauth.ts` + `social-publishers.ts`).

| Permission | Utilisée pour | Où dans le code |
|---|---|---|
| `instagram_business_basic` | Lire le profil IG connecté (`user_id`, `username`) pour l'afficher dans Naya et confirmer que le bon compte pro est connecté | `social-oauth.ts` → `exchangeInstagramCode` |
| `instagram_business_content_publish` | Créer un conteneur média et publier (image, carrousel, vidéo/reel/story) sur le compte IG connecté, à la date programmée dans le calendrier éditorial | `social-publishers.ts` (constante `IG_GRAPH`) |

Ne demande **que** ces deux permissions. N'ajoute pas `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic` ou `instagram_content_publish` (anciens noms, autre flux) : ils n'apparaîtront dans aucun appel API réel de l'app, et Meta vérifie l'usage effectif sur les 30 jours précédant la soumission.

Si tu ajoutes plus tard des insights (le code de `social-integrations.ts` appelle déjà `graph.facebook.com/.../insights`, mais n'est branché sur aucun flux OAuth actif) ou la publication sur Page Facebook, ce sera une demande de permissions séparée — après avoir construit un vrai flux OAuth Facebook Login, pas avant.

## Texte à coller dans le formulaire App Review

### `instagram_business_basic`
> Naya is a content scheduling tool for solo founders. When a user connects their professional Instagram account via the "Connect Instagram" button in Settings, we call `GET /me?fields=user_id,username` on graph.instagram.com to retrieve and display their Instagram user ID and username in the UI, so they can confirm which account is connected before scheduling a post. No other data is read with this permission.

### `instagram_business_content_publish`
> Once the account is connected, the user creates content (image, carousel, video, reel or story) in Naya's editorial calendar, picks a publish date, and Naya automatically creates a media container and publishes it to the user's professional Instagram account at the scheduled time, via `graph.instagram.com/{ig-user-id}/media` and `/media_publish`. This is the app's core feature: scheduled content publishing.

Adapte les deux textes à ce qui marche réellement au moment de la soumission (par exemple si les Stories ne sont pas encore en prod, ne les mentionne pas).
