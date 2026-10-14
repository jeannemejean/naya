# Les profils de veille — « ce qui marche dans ton secteur » — design

> Demande de Jeanne (14 oct. 2026) : « l'intelligence de Naya a besoin d'une meilleure veille […] aller regarder en permanence ce qui fonctionne sur le digital pour des marques qui correspondent à celle de l'utilisateur […] que tout ça fonctionne sous forme de personas pour éviter de dépenser trop en data ».
> Choix de Jeanne, validés un par un : profils **à deux niveaux** (recherche mutualisée par profil, tri léger par marque) ; signal v1 = **les formats qui performent** chez des marques comparables ; plateformes **Instagram + LinkedIn + TikTok** ; catalogue **posé par Jeanne et enrichi par Naya** (Jeanne valide) ; livraison **rendez-vous hebdo + injection dans la création** ; budget **≈ 10 € / profil / mois** (15 comptes par plateforme, collecte 3 fois par semaine) ; **approche 1** (module partagé à part).
> Archives de la réflexion sur les personas (2025 → 2026) : `Naya-Build/docs/archives-intelligence-persona/`.

## Constat

- Toute la veille actuelle est **par utilisatrice et par projet** : `reading_queries` (fiches du matin) et `veille_items` → `veille_releves` → `veille_constats` (concurrents, voix du client, SEO, GEO ; 1 passage / semaine, ≈ 2 € / mois / projet). Dix utilisatrices du même secteur paient dix fois la même recherche.
- Rien ne dit à une utilisatrice **quels formats marchent en ce moment dans son secteur**, preuves à l'appui.
- Les briques existent : collecte Instagram Bright Data (`brightdata-enrich.ts`, `triggerAndPoll`), engagement normalisé et « contenu fort » (`veille/concurrents-analyse.ts` : `engagementPosts`, `contenusForts`), ordonnanceur de routines (`services/routines/`), rôle `owner` (`user.role === "owner"`), consigne de post lue par l'atelier (`content.consigne`).
- Fil rouge des archives : « préférences de la cible → regroupées en persona » + « étude des marques et campagnes par secteur » (NAYA RESEARCH, 2025) ; « quelles actions ont mené des profils similaires à leurs objectifs » (périmètre MVP, 2025) ; « archétypes par type de business » (STRATEGIE-DONNEES). Ce design en pose la première brique.

## Vocabulaire

**Profil de veille** = un type de marque (« Coachs bien-être », « Marques mode éthique »). Ne pas confondre avec les deux « personas » existants : l'archétype de l'utilisatrice (`persona_analysis_results`, Stratège / Builder…) et sa cible (`target_personas`). Dans le code et l'interface : *profil de veille*, jamais *persona*.

## 1. Les profils et le rattachement

### Tables (aucune donnée privée d'utilisatrice)

| Table | Colonnes principales |
|---|---|
| `profils_veille` | `id`, `nom`, `description`, `criteres` jsonb (`{ typesBusiness[], cibles[], motsCles[] }`), `origine` (`jeanne` \| `naya`), `statut` (`propose` \| `actif` \| `en_pause` \| `archive`), `createdAt`, `updatedAt` |
| `profil_comptes` | `id`, `profilId`, `plateforme` (`instagram` \| `linkedin` \| `tiktok`), `compte` (handle normalisé), `url`, `libelle`, `statut` (`propose` \| `suivi` \| `ecarte` \| `injoignable`), `origine` (`naya` \| `jeanne` \| `suggestion`), `suggerePar` (userId, nullable), `createdAt` |
| `profil_rattachements` | `id`, `userId`, `projectId`, `profilId`, `confiance` (0–1), `raison`, `statut` (`propose` \| `confirme` \| `refuse`), `createdAt`, `updatedAt` — **unique (projectId)** en v1 : un profil par projet |

Plafond : **15 comptes `suivi` par profil et par plateforme**.

### Rattachement d'un projet

