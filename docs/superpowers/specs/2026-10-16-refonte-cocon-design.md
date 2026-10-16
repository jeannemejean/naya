# La refonte « cocon » de Naya Web — design

> Demande de Jeanne (16 oct. 2026) : « le design, j'ai besoin que ça ressemble plus à mon cerveau en étant beaucoup plus facilement navigable et avec toujours un look que j'aime. » Puis : « beaucoup plus cosy, comme si tu ouvrais ton journal […] un board, mais qui soit physiquement rassurant », « que Naya évolue avec les saisons ».
> Le ressenti visé, avec ses mots : « tout va bien se passer, on est là, Naya va être capable de tout gérer. Il faut juste suivre étape par étape ce qu'on doit faire, et on est dans une espèce de cocon. »

## Choix validés

| Sujet | Choix |
|---|---|
| Accueil | **C** : le mot de Naya et la prochaine étape en grand, deux ou trois cartes calmes autour |
| Ambiance de base | **A, « matin au lit »** (lin, beurre, rayure bleue), en version **fluide** : photo pleine largeur, pilules, capsules qui défilent, une ancre sombre par écran |
| Typographie | **Lora** pour l'accueil et les grands titres, **Nunito Sans** pour tout le reste |
| Navigation | **5 espaces** dans une **pilule verticale à gauche** sur ordinateur, en bas sur téléphone |
| Prospection | **C** : les relances arrivent dans le fil d'« Aujourd'hui » ; la liste complète reste dans Projets |
| Saisons | **B** : palette, motif, photo, décor animé et mot du matin de saison ; **automatique par défaut, réglable** |
| Décor animé | Oui, **confiné à la photo d'accueil** : feuilles en automne, neige et bonhomme de neige en hiver, pétales au printemps, reflets de soleil en été |
| Approche | **1, couche par couche** : fondations → navigation → accueil, chaque étape mise en ligne seule |

Sources : le moodboard Pinterest de Jeanne (draps rayés, maille, céramique, lumière basse, café, pluie à la fenêtre) ; quatre références d'apps « fluides » ; les règles du skill `ui-ux-pro-max` (lisibilité, contraste, cibles, animation).

## Constat

- La navigation est rangée **par outil** (Pilot Board, Planning, Analytics, Stratégie, Campagnes, Calendrier, Outreach, Savoir, Profils de veille), pas comme Jeanne pense.
- L'accueil (`client/src/pages/dashboard.tsx`, 1 362 lignes) empile une douzaine de blocs : tâches, capture, recommandations, personas, ADN de marque, bandeau projet, surcharge, tâches bloquées, lecture du jour, tendances.
- Le style (crème/olive plat, Anantason/Montserrat très espacé, texte à 15 px, rayon de 6 px, bordures fines) se lit comme « froid » et « comme tout ce qui existe sur le marché » (Notion de Jeanne, nov. 2025).
- Tout le style passe par `client/src/index.css` (variables), `tailwind.config.ts` et 47 composants `client/src/components/ui/*` partagés par 36 pages : une couche de fondations change toute l'app d'un coup.
- Un **brief du jour** existe déjà (`GET/POST /api/tasks/daily-brief`, `server/routes.ts` ~2515–2745) : phrase d'accueil (`greeting`) écrite par le modèle rapide via `callClaudeWithContext`, enregistrée pour la journée dans `user_preferences.daily_brief_*`, avec une phrase de secours. **Aucune page ne l'affiche.**

## Règles de lisibilité retenues (ui-ux-pro-max)

1. Texte courant **16 px minimum**, interlignage **1,6**, lignes de **75 caractères** au plus.
2. Contraste **4,5:1 minimum**, textes secondaires compris.
3. Une **échelle fixe** : 13 / 16 / 17 / 22 / 28 / 36 px.
4. Police décorative **seulement en grand** (≥ 28 px), jamais pour du texte à lire.
5. **Toujours un voile** sous du texte posé sur une photo.
6. Cibles cliquables **44 × 44 px minimum**, focus visible au clavier.
7. Animations **150 à 300 ms**, coupées sous `prefers-reduced-motion`.
8. Pas d'emoji comme icône ; un seul jeu d'icônes (Lucide, déjà utilisé).

## 1. Les fondations

### Ce qui ne bouge jamais

