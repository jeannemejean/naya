# Refonte « cocon » de Naya Web — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** donner à Naya Web l'atmosphère « cocon » validée par Jeanne : fondations de style et saisons, navigation en pilule à 5 espaces, nouvel accueil « Aujourd'hui ».

**Architecture :** une source unique des saisons (`shared/saisons.ts`, pure) alimente des variables CSS posées sur `<html>` ; tous les composants lisent des variables. La pilule remplace le composant `Sidebar` à l'identique de son interface (les 18 pages qui l'utilisent basculent d'un coup) ; un module pur `espaces.ts` rattache chaque adresse à un espace. L'accueil est une nouvelle page composée de petits blocs indépendants, qui réutilise le brief du jour, les tâches, la capture et `TaskWorkspace` existants.

**Tech Stack :** React 18 + wouter + TanStack Query, Tailwind + shadcn/ui, Express, Drizzle/Neon, Vitest (environnement `node`), polices Google Fonts.

**Spec :** `docs/superpowers/specs/2026-10-16-refonte-cocon-design.md` (lire en entier avant toute tâche).

**Répertoire de travail :** `/Users/jeannemejean/Desktop/Naya-Build/NayaVision-29/.claude/worktrees/refonte-cocon`, branche `feat/refonte-cocon`. Avant la première commande : `ln -s ../../../node_modules node_modules` et `cp ../../../.env .env` si absents.

## Global Constraints

- `npx tsc --noEmit` à zéro erreur après chaque tâche.
- `npx vitest run <fichiers touchés>` vert après chaque tâche ; suite complète `npm test` aux points de contrôle.
- Textes d'interface en français, voix de Naya (tutoiement, jamais « Super ! », « Il semble que… »). Les nouvelles chaînes passent par `client/src/locales/fr.ts` **et** `en.ts` (les tests `client/src/locales/*.test.ts` l'exigent).
- Lisibilité : texte courant ≥ 16 px, interlignage 1,6, échelle 13 / 16 / 17 / 22 / 28 / 36 px, contraste ≥ 4,5:1, cibles ≥ 44 × 44 px, focus visible, animations 150–300 ms coupées sous `prefers-reduced-motion`.
- Lora (500) seulement à 28 px et plus ; Nunito Sans (400 / 600) partout ailleurs. Icônes : Lucide uniquement, aucun emoji.
- Couleurs fixes : encre `#2F2A22`, secondaire `#5E5546`, ancre sombre `#2E2A24` (texte dessus `#F6EFE3`), surface carte `#FFFBF3`, ombre `0 8px 24px rgba(90, 65, 30, 0.08)`. Aucun texte en couleur de saison.
- Arrondis : 12 px champs, 20 px cartes, 28 px grands blocs, `9999px` pilules.
- Migrations : `npx drizzle-kit generate`, relecture du SQL ligne par ligne, `npm run db:migrate` sur la base de dev **uniquement**. **Jamais `drizzle-kit push`. Jamais de migration en production dans ce plan** : c'est une étape manuelle décidée par Jeanne, avec sauvegarde Neon (voir `MIGRATIONS.md`).
- Chaque appel IA garde `callClaudeWithContext` (donc `buildNayaContext`).
- Ne jamais afficher de secret ni d'URL de base dans une sortie.

## Review Focus

1. **Le fuseau autour de minuit** : à 00:30 heure de Paris le 21 déc. (23:30 UTC le 20), la saison est l'hiver et « aujourd'hui » est le 21 → test dans la tâche 1.
2. **Une préférence `apparence` malformée** envoyée au PATCH (`{ saison: "noel", decor: "oui" }`, `null`, chaîne) ne doit ni planter ni être enregistrée telle quelle → normalisée au défaut, test dans la tâche 2.
3. **Le mode « tous les projets »** (`activeProjectId` nul) : les capsules Veille et Chiffres ne font aucune requête et ne s'affichent pas, l'accueil reste complet → test dans la tâche 10 (`capsulesAffichables`), vérification dans la tâche 11.
4. **Une journée dont toutes les tâches sont faites, ou dont aucune n'a d'heure** : la prochaine étape reste juste (« Ta journée est faite. Profite. », ou la tâche sans heure la plus prioritaire) → tests dans la tâche 10.
5. **Des titres et un mot du matin trop longs** à 375 px : rien ne déborde de la pilule ni de la photo (2 lignes au plus, coupées proprement) → vérification à 375 px dans la tâche 11.

---

# Étape 1 — Les fondations

### Task 1 : la source unique des saisons

**Files :**
- Create : `shared/saisons.ts`
- Test : `shared/saisons.test.ts`

**Interfaces :**
- Produces :
  - `type Saison = "automne" | "hiver" | "printemps" | "ete"`
  - `interface Apparence { saison: "auto" | Saison; decor: boolean }` ; `const APPARENCE_DEFAUT: Apparence = { saison: "auto", decor: true }`
  - `interface PaletteSaison { fond: string; touche1: string; touche2: string; motif: string /* valeur CSS background */; libelle: string }` ; `const PALETTES: Record<Saison, PaletteSaison>`
  - `const COULEURS = { encre: "#2F2A22", secondaire: "#5E5546", ancre: "#2E2A24", surAncre: "#F6EFE3", carte: "#FFFBF3" } as const`
  - `saisonDuJour(maintenant: Date, fuseau: string): Saison`
  - `saisonEffective(apparence: Apparence, maintenant: Date, fuseau: string): Saison`
  - `normaliserApparence(v: unknown): Apparence`
  - `const PHOTOS_SAISON: Record<Saison, string[]>` (chemins publics `/saisons/<saison>/<n>.webp`, tableaux vides au départ)
  - `photoDuJour(saison: Saison, maintenant: Date, fuseau: string): string | null`
  - `rapportContraste(a: string, b: string): number` (WCAG 2.1, hex `#RRGGBB`)

