# Refonte « Planification de contenu » — qualité Metricool/Later

**Objectif :** publier du contenu social de qualité pro depuis Naya (web **et** mobile) — image, **vidéo**, carrousel, **story** (IG/FB), **reel/short** — sur **Instagram, Facebook (Pages), LinkedIn (profils + pages entreprise) et TikTok**, avec composer multi-réseaux, calendrier/file d'attente, et publication programmée fiable. Fin de chantier visée : tout est **fonctionnel et démontrable** ; il ne reste qu'à fournir les clés API et passer les revues des plateformes.

**Décisions validées (2026-06-23) :** réseaux = IG + FB Page + LinkedIn (profil **et** organisation) + TikTok ; stockage = **Cloudflare R2** ; mobile = **parité complète**.

---

## 1. État actuel (constats)

- **Stockage médias cassé en prod** : `server/objectStorage.ts` est codé en dur pour le sidecar Replit (`127.0.0.1:1106`), absent sur Railway → aucun upload (même image) ne marche en prod. **Fondation à refaire.**
- **Web** : composer mono-réseau, aperçus image only (IG/LinkedIn/Twitter), pas de format (feed/story/reel), pas de multi-réseaux, pas de file d'attente. (`client/src/pages/content-calendar.tsx`)
- **Mobile** : aucune fonction de publication (tâches + capture + companion uniquement).
- **Backend** (`social-integrations.ts`, `social-publisher.ts`) : seulement image-feed IG + LinkedIn ; FB en lien (pas vraie photo) ; Twitter stub ; **aucune vidéo/story/reel/carrousel** ; **aucun TikTok**. Graph API v23.0.
- **Modèle de données** (`content`) : pas de `postFormat`/placement, pas de regroupement multi-réseaux, métadonnées vidéo inutilisées.
- **LinkedIn** : l'OAuth crée déjà des comptes séparés profil + `linkedin_page_<id>` (pages) — à exploiter.

---

## 2. Matrice cible par réseau

| Réseau | Feed image | Feed vidéo | Carrousel | Story | Reel/Short | Notes |
|---|:--:|:--:|:--:|:--:|:--:|---|
| Instagram (Business) | ✅ | ✅ | ✅ | ✅ | ✅ | Graph API ; conteneurs média + publication async pour la vidéo |
| Facebook Page | ✅ | ✅ | ✅ | ✅ | ✅ | `/photos`, `/videos`, stories, reels |
| LinkedIn profil | ✅ | ✅ | ✅ (multi-image) | ❌ | ❌ | `urn:li:person` ; pas de story sur LinkedIn |
| LinkedIn page entreprise | ✅ | ✅ | ✅ | ❌ | ❌ | `urn:li:organization` ; scope `w_organization_social` |
| TikTok | — | ✅ | — | — | ✅ | Content Posting API ; upload init → upload → publish |

**Règles par réseau** (centralisées) : formats autorisés, types média, durée/ratio/taille max, nb de médias, limites de légende. Ex. : story = 9:16 ; reel/TikTok = vidéo 9:16, durée bornée ; carrousel = 2–10 médias ; LinkedIn = pas de story.

---

## 3. Architecture