| Jeton | Valeur |
|---|---|
| Police d'accueil et grands titres | Lora 500 (Google Fonts) ; uniquement ≥ 28 px |
| Police de tout le reste | Nunito Sans 400 / 600 (Google Fonts) |
| Échelle | 13 (méta) · 16 (texte) · 17 (titre de tâche) · 22 (titre de section) · 28 (titre de page) · 36 (bonjour) |
| Encre | `#2F2A22` ; secondaire `#5E5546` |
| Ancre sombre | `#2E2A24` (espresso) : bouton principal, pilule de navigation, carte « en cours » ; texte dessus `#F6EFE3` |
| Surface de carte | `#FFFBF3` |
| Arrondis | 12 px champs · 20 px cartes · 28 px grands blocs · pilule (`9999px`) boutons, onglets, navigation |
| Ombre unique | chaude et diffuse : `0 8px 24px rgba(90, 65, 30, 0.08)` ; **plus de bordures grises** sur les cartes |
| Mouvement | 200 ms, `ease-out` ; aucun sous `prefers-reduced-motion` |

**Règle de couleur** : les couleurs de saison ne servent **qu'en fond ou en touche** (pastille, motif, remplissage avec texte encre). Jamais de texte posé sur une couleur de saison sauf l'encre ; jamais de texte en couleur de saison. Le bouton principal est toujours l'ancre sombre. La lisibilité ne dépend donc pas de la saison.

Les polices Anantason et Montserrat quittent l'interface. Le logo et le mot-symbole restent des images (`brand-kit/`).

### Ce qui change avec la saison