Valeurs de la spec : automne `fond #F3EADB`, `touche1 #C07A47`, `touche2 #D9B98A`, motif carreaux ; hiver `#F1EEE8`, `#5F7189`, `#C9D3DF`, vichy ; printemps `#F6F0E1`, `#EBD58A`, `#A9B79A`, fine rayure ; été `#F7F1E6`, `#7F9CB8`, `#E6D3B3`, large rayure. Bornes (date locale du fuseau) : printemps 20 mars → 20 juin, été 21 juin → 20 sept., automne 21 sept. → 20 déc., hiver 21 déc. → 19 mars. Les motifs reprennent les `repeating-linear-gradient` de la maquette validée, avec `touche1` à 20–25 % d'opacité sur `COULEURS.carte`.

- [ ] **Step 1 : écrire les tests qui échouent**

```ts
describe("saisonDuJour", () => {
  const P = "Europe/Paris";
  it.each([
    ["2026-03-19T12:00:00Z", "hiver"], ["2026-03-20T12:00:00Z", "printemps"],
    ["2026-06-20T12:00:00Z", "printemps"], ["2026-06-21T12:00:00Z", "ete"],
    ["2026-09-20T12:00:00Z", "ete"], ["2026-09-21T12:00:00Z", "automne"],
    ["2026-12-20T12:00:00Z", "automne"], ["2026-12-21T12:00:00Z", "hiver"],
    ["2027-01-15T12:00:00Z", "hiver"],
  ])("%s → %s", (iso, attendu) => expect(saisonDuJour(new Date(iso), P)).toBe(attendu));
  it("suit le fuseau autour de minuit (00:30 à Paris le 21 déc.)", () =>
    expect(saisonDuJour(new Date("2026-12-20T23:30:00Z"), P)).toBe("hiver"));
  it("même instant, fuseau UTC → encore l'automne", () =>
    expect(saisonDuJour(new Date("2026-12-20T23:30:00Z"), "UTC")).toBe("automne"));
  it("fuseau invalide → Europe/Paris", () =>
    expect(saisonDuJour(new Date("2026-12-20T23:30:00Z"), "Pas/UnFuseau")).toBe("hiver"));
});

describe("saisonEffective", () => {
  const oct = new Date("2026-10-16T08:00:00Z");
  it("auto → saison du jour", () => expect(saisonEffective({ saison: "auto", decor: true }, oct, "Europe/Paris")).toBe("automne"));
  it("forcée → la saison choisie", () => expect(saisonEffective({ saison: "ete", decor: true }, oct, "Europe/Paris")).toBe("ete"));
});

describe("normaliserApparence", () => {
  it.each([null, undefined, "x", 3, [], { saison: "noel", decor: "oui" }])("%j → défaut", (v) =>
    expect(normaliserApparence(v)).toEqual(APPARENCE_DEFAUT));
  it("garde les champs valides, complète le reste", () => {
    expect(normaliserApparence({ saison: "hiver" })).toEqual({ saison: "hiver", decor: true });
    expect(normaliserApparence({ decor: false })).toEqual({ saison: "auto", decor: false });
  });
});

describe("photoDuJour", () => {
  it("aucune photo → null", () => expect(photoDuJour("automne", new Date(), "Europe/Paris")).toBeNull());
});

describe("contrastes (règle de la spec : ≥ 4,5:1)", () => {
  for (const [s, p] of Object.entries(PALETTES)) {
    it(`${s} : encre et secondaire sur le fond`, () => {
      expect(rapportContraste(COULEURS.encre, p.fond)).toBeGreaterThanOrEqual(4.5);
      expect(rapportContraste(COULEURS.secondaire, p.fond)).toBeGreaterThanOrEqual(4.5);
    });
    it(`${s} : encre sur la touche claire`, () => expect(rapportContraste(COULEURS.encre, p.touche2)).toBeGreaterThanOrEqual(4.5));
  }
  it("texte secondaire sur la carte", () => expect(rapportContraste(COULEURS.secondaire, COULEURS.carte)).toBeGreaterThanOrEqual(4.5));
  it("texte clair sur l'ancre sombre", () => expect(rapportContraste(COULEURS.surAncre, COULEURS.ancre)).toBeGreaterThanOrEqual(4.5));
});
```

- [ ] **Step 2 : lancer, constater l'échec** — `npx vitest run shared/saisons.test.ts` → échec « Cannot find module './saisons' ».
- [ ] **Step 3 : implémenter `shared/saisons.ts`** — date locale via `Intl.DateTimeFormat(…, { timeZone, year, month, day })` dans un `try` (repli `Europe/Paris`) ; comparaison sur `mois * 100 + jour`. `photoDuJour` : index = jour de l'année locale modulo le nombre de photos. Si un contraste échoue, **le signaler** (ne pas modifier une couleur de la spec sans accord de Jeanne).
- [ ] **Step 4 : relancer** — même commande → PASS.
- [ ] **Step 5 : commit** — `git add shared/saisons.ts shared/saisons.test.ts && git commit -m "feat(saisons): source unique des saisons, palettes et contrastes"`

### Task 2 : la préférence `apparence`

**Files :**
- Modify : `shared/schema.ts` (table `userPreferences`, après `language`)
- Create : `migrations/0032_*.sql` (généré), `server/services/apparence.ts`
- Modify : `server/routes.ts` (`app.patch('/api/preferences'…)` ~ligne 2306)
- Test : `server/services/apparence.test.ts`

**Interfaces :**
- Consumes : `normaliserApparence`, `APPARENCE_DEFAUT` (tâche 1).
- Produces : colonne `apparence: jsonb("apparence").$type<Apparence>().notNull().default(APPARENCE_DEFAUT)` ; `assainirPatchPreferences(corps: unknown): Record<string, unknown>` — renvoie le corps tel quel sauf `apparence`, remplacée par `normaliserApparence(corps.apparence)` quand la clé est présente ; un corps non objet → `{}`.