- Déclenché quand un projet actif obtient ou modifie son Brand DNA (et rattrapage au premier passage pour les projets existants).
- Naya compare le projet (Brand DNA du projet + Fondations validées) au catalogue des profils `actif` → sortie structurée `{ profilId | null, confiance, raison }`.
- **Confiance ≥ 0,7** : rattachement `propose` affiché dans l'onglet Veille du projet : « Naya suit pour toi les marques *Coachs bien-être*. » + « Ce n'est pas toi ? » (choisir un autre profil du catalogue) + « Suggérer un compte que tu admires » (crée un `profil_comptes` `propose`, `origine = suggestion`). Sans action, il compte comme accepté ; un refus le passe `refuse` et relance la comparaison en excluant ce profil.
- **Confiance < 0,7** (ou aucun profil) : Naya rédige une proposition de profil (`statut = propose`, `origine = naya`) avec nom, description, critères et jusqu'à 15 comptes suggérés par plateforme (recherche web/SERP existante + vérification que le compte existe). Elle part dans la file de validation de Jeanne. Le projet reste sans profil jusque-là.

### Espace d'administration (rôle `owner`)

Une page `/admin/profils-veille` : catalogue (créer, éditer, mettre en pause, archiver), propositions de Naya (valider / corriger / refuser), panels par plateforme (valider, écarter, remplacer un compte `injoignable`), suggestions des utilisatrices, tendances de la semaine (§3), coût du mois par profil et journal des passages.

### Garde-fou de dépense

Un profil n'est collecté que s'il est `actif` **et** qu'au moins un projet actif lui est rattaché (`propose` ou `confirme`). Un profil vide ne coûte rien.

## 2. La collecte

