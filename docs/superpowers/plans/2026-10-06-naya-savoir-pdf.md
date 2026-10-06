# Savoir de Naya — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dossiers PDF déposés par la propriétaire, relus quelle que soit la marque, utilisés aussi par la génération de campagne, gérés depuis une page dédiée.

**Architecture:** correction de portée dans `retrieve.ts` ; service d'extraction `server/services/memory/extraire-pdf.ts` (`unpdf`) ; routes savoir étendues ; injection du savoir dans `generateCampaignStrategy`/`generateCampaignContent` via un paramètre optionnel ; page React `/savoir`.

**Tech Stack:** Express + multer (mémoire), Drizzle/pgvector, `unpdf`, React + TanStack Query + react-i18next + wouter.

**Spec:** `docs/superpowers/specs/2026-10-06-naya-savoir-pdf-design.md`

## Global Constraints

- Toutes les routes savoir : `isAuthenticated` + `storage.getUser(req.userId)?.role === "owner"` sinon 403 `forbidden`.
- PDF : champ `fichiers`, 1 à 10 fichiers, ≤ 10 Mo chacun, `mimetype === "application/pdf"` **et** signature `%PDF-` en tête de buffer ; statut par fichier ∈ `depose | pas_de_texte | illisible | pas_un_pdf | trop_lourd` ; un texte extrait de moins de 200 caractères non blancs = `pas_de_texte`.
- Titre d'un dossier PDF = nom du fichier sans `.pdf`, trimé, ≤ 200 caractères.
- Retrait = `supersededAt = now()` sur les morceaux du dossier (`fil = 'savoir'`, `userId`, contenu commençant par `"<titre> — "`), jamais de DELETE.
- Savoir relu : `project_id IS NULL OR project_id = <projectId>` pour le fil `savoir` uniquement ; autres fils inchangés.
- Campagnes : au plus 3 morceaux de savoir (TOP_K actuel du fil), section de prompt intitulée `CE QU'ON T'A APPRIS (recherche déposée)` ; absence/échec de récupération → prompt inchangé, jamais d'erreur.
- Page `/savoir` et lien de menu visibles **uniquement** si `user.role === "owner"`.
- UI via `t()` FR + EN, gardes i18n vertes, aucune chaîne en dur dans un fichier nouveau.
- Tests `DATABASE_URL=postgresql://test:test@127.0.0.1:1/test` ; `npx tsc --noEmit` à zéro ; `npx vite build` OK. Commits en français + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. **Jamais de push**, aucune vraie base. Dépendance ajoutée : `unpdf` (npm install, lockfile commité).

## Review Focus

- **Gros PDF (300 pages)** : extraction et découpage sans bloquer d'autres requêtes de façon déraisonnable ; limite de 10 Mo appliquée par multer avant extraction. → test de taille via multer + note.
- **Nom de fichier avec accents / extension en majuscules (`.PDF`)** → titre propre. → test.
- **Même PDF déposé deux fois** : deux dossiers identiques (pas de déduplication) — documenté, ou refus si un dossier de même titre existe ? → **refus** `deja_depose` si un dossier non retiré du même titre existe. → test.
- **Retrait puis re-dépôt du même titre** : autorisé. → test.
- **Un fichier en échec au milieu d'un lot** : les autres sont déposés. → test.

---

### Task 1 : Relecture du savoir quelle que soit la marque
**Files:** Modify `server/services/memory/retrieve.ts` (`fetchCandidates`). Test : nouveau ou existant (grep `retrieve.test`).
- [ ] Extraire la condition de portée en fonction pure `porteeFil(fil, projectId)` (rend un fragment SQL) ou tester via un mock de `db.execute` qui capture la requête ; tests : savoir + projectId 15 → inclut `project_id IS NULL OR project_id = 15` ; founder → `IS NULL` ; cap → `IS NOT DISTINCT FROM`.
- [ ] Vérifier que `listerDossiers` et la récupération excluent `superseded_at IS NOT NULL` (ajouter le filtre à `listerDossiers` si absent).
- [ ] commit.