- [ ] **Step 1 : tests qui échouent**

```ts
it("normalise une apparence malformée", () =>
  expect(assainirPatchPreferences({ apparence: { saison: "noel", decor: "oui" } })).toEqual({ apparence: { saison: "auto", decor: true } }));
it("laisse passer les autres champs sans les toucher", () =>
  expect(assainirPatchPreferences({ timezone: "Europe/Paris" })).toEqual({ timezone: "Europe/Paris" }));
it("garde une apparence valide", () =>
  expect(assainirPatchPreferences({ apparence: { saison: "hiver", decor: false } })).toEqual({ apparence: { saison: "hiver", decor: false } }));
it.each([null, "x", 42])("corps %j → objet vide", (c) => expect(assainirPatchPreferences(c)).toEqual({}));
```

- [ ] **Step 2 : lancer** — `npx vitest run server/services/apparence.test.ts` → FAIL.
- [ ] **Step 3 : implémenter** `assainirPatchPreferences` ; dans la route PATCH, passer `assainirPatchPreferences(req.body)` à `upsertUserPreferences`.
- [ ] **Step 4 : ajouter la colonne** dans `shared/schema.ts`, puis `npx drizzle-kit generate`.
- [ ] **Step 5 : relire le SQL généré** — `cat migrations/0032_*.sql` : il doit contenir **uniquement** un `ALTER TABLE "user_preferences" ADD COLUMN "apparence" jsonb DEFAULT '{"saison":"auto","decor":true}'::jsonb NOT NULL;`. Tout `DROP`, tout autre `ALTER` → arrêter et le signaler.
- [ ] **Step 6 : appliquer en dev seulement** — vérifier que `DATABASE_URL` de `.env` pointe l'endpoint de dev `ep-jolly-sky-an1x7ddn` (n'afficher que l'hôte), puis `npm run db:migrate`.
- [ ] **Step 7 : vérifier** — `npx vitest run server/services/apparence.test.ts` PASS ; `npx tsc --noEmit` à zéro.
- [ ] **Step 8 : commit** — `git add shared/schema.ts migrations server/services/apparence.ts server/services/apparence.test.ts server/routes.ts && git commit -m "feat(saisons): préférence apparence (migration 0032, PATCH assaini)"`

### Task 3 : jetons et typographie

**Files :**
- Modify : `client/src/index.css` (import des polices l.1, `@font-face` Anantason l.~16–36 à retirer, bloc `:root` l.~38–118, `@layer base` typographie l.~145–190)
- Modify : `tailwind.config.ts` (`fontFamily`, `colors.naya`, `colors.cream`, `colors.olive`, `borderRadius`, `boxShadow`)
- Modify : `client/index.html` s'il charge des polices

**Interfaces :**
- Consumes : valeurs de la tâche 1 (automne comme valeurs par défaut avant le JavaScript).
- Produces (utilisés par toutes les tâches suivantes) :
  - Variables de saison : `--fond`, `--touche-1`, `--touche-2`, `--motif`.
  - Variables shadcn remappées : `--background: var(--fond)`, `--foreground #2F2A22`, `--card` / `--popover` / `--secondary` / `--input #FFFBF3`, `--muted #EFE7D9`, `--muted-foreground #5E5546`, `--primary #2E2A24`, `--primary-foreground #F6EFE3`, `--accent: var(--touche-2)`, `--accent-foreground #2F2A22`, `--border rgba(47,42,34,.10)`, `--ring rgba(46,42,36,.45)`, `--radius: 1.25rem`.
  - `--ombre-cocon: 0 8px 24px rgba(90,65,30,.08)`.
  - Tailwind : `font-accueil` (Lora), `font-sans` / `font-body` / `font-inter` / `font-display` → Nunito Sans (les 16 fichiers en `font-display` deviennent lisibles sans être modifiés) ; `shadow-cocon` ; `rounded-champ` 12 px, `rounded-carte` 20 px, `rounded-bloc` 28 px ; `naya.olive` et `olive.DEFAULT` → `#2F2A22`, échelle `naya.olive-NN` → `rgb(47 42 34 / 0.NN)`, `naya.cream` et `cream.DEFAULT` → `var(--fond)`. `sulphur`, `salvia`, `mauve` et les `--task-*` ne bougent pas (couleurs de catégories de tâches).

Typographie de base : `body` Nunito Sans 16 px, interlignage 1,6 ; `h1` 28 px 600, `h2` 22 px 600, `h3` 17 px 600, `h4` 16 px 600, `h5`/`h6` 13 px 600 couleur secondaire ; **plus de majuscules forcées ni d'espacement large** ; `.titre-accueil` = Lora 500 36 px, interlignage 1,15. Import Google Fonts : `Lora:wght@500` et `Nunito+Sans:wght@400;600`, `display=swap`.

- [ ] **Step 1 : appliquer** les changements ci-dessus.
- [ ] **Step 2 : vérifier les types et la construction** — `npx tsc --noEmit` à zéro ; `npx vite build` sans erreur.
- [ ] **Step 3 : vérifier dans le navigateur** — lancer l'app (`npm run dev`), ouvrir `/`, `/planning`, `/content-calendar`, `/settings` à 1 440 px : fond crème chaud, texte en Nunito Sans, titres sans majuscules, aucune page cassée. Relever par capture tout texte devenu illisible.
- [ ] **Step 4 : commit** — `git commit -am "feat(cocon): jetons, polices Lora + Nunito Sans, typographie lisible"`

### Task 4 : appliquer la saison et la régler

**Files :**
- Create : `client/src/lib/appliquer-saison.ts`, `client/src/hooks/useApparence.ts`, `client/src/components/AmbianceSaison.tsx`
- Modify : `client/src/App.tsx` (monter `<AmbianceSaison />` dans `App`, à côté de `<Toaster />`)
- Modify : `client/src/pages/settings.tsx` (nouvelle carte « Ambiance », sur le modèle des cartes `CardTitle` existantes)
- Modify : `client/src/locales/fr.ts`, `client/src/locales/en.ts`
- Test : `client/src/lib/appliquer-saison.test.ts`