| Saison | Dates (fuseau de l'utilisatrice) | Fond | Touches | Motif des cartes | Photo |
|---|---|---|---|---|---|
| Automne | 21 sept. → 20 déc. | `#F3EADB` | caramel `#C07A47`, bois miel `#D9B98A` | carreaux | pluie, bougie, café |
| Hiver | 21 déc. → 19 mars | `#F1EEE8` | gris bleu `#5F7189`, `#C9D3DF` | vichy | plaid, lampe, fenêtre |
| Printemps | 20 mars → 20 juin | `#F6F0E1` | beurre `#EBD58A`, sauge `#A9B79A` | fine rayure | fleurs, lumière du matin |
| Été | 21 juin → 20 sept. | `#F7F1E6` | bleu clair `#7F9CB8`, sable `#E6D3B3` | large rayure | draps rayés, soleil |

Hémisphère nord uniquement (toutes les utilisatrices actuelles).

### Le moteur des saisons

- **`shared/saisons.ts`** (pur, testé) : `saisonDuJour(date: Date, fuseau: string): Saison` et `saisonEffective(apparence, date, fuseau)` (le choix forcé gagne sur l'automatique). `Saison = "automne" | "hiver" | "printemps" | "ete"`.
- Le client pose `data-saison="automne"` sur `<html>` ; `index.css` définit les variables de saison sous `[data-saison="…"]`. Tous les composants lisent des variables, aucun ne connaît la saison.
- **Préférence** : nouvelle colonne `user_preferences.apparence` (`jsonb`, non nulle, défaut `{"saison":"auto","decor":true}`), type `{ saison: "auto" | Saison; decor: boolean }`, lue et écrite par les routes de préférences existantes. Réglages : « Ambiance » (Automatique / Automne / Hiver / Printemps / Été) et « Décor animé » (oui / non).
- **Migration 0032** : un seul `ALTER TABLE user_preferences ADD COLUMN apparence jsonb DEFAULT … NOT NULL`. Procédure de `MIGRATIONS.md` : `drizzle-kit generate`, relecture ligne par ligne, sauvegarde Neon, `npm run db:migrate`. La correction `suggere_par` prévue passe en 0033.

### Les photos de saison

- Rangées dans `client/public/saisons/<saison>/` (WebP, 1 600 px de large, ≤ 200 Ko chacune), 3 ou 4 par saison, listées dans `shared/saisons.ts`.
- **Jeanne les choisit** (Pinterest, Unsplash, ses photos) ; l'implémentation les recadre, les compresse et vérifie le voile.
- Rotation : une photo par jour (`jourDeLAnnee % nombre`).
- **Sans photo** : la carte d'accueil prend la couleur de touche foncée de la saison. L'étape 1 peut être livrée avant que les photos soient prêtes.
- Le texte de l'accueil est toujours posé sur un voile (dégradé espresso à gauche, ≥ 4,5:1 vérifié sur chaque photo).

### Le décor animé

- Composant `DecorSaison` : SVG et CSS uniquement, **aucune librairie**, positionné en absolu **à l'intérieur de la photo d'accueil** et nulle part ailleurs.
  - Automne : 6 à 8 feuilles qui tombent lentement.
  - Hiver : flocons, et un petit bonhomme de neige fixe dans le coin inférieur droit.
  - Printemps : quelques pétales qui volent.
  - Été : reflets de lumière qui ondulent doucement.
- Éteint si `apparence.decor === false`, sous `prefers-reduced-motion` (le bonhomme de neige reste, immobile), et en pause quand l'onglet est caché.
- `aria-hidden`, ne capte pas les clics.

### Les composants de base restylés

`button` (pilule ; principal = ancre sombre ; secondaire = surface carte), `card` (20 px, ombre unique, sans bordure), `input` / `textarea` / `select` (12 px, fond carte, focus visible), `tabs` (onglets en pilule), `badge`, `dialog` / `sheet` / `popover` (28 px), `tooltip`, `skeleton`, `toast`. Les pages en profitent sans être modifiées.

## 2. La navigation

### Les 5 espaces

| Espace | Icône (Lucide) | Onglets en pilule | Pages actuelles rattachées |
|---|---|---|---|
| **Aujourd'hui** | `Sun` | Aujourd'hui · Semaine | `/` (nouvel accueil), `/planning` |
| **Projets** | `LayoutGrid` | Projets · Stratégie · Fondations · Prospection | `/projects`, `/projects/:id`, `/strategy`, `/fondations`, `/outreach`, `/outreach/campaigns/:id` |
| **Créer** | `PenLine` | Atelier · Calendrier · Campagnes | `/atelier`, `/content-calendar`, `/campaigns` |
| **Veille** | `Telescope` | Tendances · Lecture · Savoir · Profils de veille | `/veille`, `/reading-hub`, `/savoir`, `/admin/profils-veille` (propriétaire seulement) |
| **Chiffres** | `LineChart` | Chiffres · Mesure | `/analytics`, `/mesure` |

- **Les adresses ne changent pas.** Un module pur **`client/src/lib/espaces.ts`** (testé) rattache chaque chemin à son espace et à son onglet (`espaceDuChemin("/outreach/campaigns/3") → { espace: "projets", onglet: "prospection" }`). Une adresse inconnue n'allume aucun espace.
- L'avatar (en bas de la pilule) ouvre les Réglages et la déconnexion. La recherche (Cmd+K) reste.

### La pilule

- **Ordinateur (≥ 768 px)** : verticale, flottante à gauche, centrée en hauteur, à 16 px du bord ; le contenu commence après elle. Nom de l'espace en infobulle au survol et au focus.
- **Téléphone (< 768 px)** : horizontale en bas, à 16 px des bords, le contenu réserve sa hauteur.
- Fond ancre sombre ; l'espace actif est un rond de la couleur du fond de saison.
- Chaque icône : bouton de 44 px, `aria-label` = nom de l'espace, `aria-current="page"` sur l'actif, ordre de tabulation = ordre visuel.
- Remplace `client/src/components/sidebar.tsx` (et le sélecteur de projets qu'il contient, qui passe dans l'en-tête de l'espace Projets).

## 3. L'accueil « Aujourd'hui »

Nouvelle page à `/`, qui remplace `Dashboard`. Cinq blocs, de haut en bas.

### 1. La photo et le mot du matin

- Photo de saison, décor animé, voile.
- Date (13 px), **« Bonjour {prénom}. »** (Lora, 36 px), puis le **mot du matin** (16 px, 2 lignes au plus, 42 caractères par ligne environ).
- Le mot du matin **est le `greeting` du brief du jour existant**. Changements côté serveur :
  - le prompt du brief reçoit la saison effective et la consigne : « tu peux évoquer la saison en une touche légère, jamais en cliché » ;
  - 2 phrases au plus, voix de Naya, `destinataire: "utilisatrice"` ;
  - le contexte reste celui de `callClaudeWithContext` (`buildNayaContext`).
- L'accueil lit `GET /api/tasks/daily-brief` ; s'il n'y a rien pour aujourd'hui, il appelle `POST` une fois, et affiche une phrase de secours tant que la réponse n'est pas là. **Jamais d'écran vide.**

### 2. La prochaine étape

- Une pilule de surface carte flotte en bas de la photo : « Prochaine étape · {durée} », le titre de la tâche (17 px, 600), un bouton **Commencer**.
- **Règle** (fonction pure testée `prochaineEtape(taches, maintenant)`) : la première tâche **non faite** d'aujourd'hui dans l'ordre des heures (`scheduledTime`), celles dont l'heure est passée comprises ; puis les tâches du jour sans heure, par priorité.
- « Commencer » ouvre la tâche ; une tâche d'atelier ouvre l'atelier. Quand la tâche est faite, la suivante glisse à sa place (200 ms).
- Plus rien : « Ta journée est faite. Profite. »

### 3. Les capsules

Une rangée horizontale de capsules (104 × 120 px, arrondi haut en dôme) qui dépasse du bord et défile à la souris, au trackpad, au clavier et au doigt. Dans l'ordre :

| Capsule | Contenu | Mène à | Affichée si |
|---|---|---|---|
| Ta semaine | « 6 sur 11 » tâches faites | Aujourd'hui › Semaine | la semaine a des tâches |
| Campagne | campagne en cours la plus proche de sa fin, « 3 sur 8 » posts | Créer › Campagnes | une campagne tourne |
| Veille | nombre de tendances nouvelles | Veille › Tendances | il y en a |
| Chiffres | un chiffre clé et sa variation | Chiffres | une mesure existe |

Une capsule porte le **motif de saison** (la campagne). Une capsule sur fond ancre sombre (les chiffres). Chacune charge ses données seule et **disparaît si elle échoue ou n'a rien à dire**.

### 4. Le fil de ta journée

- Les tâches d'aujourd'hui à leur heure : point, heure, titre. La tâche en cours a un point plein couleur de touche. Les tâches faites s'estompent (texte secondaire, barré léger).
- **Relances de prospection** : les prospects (`leads`) dont `next_follow_up` tombe aujourd'hui s'insèrent à leur heure, marqués « prospection » ; un clic ouvre le prospect. Lecture par un petit endpoint dédié `GET /api/leads/relances-du-jour`.
- **Rien en rouge.** Si le report de fin de journée a déplacé des tâches d'hier, une ligne calme en bas du fil : « Naya a replacé 2 tâches d'hier dans ta semaine. »

### 5. La note pour Naya

Le champ de capture existant (`/api/capture`), en pilule discrète sous les capsules : « Une idée, une note pour Naya… ».

### Ce qui quitte l'accueil

| Bloc | Nouvelle place |
|---|---|
| Personas cible, ma persona, ADN de marque | Projets › Fondations |
| Recommandations du projet | Projets › vue d'ensemble du projet |
| Bandeau projet actif, alerte de surcharge | Projets (en-tête de l'espace) |
| Tâches bloquées, tâches en retard | absorbées par le fil (ligne calme) et Aujourd'hui › Semaine |
| Lecture du jour | Veille › Lecture |
| Tendances du secteur | Veille › Tendances (déjà là) |

Les composants existants sont **déplacés**, pas réécrits.

## Imprévus

- Une capsule, le fil ou les relances qui échouent : le bloc se cache ou montre un état vide doux ; les autres continuent.
- Brief indisponible : phrase de secours (déjà prévue côté serveur, plus une côté client tant que la requête tourne).
- Photo absente ou lente : couleur de saison immédiate, photo en fondu quand elle arrive (`loading="lazy"` hors accueil, dimensions réservées, aucun saut de mise en page).
- Préférence `apparence` absente ou invalide : `{ saison: "auto", decor: true }`.
- Aucun écran d'erreur rouge sur l'accueil.

## Vérifications

- **Tests unitaires** :
  - `saisonDuJour` aux bornes de chaque saison et selon le fuseau ;
  - `saisonEffective` (forcée contre automatique) ;
  - `espaceDuChemin` pour toutes les routes de `App.tsx` ;
  - `prochaineEtape` (heure passée, sans heure, tout fait) ;
  - présence de la saison dans le prompt du brief ;
  - `GET /api/leads/relances-du-jour` (fuseau, prospects clos exclus).
- `npx tsc --noEmit` à **zéro**.
- **Contrastes** : un script vérifie ≥ 4,5:1 pour l'encre et le texte secondaire sur chaque fond de saison et sur la surface de carte, et pour le texte clair sur l'ancre sombre.
- **Navigateur** : chaque saison forcée tour à tour, à 1 440, 1 024 et 375 px ; clavier seul sur la pilule et l'accueil ; animations réduites.
- **Fin de l'étape 3** : passage du skill `design:accessibility-review`.

## Mise en œuvre

Branche `feat/refonte-cocon`. Trois étapes, chacune fusionnée et mise en ligne seule, vue par Jeanne avant la suivante :

1. **Fondations** : jetons, polices, composants de base, moteur des saisons, colonne `apparence` (migration 0032), réglages, photos (ou repli couleur), décor animé.
2. **Navigation** : pilule, `espaces.ts`, onglets d'espace, retrait de la barre latérale.
3. **Accueil** : page « Aujourd'hui », brief de saison, relances du jour, déplacement des blocs retirés.

## Hors de cette spec

- Le mode sombre.
- Les rituels de saison (bilan de l'été, intentions d'automne).
- La finition des espaces Projets, Créer, Veille et Chiffres : une spec courte par espace, après avoir vécu avec les fondations.
- Naya Mobile (Expo) : pourra reprendre les jetons et les saisons, chantier séparé.
- L'hémisphère sud.
