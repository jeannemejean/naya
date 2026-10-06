# Savoir de Naya : dossiers PDF, relecture effective, page dédiée — conception

**Date :** 6 octobre 2026

> Demande : « un endroit, accessible seulement depuis mon compte, où je puisse envoyer des fichiers PDF que Naya puisse lire et traiter afin d'être plus spécialisée sur certains sujets, notamment la communication digitale ». Portée choisie : **toutes les marques**.

## Constat

- Le dépôt existe (`POST/GET /api/savoir/dossiers`, réservé `role === "owner"`, `server/services/memory/deposer-dossier.ts` → `memory_entries` fil `savoir`, `projectId` null), avec une carte « Ce que Naya a appris » **en bas des Réglages**, **texte collé seulement**.
- **Défaut :** `server/services/memory/retrieve.ts` `fetchCandidates` scope tout fil autre que `founder` à `project_id IS NOT DISTINCT FROM projectId`. Les dossiers `savoir` (project_id null) ne sont donc relus **que hors marque** ; dès que Naya travaille sur une marque (cas courant), ils sont ignorés.
- La génération de campagne (`generateCampaignStrategy` / `generateCampaignContent`, `server/services/openai.ts`) n'appelle pas `buildNayaContext` (choix du 2 oct. 2026) : elle ne lit aucun savoir.
- Aucune bibliothèque PDF installée. `multer` (mémoire, 10 Mo) est déjà configuré dans `server/routes.ts`.
- Pas de retrait de dossier.

## Ce qu'on construit

1. **Relecture effective** : fil `savoir` → `project_id IS NULL OR project_id = <marque courante>` (le savoir « toutes marques » toujours lu ; un éventuel dossier rattaché à une marque réservé à elle).
2. **Campagnes** : la génération de stratégie et de contenu de campagne reçoit les morceaux de savoir les plus proches du sujet de la campagne (même récupération que `buildNayaContext`, fil `savoir` seulement), dans une section dédiée du prompt. Seul le savoir est ouvert ; le reste de la mémoire reste hors du chemin campagne.
3. **PDF** : `POST /api/savoir/pdf` (owner, `multipart/form-data`, champ `fichiers`, 1 à 10 fichiers, 10 Mo chacun, `application/pdf` seulement) → extraction du texte côté serveur (`unpdf`) → `deposerDossier({ titre: nom du fichier sans extension, contenu })`. Par fichier : `depose` (morceaux), ou `pas_de_texte` (PDF scanné/vide), ou `illisible` (fichier corrompu), ou `pas_un_pdf`. Rien n'est écrit pour un fichier en échec.
4. **Retrait** : `DELETE /api/savoir/dossiers` corps `{ titre }` (owner) → les morceaux du dossier reçoivent `supersededAt = now()` (jamais supprimés) ; `listerDossiers` et la relecture ignorent déjà les morceaux périmés (à vérifier, sinon ajouter le filtre).
5. **Page « Savoir de Naya »** (`/savoir`), lien dans le menu **pour le compte propriétaire uniquement** ; remplace la carte des Réglages : dépôt de PDF (glisser-déposer ou bouton, plusieurs fichiers, résultat par fichier), texte collé (titre + contenu), liste des dossiers (titre, morceaux, date) avec « Retirer » et confirmation dans la page.

## Ce qu'on ne construit pas

- Pas d'OCR (PDF scannés refusés avec un message clair).
- Pas de rattachement d'un dossier à une marque dans l'interface (portée « toutes les marques »). L'API garde la possibilité technique existante.
- Pas d'ouverture du reste de la mémoire (cap, founder, réception) à la génération de campagne.

## Erreurs

- Un fichier en échec n'empêche pas les autres ; la réponse détaille chaque fichier.
- Embedding best-effort (comportement actuel de `deposerDossier`).
- Non-propriétaire → 403 sur toutes les routes savoir ; la page n'est pas accessible (redirection ou message).

## Tests

- Relecture : un morceau `savoir` project_id null est candidat quand `projectId = 15` ; un morceau `savoir` d'une autre marque ne l'est pas ; `cap` inchangé.
- Extraction : PDF avec texte → texte ; PDF sans texte → `pas_de_texte` ; données non-PDF → `pas_un_pdf`/`illisible` (fixtures PDF minimales générées dans le test).
- Routes : 403 non-propriétaire ; 400 sans fichier ; résultat par fichier ; retrait → morceaux périmés.
- Campagnes : le savoir trouvé est injecté dans le prompt de stratégie et de contenu (mock de la récupération).
- Aucun test contre la production.