**Interfaces :**
- Consumes : `PALETTES`, `saisonEffective`, `normaliserApparence`, `Apparence`, `Saison` (tâche 1) ; `GET`/`PATCH /api/preferences` (tâche 2) ; variables de la tâche 3.
- Produces :
  - `variablesDeSaison(s: Saison): Record<"--fond" | "--touche-1" | "--touche-2" | "--motif", string>`
  - `useApparence(): { apparence: Apparence; saison: Saison; fuseau: string; modifier: (a: Partial<Apparence>) => void }`. Lit `["/api/preferences"]` ; `fuseau` = `prefs.timezone`, repli `Europe/Paris` quand il vaut `"UTC"` ou est vide ; `modifier` fait un PATCH puis invalide `["/api/preferences"]`.
  - `<AmbianceSaison />` : pose `data-saison` et les variables sur `document.documentElement`, recalcule toutes les 30 minutes ; rend `null`.

- [ ] **Step 1 : test qui échoue**

```ts
it("donne les quatre variables de la saison", () =>
  expect(variablesDeSaison("hiver")).toEqual({ "--fond": "#F1EEE8", "--touche-1": "#5F7189", "--touche-2": "#C9D3DF", "--motif": PALETTES.hiver.motif }));
```

- [ ] **Step 2 : lancer** — `npx vitest run client/src/lib/appliquer-saison.test.ts` → FAIL.
- [ ] **Step 3 : implémenter** `variablesDeSaison`, `useApparence` et `AmbianceSaison`.
- [ ] **Step 4 : carte « Ambiance » dans Réglages** — un `Select` (Automatique / Automne / Hiver / Printemps / Été) et un `Switch` « Décor animé », branchés sur `modifier`. Ajouter les clés `settingsPage.ambiance.*` dans `fr.ts` et `en.ts`.
- [ ] **Step 5 : vérifier** — test PASS ; `npx vitest run client/src/locales` PASS ; `npx tsc --noEmit` à zéro ; dans le navigateur, choisir chaque saison dans Réglages : le fond de toute l'app change aussitôt, et le choix tient après rechargement.
- [ ] **Step 6 : commit** — `git commit -am "feat(saisons): application de la saison et réglage Ambiance"` (ajouter les fichiers créés).

### Task 5 : les composants de base

**Files :**
- Modify : `client/src/components/ui/{button,card,input,textarea,select,tabs,badge,dialog,sheet,popover,tooltip,toast,skeleton}.tsx`

**Interfaces :**
- Consumes : utilitaires Tailwind de la tâche 3. Aucune signature de composant ne change (props et variantes conservées).

Cibles : `button` → `rounded-full`, hauteur ≥ 44 px pour `default`/`lg` (`sm` ≥ 36 px avec une zone cliquable de 44 px), `default` = ancre sombre, `secondary` / `outline` = surface carte sans bordure grise, `ghost` = transparent ; `card` → `rounded-carte shadow-cocon border-0 bg-card` ; `input` / `textarea` / `select` (déclencheur) → `rounded-champ bg-card`, focus visible `ring-2 ring-ring` ; `tabs` → liste en pilule (`rounded-full bg-card p-1`), onglet actif = ancre sombre ; `badge` → `rounded-full` ; `dialog` / `sheet` / `popover` → `rounded-bloc shadow-cocon` ; `tooltip` → `rounded-champ`, ancre sombre ; `toast` → `rounded-carte` ; `skeleton` → `rounded-carte bg-muted`.

- [ ] **Step 1 : appliquer** les classes.
- [ ] **Step 2 : vérifier** — `npx tsc --noEmit` à zéro ; `npx vitest run client` PASS ; navigateur à 1 440 et 375 px sur `/`, `/settings`, `/content-calendar`, `/campaigns` : boutons en pilule, cartes arrondies sans bordure, focus visible au clavier (Tab), aucun texte coupé.
- [ ] **Step 3 : commit** — `git commit -am "feat(cocon): composants de base arrondis et doux"`

### Task 6 : la photo de saison et son décor

**Files :**
- Create : `client/src/components/cocon/HeroSaison.tsx`, `client/src/components/cocon/DecorSaison.tsx`, `client/public/saisons/{automne,hiver,printemps,ete}/.gitkeep`, `client/public/saisons/LISEZMOI.md`