### 3.1 Stockage cloud (Cloudflare R2) — FONDATION
- Remplacer `objectStorage.ts` par un service **S3-compatible** (SDK `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`) pointant sur R2.
- **Upload direct navigateur/mobile → R2** via URL présignée (PUT), pour gros fichiers vidéo (pas de passage par le serveur).
- Sert les médias via le domaine public R2 (ou un domaine custom `media.hellonaya.app`).
- Vignettes vidéo : générées (côté client à l'upload, ou job serveur) et stockées.
- Env : `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL`.
- Limites d'upload relevées (vidéo : viser ~512 Mo–2 Go selon réseau).

### 3.2 Modèle de données
- **`content`** (post logique) : ajouter `postFormat` (`feed_image|feed_video|carousel|story|reel|short|text`), `mediaOrder` (jsonb ordonné d'IDs média), `videoMeta` (jsonb : durée, w, h, ratio, thumbnailUrl), `crossPostGroupId` (uuid).
- **Multi-réseaux** : un post coché pour N réseaux crée N lignes `content` partageant `crossPostGroupId`, chacune avec son `platform`, `postFormat`, `socialAccountId`, légende et médias propres (personnalisables par réseau).
- **`mediaLibrary`** : déjà `mimeType/duration/width/height/thumbnailUrl` — exploiter + valider.
- État de publication async : enrichir `postStatus` (`pending|uploading|processing|posting|posted|failed`) + `providerContainerId` (conteneur IG/FB / publish_id TikTok) + `lastError`.

### 3.3 Moteur de règles (`shared/social-capabilities.ts`)
- Module **pur, partagé** UI ↔ backend : `capabilitiesFor(platform)`, `validatePost({platform, format, media, caption})` → erreurs lisibles. Testé (vitest).

### 3.4 Services de publication (réécriture `social-integrations.ts`)
- **Instagram** : conteneurs `media_type` IMAGE/VIDEO/REELS/STORIES ; carrousel (enfants → conteneur carrousel) ; **vidéo async** : créer conteneur → **poller `status_code=FINISHED`** → `media_publish`.
- **Facebook Page** : `/photos` (vraie image), `/videos` (vidéo, async), stories (`/photo_stories`, `/video_stories`), reels.
- **LinkedIn** : Posts API moderne (`/rest/posts`) ; **vidéo** (initializeUpload → upload → post) ; image ; multi-image ; auteur `person` **ou** `organization`.
- **TikTok** : OAuth Login Kit + **Content Posting API** (`/v2/post/publish/video/init/` → upload → statut). Mode sandbox/inbox pour démo avant audit.
- Tous : usage du **moteur de règles** avant envoi ; erreurs normalisées.

### 3.5 Worker (`social-publisher.ts`)
- Gérer les états async : reprendre les posts `processing` (poll conteneur/job), publier quand prêt, retries bornés, marquage `failed` + `lastError`.
- Conserver : claim atomique, fenêtre de grâce, plafond, multi-utilisateur (compte propre à chaque user), kill-switch.

### 3.6 Scopes / API
- Meta : `instagram_content_publish`, `instagram_basic`, `pages_manage_posts`, `pages_read_engagement` (+ Reels/Stories via mêmes scopes + endpoints). 
- LinkedIn : `w_member_social` (profil) + `w_organization_social` (pages) ; produits « Share on LinkedIn » + « Community Management ».
- TikTok : `video.upload`/`video.publish` (audit requis pour publication directe).

### 3.7 Composer web (refonte `content-calendar.tsx` + nouveaux composants)
- **Multi-réseaux** : sélection des comptes cibles ; contenu commun + **personnalisation par réseau** (onglets).
- **Sélecteur de format** par réseau (selon moteur de règles).
- **Upload image + vidéo** (R2 direct), aperçu vidéo + miniature, validation live (ratio/durée/taille/légende).
- **Aperçus réalistes** par format : feed, **story (9:16)**, reel, carrousel, par réseau.
- **Calendrier** (mois/semaine/jour) + **file d'attente** + heures recommandées + actions groupées.

### 3.8 Mobile (parité complète — `mobile/app`)
- Nouvel onglet/écran **Contenu** : calendrier + composer multi-réseaux + sélection média **depuis la pellicule** (`expo-image-picker`, vidéo incluse) + upload R2 direct + aperçus + connexion comptes sociaux (réutilise OAuth web via WebView/redirect).
- Réutilise le moteur de règles partagé + les endpoints backend.

---

## 4. Dépendances externes (fournies par Jeanne)
1. **Cloudflare R2** : bucket + clés API (Account ID, Access Key, Secret, nom bucket, URL publique). — *bloque la fondation*.
2. **TikTok** : Client Key + Client Secret de l'app TikTok Developers (déjà créée).
3. **Revues plateformes** (après code complet, démontrées sur ses comptes) : Meta App Review (IG/FB publish, Reels/Stories), audit TikTok (publication directe), LinkedIn products. Le code est complet et démontrable avant approbation.

---

## 5. Plan par phases (chaque phase = livrable testable)
- **P0 — Stockage R2** : nouveau service S3/R2, upload direct image **et** vidéo, médiathèque fonctionnelle en prod, vignettes. *(débloque tout)*
- **P1 — Données + moteur de règles** : schéma (postFormat, crossPostGroup, videoMeta, états async) + `social-capabilities.ts` testé.
- **P2 — Composer web** : multi-réseaux, formats, upload vidéo, aperçus, calendrier/file d'attente.
- **P3 — Publication réelle** : IG/FB (image, vidéo async, carrousel, story, reel), LinkedIn (profil+page, vidéo), worker async. Démontré sur comptes de Jeanne.
- **P4 — TikTok** : OAuth + Content Posting API (sandbox → audit).
- **P5 — Mobile** : composer + calendrier + média pellicule + comptes, parité complète.

---

## 6. Sécurité / garde-fous
- Réutiliser le kill-switch + claim atomique + plafond d'envoi (cf. incident des publications accidentelles).
- Aucun envoi tant qu'un post n'est pas explicitement programmé/validé.
- Médias privés par défaut ; URLs publiques uniquement pour les médias destinés à publication.
- Clés (R2, TikTok) en variables Railway, jamais commitées.

---

## 7. Tests
- Unitaires (vitest) : moteur de règles (`validatePost`), helpers d'états async, mapping format→API.
- Intégration : upload R2 réel (présigné), publication réelle sur les comptes de Jeanne (IG/FB/LinkedIn) en P3, TikTok sandbox en P4.
- Le worker async testé sur conteneurs vidéo (poll → publish).