### Task 2 : Extraction PDF + routes (dépôt, retrait)
**Files:** `npm install unpdf` ; Create `server/services/memory/extraire-pdf.ts` (+ test) ; Modify `server/services/memory/deposer-dossier.ts` (ajout `retirerDossier(userId, titre)` et `dossierExiste(userId, titre)`), `server/routes.ts` (`POST /api/savoir/pdf`, `DELETE /api/savoir/dossiers`). Test routes : `server/routes.savoir.test.ts` (harnais de `server/routes.task-lock.test.ts`, mocks de `./services/memory/deposer-dossier` et `./services/memory/extraire-pdf`).
- [ ] `extraireTextePdf(buffer: Buffer): Promise<{ statut: "ok"; texte: string } | { statut: "pas_un_pdf" | "illisible" | "pas_de_texte" }>` — signature `%PDF-`, `unpdf` (`extractText(new Uint8Array(buffer), { mergePages: true })`), seuil 200 caractères. Tests : génère un PDF minimal avec texte dans le test (chaîne PDF écrite à la main ou via `unpdf`/pdf-lib si disponible — sinon fixture minimale en base64 dans le test), buffer non-PDF, PDF sans texte.
- [ ] `titreDepuisNomFichier(nom)` pur (+ tests : accents, `.PDF`, chemins).
- [ ] Route PDF : multer `upload.array('fichiers', 10)` (réutiliser l'instance existante, 10 Mo) ; erreur multer de taille → statut `trop_lourd` pour le lot (400 `fichier_trop_lourd`) ; par fichier : type/signature → extraction → `dossierExiste` → `deposerDossier` ; réponse `{ resultats: [{ fichier, titre, statut, morceaux? }] }`.
- [ ] Route retrait : `{ titre }` string non vide sinon 400 ; `retirerDossier` → `{ retires: n }` ; 0 → 404.
- [ ] Le dépôt texte existant refuse aussi un titre déjà présent (`deja_depose`, 409) — cohérence.
- [ ] commit(s).

### Task 3 : Savoir dans la génération de campagne
**Files:** Modify `server/services/openai.ts` (`generateCampaignStrategy`, `generateCampaignContent` : paramètre optionnel `savoir?: string` injecté dans le prompt sous l'intitulé imposé), `server/routes.ts` (`/api/campaigns/generate/strategy` et `/api/campaigns/generate/content` : récupérer `retrieveMemories(userId, projectId, <texte focus : objectif + nom de campagne>)` → `.savoir` → texte formaté ; échec → undefined).
- [ ] Tests : prompt contient la section quand du savoir est fourni ; absent sinon (mock de l'appel modèle) ; route : échec de récupération → génération quand même.
- [ ] commit.

### Task 4 : Page « Savoir de Naya »
**Files:** Create `client/src/pages/savoir.tsx` ; Modify `client/src/App.tsx` (route `/savoir`), `client/src/components/sidebar.tsx` (lien owner-only), `client/src/pages/settings.tsx` (retirer `DossiersSavoirCard` et son code mort), `client/src/locales/fr.ts`, `en.ts` (section `savoirPage`, réutiliser/déplacer les clés `settingsPage.savoir.*` utiles ; supprimer les clés devenues inutilisées seulement si la garde `keys-exist` le permet).
- [ ] Dépôt PDF : zone glisser-déposer + bouton (input `accept="application/pdf"` multiple), envoi `FormData` via `fetch` (credentials include), résultat par fichier (libellés : déposé — n morceaux / pas de texte lisible / fichier illisible / pas un PDF / trop lourd / déjà déposé).
- [ ] Texte collé : titre + contenu (comportement actuel).
- [ ] Liste : titre, morceaux, date ; « Retirer » → confirmation dans la page (pas de `confirm()`) → `DELETE` → invalidation.
- [ ] Non-propriétaire : la route `/savoir` affiche un message « réservé » et le lien n'apparaît pas.
- [ ] tsc, gardes i18n, suite, build ; commit.