**Interfaces :**
- Consumes : `useApparence` (tâche 4), `photoDuJour`, `PALETTES` (tâche 1).
- Produces :
  - `<HeroSaison className?: string, children: ReactNode />` : bloc `rounded-bloc` de 240 px de haut minimum (200 px sous 768 px). Photo du jour en fond (`object-cover`, dimensions réservées, fondu à l'arrivée) ou, sans photo, fond `touche1` de la saison ; voile `linear-gradient(90deg, rgba(46,42,36,.62), rgba(46,42,36,.08) 70%)` ; `<DecorSaison />` si `apparence.decor` ; `children` au-dessus.
  - `<DecorSaison saison: Saison />` : SVG + CSS `@keyframes`, aucune librairie, `aria-hidden`, `pointer-events: none`. Automne : 7 feuilles. Hiver : 24 flocons, plus un bonhomme de neige fixe en bas à droite (44 px). Printemps : 8 pétales. Été : 4 reflets qui ondulent. Animations de 6 à 12 s, décalées. Sous `prefers-reduced-motion` : rien ne bouge, seul le bonhomme de neige reste. En pause quand `document.hidden` (`animation-play-state`).
- `LISEZMOI.md` : format attendu (WebP, 1 600 px de large, ≤ 200 Ko, nommées `1.webp`…), et rappel d'ajouter chaque photo à `PHOTOS_SAISON`.

- [ ] **Step 1 : implémenter** les deux composants.
- [ ] **Step 2 : page d'essai temporaire** — monter `<HeroSaison>` en haut de `/settings` derrière `?apercu-saison=1`, pour vérifier.
- [ ] **Step 3 : vérifier dans le navigateur** — les quatre saisons forcées dans Réglages : décor visible et confiné à la photo ; animations coupées en émulant `prefers-reduced-motion: reduce` ; Décor animé = non → plus de décor ; contraste du texte blanc sur le voile ≥ 4,5:1 dans la zone de texte.
- [ ] **Step 4 : retirer l'aperçu temporaire.** `npx tsc --noEmit` à zéro.
- [ ] **Step 5 : commit** — `git add client/src/components/cocon client/public/saisons && git commit -m "feat(saisons): photo de saison, voile et décor animé"`

### Point de contrôle — fin de l'étape 1

- [ ] `npm test` entièrement vert, `npx tsc --noEmit` à zéro.
- [ ] Montrer à Jeanne, dans le navigateur, quatre pages dans les quatre saisons. **Attendre son accord.**
- [ ] Fusion dans `main` et mise en ligne : **seulement sur décision de Jeanne**. La migration 0032 en production passe d'abord par la procédure de `MIGRATIONS.md` (sauvegarde Neon, relecture, sortie sous les yeux), car le code lit la colonne `apparence`.

---

# Étape 2 — La navigation

### Task 7 : le rattachement des adresses aux espaces

**Files :**
- Create : `client/src/lib/espaces.ts`
- Test : `client/src/lib/espaces.test.ts`

**Interfaces :**
- Produces :
  - `type EspaceId = "aujourdhui" | "projets" | "creer" | "veille" | "chiffres"`
  - `interface Onglet { id: string; cle: string /* clé i18n */; href: string; prefixes: string[]; proprietaire?: true }`
  - `interface Espace { id: EspaceId; cle: string; href: string; onglets: Onglet[] }`
  - `const ESPACES: Espace[]` — dans l'ordre et avec les onglets du tableau « Les 5 espaces » de la spec :
    - aujourdhui → `/` (aujourdhui), `/planning` (semaine) ;
    - projets → `/projects` (projets ; préfixes `/projects`), `/strategy` (strategie), `/fondations` (fondations), `/outreach` (prospection ; préfixe `/outreach`) ;
    - creer → `/atelier`, `/content-calendar`, `/campaigns` ;
    - veille → `/veille` (tendances), `/reading-hub` (lecture), `/savoir` (savoir, `proprietaire`), `/admin/profils-veille` (profils, `proprietaire`) ;
    - chiffres → `/analytics`, `/mesure`.
  - `espaceDuChemin(chemin: string): { espace: EspaceId; onglet: string } | null` — ignore `?…` et `#…` ; `/` ne correspond qu'à lui-même.
  - `ongletsVisibles(espace: Espace, estProprietaire: boolean): Onglet[]`

- [ ] **Step 1 : tests qui échouent**

```ts
it.each([
  ["/", "aujourdhui", "aujourdhui"], ["/planning", "aujourdhui", "semaine"],
  ["/projects/12", "projets", "projets"], ["/outreach/campaigns/3", "projets", "prospection"],
  ["/fondations?projet=2", "projets", "fondations"], ["/atelier", "creer", "atelier"],
  ["/campaigns", "creer", "campagnes"], ["/admin/profils-veille", "veille", "profils"],
  ["/mesure", "chiffres", "mesure"],
])("%s → %s / %s", (c, e, o) => expect(espaceDuChemin(c)).toEqual({ espace: e, onglet: o }));
it.each(["/settings", "/onboarding", "/inconnu", "/rapport/abc"])("%s → aucun espace", (c) => expect(espaceDuChemin(c)).toBeNull());
it("chaque route authentifiée de App.tsx (hors /settings et /onboarding) a un espace", () => {
  for (const r of ["/", "/content-calendar", "/reading-hub", "/outreach", "/analytics", "/strategy", "/projects", "/veille", "/fondations", "/mesure", "/savoir", "/admin/profils-veille", "/planning", "/campaigns", "/atelier"])
    expect(espaceDuChemin(r)).not.toBeNull();
});
it("les onglets propriétaire sont masqués aux autres", () => {
  const veille = ESPACES.find((e) => e.id === "veille")!;
  expect(ongletsVisibles(veille, false).map((o) => o.id)).toEqual(["tendances", "lecture"]);
  expect(ongletsVisibles(veille, true).map((o) => o.id)).toEqual(["tendances", "lecture", "savoir", "profils"]);
});
```

- [ ] **Step 2 : lancer** — `npx vitest run client/src/lib/espaces.test.ts` → FAIL.
- [ ] **Step 3 : implémenter** `client/src/lib/espaces.ts`.
- [ ] **Step 4 : relancer** → PASS.
- [ ] **Step 5 : commit** — `git add client/src/lib/espaces.* && git commit -m "feat(navigation): rattachement des adresses aux 5 espaces"`

### Task 8 : la pilule et les onglets d'espace

**Files :**
- Modify (réécriture) : `client/src/components/sidebar.tsx` (même export par défaut et même prop `onSearchClick`)
- Create : `client/src/components/navigation/PiluleNavigation.tsx`, `client/src/components/navigation/OngletsEspace.tsx`, `client/src/components/navigation/SelecteurProjet.tsx`
- Modify : les 18 pages qui importent `@/components/sidebar` (liste : `grep -rln "@/components/sidebar" client/src/pages`) — une ligne `<OngletsEspace />` en tête du contenu principal
- Modify : `client/src/locales/fr.ts`, `en.ts` (clés `espaces.*`)

**Interfaces :**
- Consumes : `ESPACES`, `espaceDuChemin`, `ongletsVisibles` (tâche 7) ; `useAuth` (`user.role === "owner"`).
- Produces :
  - `Sidebar` (export par défaut inchangé) rend `<PiluleNavigation onSearchClick />`. Au-dessus de 768 px : colonne de 76 px, pilule verticale centrée en hauteur, à 16 px du bord. En dessous : la colonne disparaît, la pilule est fixe en bas à 16 px des bords, et le contenu réserve 88 px en bas (`padding-bottom` sur `body` via une classe posée par le composant).
  - Pilule : fond ancre sombre ; 5 boutons de 44 px (icônes Lucide `Sun`, `LayoutGrid`, `PenLine`, `Telescope`, `LineChart`) ; actif = rond `var(--fond)` et `aria-current="page"` ; `aria-label` et infobulle = nom de l'espace ; puis la recherche (`Search`, appelle `onSearchClick`) et l'avatar (menu : Réglages, Déconnexion — reprendre la logique actuelle de `sidebar.tsx`).
  - `<OngletsEspace />` : lit l'adresse ; rend les onglets en pilule de l'espace courant (`ongletsVisibles`), onglet actif = ancre sombre ; ne rend rien hors espace ; dans l'espace Projets, ajoute `<SelecteurProjet />` à droite.
  - `<SelecteurProjet />` : la logique de choix du projet actif extraite telle quelle de l'ancien `sidebar.tsx` (requête `['/api/projects?limit=200']`, `ProjectContext`).

- [ ] **Step 1 : extraire `SelecteurProjet`** de l'ancien `sidebar.tsx` sans changer son comportement.
- [ ] **Step 2 : écrire `PiluleNavigation` et `OngletsEspace`**, puis réécrire `sidebar.tsx`.
- [ ] **Step 3 : insérer `<OngletsEspace />`** dans les 18 pages.
- [ ] **Step 4 : clés i18n** dans `fr.ts` et `en.ts` ; `npx vitest run client/src/locales` PASS.
- [ ] **Step 5 : vérifier** — `npx tsc --noEmit` à zéro ; navigateur à 1 440, 1 024 et 375 px : chaque route de la tâche 7 allume le bon espace et le bon onglet ; tout l'enchaînement se fait au clavier (Tab, Entrée) avec un focus visible ; Cmd+K ouvre la recherche ; le changement de projet actif marche depuis Projets ; Savoir et Profils sont invisibles pour un compte non propriétaire.
- [ ] **Step 6 : commit** — `git add -A client/src && git commit -m "feat(navigation): pilule à 5 espaces et onglets d'espace"`

### Point de contrôle — fin de l'étape 2

- [ ] `npm test` vert, `npx tsc --noEmit` à zéro. Montrer à Jeanne ; **fusion et mise en ligne sur sa décision**.

---

# Étape 3 — L'accueil « Aujourd'hui »

### Task 9 : le brief de saison

**Files :**
- Create : `server/services/brief-saison.ts`
- Modify : `server/routes.ts` (`app.post('/api/tasks/daily-brief'…)`, ~2534–2738)
- Test : `server/services/brief-saison.test.ts`

**Interfaces :**
- Consumes : `saisonEffective`, `normaliserApparence` (tâche 1) ; `prefs.apparence` (tâche 2).
- Produces : `consigneMotDuMatin(saison: Saison): string` ; `phraseDeSecours(energie: string | null | undefined, saison: Saison): string`.

La consigne dit, en français : saison du jour (« automne ») ; « tu peux l'évoquer en une touche légère, jamais en cliché » ; `greeting` = 2 phrases au plus ; **aucune formule de salutation** (l'écran affiche déjà « Bonjour {prénom}. »). La route l'ajoute à `briefPrompt` et dans la consigne du champ `greeting`. Le repli existant (`fallbackBrief.greeting`) passe par `phraseDeSecours`.