- **Rythme** : lundi, mercredi, vendredi à `HEURE_VEILLE_UTC` (5 h), via l'ordonnanceur de routines. Un passage = tous les profils collectables.
- **Par profil et par plateforme** : un seul déclenchement Bright Data avec les comptes `suivi` (collecte par lot), attente bornée du résultat. Un adaptateur par plateforme (`collecte/instagram.ts`, `collecte/tiktok.ts`, `collecte/linkedin.ts`) normalise la réponse en `PostCollecte`.
- **Table `profil_posts`** : `id`, `profilId`, `compteId`, `plateforme`, `url`, `cle` (empreinte de l'URL, unique par profil), `publieLe`, `typeMedia` (`image` \| `carrousel` \| `reel` \| `video` \| `texte` \| `document`), `legende`, `metriques` jsonb (`{ likes, commentaires, partages, vues, republications }`, absent ≠ zéro), `abonnes`, `engagement` (nullable), `fort` (bool, nullable), `format` jsonb (nullable, §3), `releveLe`, `createdAt`. **Aucun média stocké** : lien uniquement.
- Un post déjà vu est **mis à jour** (métriques, `releveLe`), jamais dupliqué.
- **Maturité** : un post n'est jugé (`engagement`, `fort`) qu'à partir de **48 h** après publication ; avant, il est relevé mais `fort = null`.
- **Engagement normalisé** (fonction pure par plateforme ; une métrique absente rend l'engagement `null`, jamais 0) :

| Plateforme | Formule |
|---|---|
| Instagram | (likes + commentaires) ÷ abonnés |
| TikTok | (likes + commentaires + partages) ÷ vues |
| LinkedIn | (réactions + commentaires + republications) ÷ abonnés |

- **Contenu fort** : engagement > **2 × la médiane** des 30 derniers posts mûrs **du même compte** (au moins 8 posts mûrs connus, sinon `fort = null`). Chaque marque est comparée à elle-même.
- **Best-effort** : une plateforme en échec n'arrête pas les autres ; un compte introuvable ou privé deux passages de suite passe `injoignable` (visible dans l'admin). Chaque passage écrit une ligne `profil_passages` : `profilId`, `plateforme`, `comptes`, `postsNouveaux`, `postsMisAJour`, `echecs`, `erreur`, `coutEur`, `createdAt`.
- **Coût imputé au profil** (`profil_passages.coutEur`, estimé par compte collecté selon le tarif du collecteur, et `profil_depenses` mensuelles incluant l'IA du §3). **Plafond dur 10 € / profil / mois** (constante) : atteint → plus de collecte ni d'analyse pour ce profil jusqu'au mois suivant, signalé dans l'admin.
- **Rétention** : les `profil_posts` de plus de 90 jours sont supprimés (routine hebdo) ; les tendances restent.
- **À vérifier dans le plan** : identifiants et champs des collecteurs Bright Data LinkedIn et TikTok (publications d'un compte, abonnés, vues), et le prix réel par compte. Si 15 × 3 × 3 passages ne tient pas dans 10 €, réduire d'abord la fréquence de la plateforme la plus chère.

## 3. L'analyse des formats (hebdomadaire, le dimanche)

### Étape 1 — nommer le format

- Chaque post mûr des **14 derniers jours** (forts **et** autres) sans `format` est classé par le modèle rapide (sortie structurée), à partir de `typeMedia` + `legende` :
  `format = { structure, accroche }` dans un **vocabulaire fixe** (constantes partagées) :
  - `structure` : `tutoriel`, `avant_apres`, `coulisses`, `temoignage_client`, `liste`, `histoire_personnelle`, `prise_de_position`, `erreur_courante`, `presentation_offre`, `tendance_reprise`, `question_communaute`, `autre` ;
  - `accroche` : `chiffre`, `question`, `promesse`, `erreur`, `contre_intuitif`, `histoire`, `aucune`, `autre` ;
  - `autreLibelle` (texte court) quand `autre`.
- Un format = `typeMedia × structure` (+ l'accroche dominante, pour l'explication). Les `autreLibelle` qui reviennent (≥ 3 fois sur 4 semaines) sont proposés à Jeanne dans l'admin pour enrichir le vocabulaire.

### Étape 2 — compter (code pur, sans IA)

Par profil, plateforme et format, sur les posts mûrs des 14 derniers jours dont `fort` n'est pas `null` :
- `taux_format` = forts du format ÷ posts du format ; `taux_global` = forts ÷ posts ; **`lift`** = `taux_format ÷ taux_global`.
- **Seuil anti-hasard** : retenu si `lift ≥ 1,5`, **au moins 3 contenus forts** dans le format, venant d'**au moins 2 comptes différents**.

### Étape 3 — écrire les tendances

- Pour chaque format retenu, le modèle « raisonnement » (via l'**API Batch**, 50 % moins cher) rédige une fiche (sortie structurée) dans `profil_tendances` : `id`, `profilId`, `semaine` (lundi ISO), `plateforme`, `typeMedia`, `structure`, `accrocheDominante`, `lift`, `nbForts`, `nbComptes`, `exemples` (2–3 URLs de contenus forts, de comptes différents), `pourquoi` (formulé comme hypothèse), `commentAdapter`, `statut` (`nouveau` \| `confirme` \| `en_baisse`), `ecarteParJeanne` (bool), `createdAt`.
- `statut` : `nouveau` si absent la semaine précédente ; `confirme` si présent ; un format retenu la semaine précédente et absent cette semaine mais encore `lift ≥ 1` → `en_baisse` (fiche courte, sans nouvel appel IA).
- **Zéro tendance est une sortie normale** : la semaine affiche « Rien de net cette semaine dans ton secteur. » Jamais de remplissage.
- Jeanne peut écarter une tendance dans l'admin ; sans action, elle est diffusée.
- **Limite v1 assumée** : pas d'analyse d'image ni de vidéo ; la structure est lue dans la légende et le type de post.

## 4. Le rendez-vous hebdo et l'injection

### Tri par marque (lundi, après l'analyse)

Pour chaque projet rattaché : le modèle rapide (sortie structurée) choisit **au plus 5** tendances non écartées de la semaine, en tenant compte des plateformes du projet (Brand DNA `platformPriority`), de son offre et de sa cible, et écrit **une phrase d'adaptation** propre à la marque. Table `tendances_projet` : `id`, `userId`, `projectId`, `tendanceId`, `adaptation`, `statut` (`nouveau` \| `vu` \| `garde` \| `utilise` \| `ecarte`), `contentId` (nullable), `createdAt`, `expireLe` (création + 28 jours). Zéro retenue = valide. Coût imputé à l'utilisatrice (garde-fou `usage.ts`).

### « Ce qui marche dans ton secteur »

- Dans l'**onglet Veille** de la page projet, et une carte sur le tableau de bord le lundi.
- Chaque tendance : format, plateforme, chiffre (« forts 3,1 fois plus souvent que la moyenne, 14 derniers jours »), 2–3 exemples (liens), pourquoi, adaptation pour la marque.
- Actions :
  - **En faire un post** → crée un `content` pour le projet (plateforme de la tendance, `consigne` = format + adaptation, `tendanceProjetId`), qui arrive dans l'atelier de la semaine (rédigé à l'ouverture comme les autres) ; statut `utilise`.
  - **Écarter** → `ecarte` ; le tri des semaines suivantes n'en propose plus de même `plateforme × typeMedia × structure` à ce projet pendant 8 semaines. **Aucune écriture en mémoire en v1.**
  - **Garder** → `garde` : épinglée, n'expire pas.
- Les tendances non traitées disparaissent en silence à `expireLe`. Aucun compteur, aucune série, aucune relance.

### Injection dans la création de contenu

- `tendancesPourLeContenu(userId, projectId, plateforme)` → bloc court (≤ 5 tendances de **la plateforme du post**, statuts `nouveau` \| `vu` \| `garde`, ≈ 600 caractères), passé en `additionalSystemContext` **uniquement** dans : la rédaction de l'atelier, le contenu de campagne, la génération et la régénération de post, le post de remplacement. **Pas dans `buildNayaContext()`.**
- Consigne au modèle : s'en inspirer quand c'est pertinent, jamais par obligation ; **ne jamais copier** un exemple ; si le post suit une tendance, renvoyer son identifiant (champ de la sortie).
- Traçabilité : `content.tendanceId` (nullable) quand le post s'inspire d'une tendance (via « En faire un post » ou renvoyé par la rédaction). L'atelier affiche « Format inspiré de : carrousel avant/après (×3,1 dans ton secteur) ». Prépare la mesure future (fil 3 : les posts inspirés d'une tendance marchent-ils mieux pour elle ? puis agrégat par profil) — **hors v1**.

## 5. Coûts, garde-fous, qualité, livraison

- **Coût** : ≤ 10 € / profil / mois (collecte + analyse), plafond dur ; tri par marque sous le garde-fou par utilisatrice. Au démarrage : les profils des marques de Jeanne (≈ 10–20 € / mois).
- **Cadre** : comptes publics de marques et de créateurs professionnels uniquement ; minimum stocké (lien, type, légende, métriques) ; posts bruts supprimés à 90 jours ; collecte par Bright Data comme la veille existante.
- **Sorties structurées** : petite extension de `NayaModelProvider` (`generate` accepte un schéma et renvoie un objet validé ; adaptateur Anthropic via `output_config.format`, à vérifier sur la version du SDK) + support du **Batch** pour l'étape 3. Réutilisable par tout Naya ensuite.
- **Prompts en français**, appels journalisés (`logInvocation`, `projectId` quand il existe), **aucun repli silencieux** : un échec est écrit dans `profil_passages` / visible dans l'admin.
- **Banc d'évaluation du classement** : Jeanne étiquette **40 posts réels** (structure + accroche) dans l'admin ; un script compare le classement de Naya (accord attendu ≥ 75 % sur `structure`) avant d'ouvrir le lot 1 aux utilisatrices. Premier élément du banc d'évaluation de l'audit du 14 oct.
- **Code** : règles pures d'abord, testées (engagement par plateforme, maturité, contenu fort, lift et seuil anti-hasard, statut des tendances, expiration, filtre des écartées, plafond de dépense) ; dépendances injectées (`deps.ts`) comme `veille/` et `atelier/` ; dossier `server/services/profils-veille/` ; routes dans `server/routes-profils-veille.ts` ; `npx tsc --noEmit` à zéro.
- **Migrations** : `drizzle-kit generate` → relecture ligne par ligne → `db:migrate`. Jamais de `db:push`. Tables nouvelles + colonnes nullables `content.tendanceId`, `content.tendanceProjetId`.

### Ordre de livraison

1. **Lot 1 — socle + Instagram** : tables, rattachement, admin, collecte Instagram, analyse, banc d'évaluation, rendez-vous, injection. Utilisable de bout en bout.
2. **Lot 2 — TikTok** : adaptateur de collecte + engagement TikTok.
3. **Lot 3 — LinkedIn** : adaptateur de collecte + engagement LinkedIn.

Chaque lot démarre quand le précédent tourne et que son coût réel est mesuré.

### Hors périmètre v1 (préparé)

Analyse des visuels et des vidéos ; agrégat « ce qui marche pour les utilisatrices Naya d'un même profil » ; création de profils par regroupement automatique ; actualité du secteur et tendances de plateforme dans ces profils.