- [ ] **Step 1 : tests qui échouent**

```ts
it("nomme la saison et interdit la salutation", () => {
  const c = consigneMotDuMatin("hiver");
  expect(c).toMatch(/hiver/);
  expect(c).toMatch(/salutation/i);
  expect(c).toMatch(/2 phrases/);
});
it.each(["automne", "hiver", "printemps", "ete"] as const)("secours %s : court, sans « Bonjour »", (s) => {
  const p = phraseDeSecours("medium", s);
  expect(p.length).toBeLessThanOrEqual(140);
  expect(p).not.toMatch(/bonjour/i);
});
it("énergie épuisée → phrase douce", () => expect(phraseDeSecours("depleted", "automne")).toMatch(/doucement|repos/i));
```

- [ ] **Step 2 : lancer** — `npx vitest run server/services/brief-saison.test.ts` → FAIL.
- [ ] **Step 3 : implémenter** puis brancher dans la route.
- [ ] **Step 4 : relancer** → PASS ; `npx tsc --noEmit` à zéro.
- [ ] **Step 5 : commit** — `git commit -am "feat(accueil): mot du matin de saison dans le brief du jour"` (ajouter les fichiers créés).

### Task 10 : la logique de l'accueil

**Files :**
- Create : `client/src/pages/aujourdhui/logique.ts`
- Test : `client/src/pages/aujourdhui/logique.test.ts`

**Interfaces :**
- Consumes : `lienInterneDeTache` (`client/src/lib/lien-tache.ts`).
- Produces :
  - `type TacheAccueil = { id: number; title: string; completed: boolean; scheduledTime: string | null; priority: number | null; estimatedDuration: number | null; actionData?: unknown }`
  - `prochaineEtape<T extends TacheAccueil>(taches: T[]): T | null` — non faites ; d'abord celles qui ont une heure, par heure croissante (y compris passées) ; puis celles sans heure, par priorité croissante (`null` → 5).
  - `trierFil<T extends TacheAccueil>(taches: T[]): T[]` — toutes les tâches du jour : avec heure par heure croissante, puis sans heure par priorité.
  - `estTacheProspection(t: { actionData?: unknown }): boolean` — vrai si le lien interne commence par `/outreach`.
  - `capsuleCampagne(campagnes: Array<{ name: string; status: string | null; endDate: string | null }>, aujourdhui: string): { nom: string; fin: string } | null` — statut `active`, `endDate ≥ aujourdhui`, la plus proche ; `fin` au format « 30 oct. » (`Intl`, `fr-FR`).
  - `chiffreCle(reponse: unknown): { libelle: string; variation: string } | null` — sur la réponse de `GET /api/mesure/:projectId` : dernier mois, premier indicateur de `catalogues.indicateurs` dont l'évolution est numérique ; `variation` signée, arrondie (« +12 % ») ; `null` si absent ou malformé. Lire `server/routes-mesure.ts` (`evolutions`) pour la forme exacte avant d'écrire le test.
  - `capsulesAffichables(activeProjectId: number | null): { veille: boolean; chiffres: boolean }` — les deux à `false` quand `activeProjectId` est nul.
  - `ligneEnAttente(n: number): string | null` — `null` pour 0 ; « 1 tâche d'avant attend sa place. Naya la replace en fin de journée. » ; « {n} tâches d'avant attendent leur place. Naya les replace en fin de journée. »

- [ ] **Step 1 : tests qui échouent**

```ts
const t = (id: number, o: Partial<TacheAccueil> = {}): TacheAccueil =>
  ({ id, title: `T${id}`, completed: false, scheduledTime: null, priority: 3, estimatedDuration: 30, ...o });

describe("prochaineEtape", () => {
  it("la première non faite dans l'ordre des heures, passées comprises", () =>
    expect(prochaineEtape([t(1, { scheduledTime: "14:00" }), t(2, { scheduledTime: "09:30" }), t(3, { scheduledTime: "08:00", completed: true })])?.id).toBe(2));
  it("sans heure : la plus prioritaire", () =>
    expect(prochaineEtape([t(1, { priority: 4 }), t(2, { priority: 1 }), t(3, { priority: null })])?.id).toBe(2));
  it("les tâches avec heure passent avant celles sans heure", () =>
    expect(prochaineEtape([t(1, { priority: 1 }), t(2, { scheduledTime: "16:00", priority: 5 })])?.id).toBe(2));
  it("tout est fait → null", () => expect(prochaineEtape([t(1, { completed: true })])).toBeNull());
  it("journée vide → null", () => expect(prochaineEtape([])).toBeNull());
});

it("estTacheProspection suit le lien interne", () => {
  expect(estTacheProspection({ actionData: { lien: "/outreach/campaigns/3?onglet=prospects" } })).toBe(true);
  expect(estTacheProspection({ actionData: { lien: "/atelier" } })).toBe(false);
  expect(estTacheProspection({})).toBe(false);
});

it("capsuleCampagne : l'active qui finit le plus tôt, jamais une passée", () =>
  expect(capsuleCampagne([
    { name: "Hiver", status: "active", endDate: "2026-12-15" },
    { name: "Automne", status: "active", endDate: "2026-10-30" },
    { name: "Été", status: "active", endDate: "2026-09-01" },
    { name: "Brouillon", status: "draft", endDate: "2026-10-20" },
  ], "2026-10-16")).toEqual({ nom: "Automne", fin: "30 oct." }));

it("capsulesAffichables : rien de projet en mode tous les projets", () => {
  expect(capsulesAffichables(null)).toEqual({ veille: false, chiffres: false });
  expect(capsulesAffichables(7)).toEqual({ veille: true, chiffres: true });
});

it("ligneEnAttente", () => {
  expect(ligneEnAttente(0)).toBeNull();
  expect(ligneEnAttente(1)).toBe("1 tâche d'avant attend sa place. Naya la replace en fin de journée.");
  expect(ligneEnAttente(2)).toBe("2 tâches d'avant attendent leur place. Naya les replace en fin de journée.");
});
// + tests de chiffreCle : null sur {} / null / mois vide ; « +12 % » sur une réponse construite d'après routes-mesure.ts
```

- [ ] **Step 2 : lancer** — `npx vitest run client/src/pages/aujourdhui/logique.test.ts` → FAIL.
- [ ] **Step 3 : implémenter** `logique.ts` (copie de `ligneEnAttente` exactement comme dans le test).
- [ ] **Step 4 : relancer** → PASS.
- [ ] **Step 5 : commit** — `git add client/src/pages/aujourdhui && git commit -m "feat(accueil): logique de la prochaine étape, du fil et des capsules"`

### Task 11 : la page « Aujourd'hui »

**Files :**
- Create : `client/src/pages/aujourdhui/index.tsx`, `client/src/pages/aujourdhui/{MotDuMatin,PiluleEtape,Capsules,FilDuJour}.tsx`, `client/src/components/quick-capture.tsx` (extrait de `QuickCapture`, `dashboard.tsx` l.~398–622, sans changement de comportement)
- Modify : `client/src/App.tsx` (la route `/` rend `Aujourdhui` à la place de `Dashboard`) ; `client/src/locales/fr.ts`, `en.ts`

**Interfaces :**
- Consumes : `HeroSaison` (tâche 6), `Sidebar` / `OngletsEspace` (tâche 8), `logique.ts` (tâche 10), `useAuth().user.firstName`, `useProjectContext` (`activeProjectId`), `TaskWorkspace`, `lienInterneDeTache`, `cocherDansLeCache` / `POST /api/tasks/:id/toggle`.
- Données :
  - Tâches du jour : `['/api/tasks/range', { start, end }]`, même clé et même URL que `todays-tasks.tsx` (pour partager le cache et le cochage optimiste).
  - Brief : `GET /api/tasks/daily-brief`, puis `POST` une fois si `content` est vide.
  - Semaine (lundi → dimanche) : `/api/tasks/range` sur la semaine.
  - Campagnes : `["/api/campaigns"]`.
  - Veille : `/api/profils-veille/projet/${activeProjectId}` (nombre de `tendances`), seulement si `capsulesAffichables(...).veille`.
  - Chiffres : `/api/mesure/${activeProjectId}`, seulement si `capsulesAffichables(...).chiffres`.
  - En attente : `/api/tasks/overdue?clientToday=${today}`.

Mise en page (spec, section 3, et maquette validée) :
- `<Sidebar>` à gauche.
- `<HeroSaison>` contient la date (13 px), « Bonjour {prénom}. » (`.titre-accueil`), `<MotDuMatin>` (16 px, 2 lignes au plus via `line-clamp-2`, 42ch), et `<PiluleEtape>` flottante en bas. Sans prénom : « Bonjour. ».
- En dessous, une grille à deux colonnes au-dessus de 1 024 px (une seule en dessous) : à gauche `<Capsules>` puis `<QuickCapture>` en pilule ; à droite `<FilDuJour>`.

Comportements :
- `MotDuMatin` affiche une phrase de secours côté client (« On avance une chose à la fois. ») pendant le chargement ou en cas d'erreur.
- `PiluleEtape` : titre en 17 px 600 sur une ligne coupée ; « Prochaine étape · {durée} min ». « Commencer » suit `lienInterneDeTache` s'il existe, sinon ouvre `TaskWorkspace`. Plus rien → « Ta journée est faite. Profite. »
- `Capsules` : une capsule n'apparaît que si sa requête réussit et a du contenu. La capsule Campagne porte `var(--motif)`, la capsule Chiffres est sur ancre sombre. Défilement horizontal au trackpad, au clavier (capsules focusables) et au doigt ; les capsules dépassent du bord droit.
- `FilDuJour` : `trierFil` ; heure, point, titre ; tâche en cours = point `var(--touche-1)` ; faites = texte secondaire barré léger ; marque « prospection » si `estTacheProspection` ; clic = même règle que « Commencer » ; dernière ligne `ligneEnAttente(n)` avec un lien vers `/planning`. Aucun rouge.
- Chaque bloc a son propre état d'erreur, discret ou caché.

- [ ] **Step 1 : extraire `QuickCapture`** dans `components/quick-capture.tsx` ; `dashboard.tsx` l'importe (le comportement reste identique tant que `Dashboard` existe).
- [ ] **Step 2 : écrire les quatre blocs et la page**, puis brancher la route `/`.
- [ ] **Step 3 : i18n** dans `fr.ts` et `en.ts` ; `npx vitest run client` PASS ; `npx tsc --noEmit` à zéro.
- [ ] **Step 4 : vérifier dans le navigateur** — à 1 440, 1 024 et 375 px :
  - mot du matin affiché (ou phrase de secours) ;
  - « Commencer » ouvre la bonne chose ; cocher une tâche fait glisser la suivante ;
  - en mode « tous les projets », aucune requête vers `/api/profils-veille/projet/` ni `/api/mesure/` (onglet Réseau) ;
  - un titre de 120 caractères et un mot du matin de 3 phrases ne débordent pas à 375 px ;
  - clavier seul de bout en bout ;
  - les quatre saisons forcées.
- [ ] **Step 5 : commit** — `git add -A client/src && git commit -m "feat(accueil): page Aujourd'hui (mot du matin, prochaine étape, capsules, fil)"`

### Task 12 : la nouvelle place des blocs retirés de l'accueil

**Files :**
- Create : `client/src/components/accueil-retire/` — un fichier par bloc extrait de `dashboard.tsx` : `PersonaCard`, `AIRecommendations`, `ActiveProjectBand` (avec `AllProjectsBand` et `ProjectStatusNote`), `OverdueTasks`
- Modify : `client/src/pages/fondations.tsx` (personas cible, ma persona, ADN de marque, en bas de page) ; `client/src/pages/project/ProjectPage.tsx` (onglet `ensemble` : `AIRecommendations`) ; `client/src/pages/projects.tsx` (en-tête : `ActiveProjectBand` et alerte de surcharge `['/api/projects/overcommit', today]`) ; `client/src/pages/planning.tsx` (`OverdueTasks` en tête) ; `client/src/pages/reading-hub.tsx` (vérifier que la lecture du jour `['/api/reading/today']` y figure, sinon l'ajouter)
- Delete : `client/src/pages/dashboard.tsx`, une fois que plus rien ne l'importe

**Interfaces :**
- Consumes : les composants **déplacés tels quels** (aucune réécriture) ; `QuickCapture` (tâche 11).

- [ ] **Step 1 : déplacer** chaque composant dans son fichier, avec ses imports.
- [ ] **Step 2 : les monter** aux places listées.
- [ ] **Step 3 : supprimer `dashboard.tsx`** — `grep -rn "pages/dashboard" client/src` doit être vide.
- [ ] **Step 4 : vérifier** — `npx tsc --noEmit` à zéro ; `npm test` vert ; dans le navigateur, chaque bloc s'affiche et fonctionne à sa nouvelle place.
- [ ] **Step 5 : commit** — `git add -A client/src && git commit -m "refactor(accueil): blocs retirés déplacés dans Projets, Planning et Veille"`

### Task 13 : vérification finale

- [ ] `npm test` vert, `npx tsc --noEmit` à zéro, `npx vite build` sans erreur.
- [ ] Navigateur : les quatre saisons × 1 440 / 1 024 / 375 px, sur `/`, `/planning`, `/projects`, `/content-calendar`, `/veille`, `/analytics`, `/settings` ; animations réduites ; clavier seul.
- [ ] Lancer le skill `design:accessibility-review` sur l'accueil et la navigation ; corriger les points bloquants, lister les autres pour Jeanne.
- [ ] Montrer à Jeanne ; **fusion et mise en ligne sur sa décision** (la migration 0032 doit déjà être en production, voir le point de contrôle de l'étape 1).
