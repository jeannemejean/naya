# Vie perso (« Personal Life ») dans Naya

Date : 23 nov. 2026. Décisions prises par Claude (Jeanne a délégué : « ne me pose pas de question, je te laisse prendre toutes ces décisions »).

## Pourquoi

Jeanne veut que Naya organise aussi ce qui n'est pas le travail : les repas, les courses, la cuisine, et des activités perso (ex. crafts de Noël, lettres en feutrine), placés dans le même planning que le travail, sans qu'elle ait à y penser. Demandé le 2 nov. comme une option d'abonnement en plus.

Modèle de référence : son plan existant `~/Downloads/Pages web et liens/plan-repas-jeanne-v2.html` et `~/Downloads/Documents/courses_3semaines_v2.docx`. Ce qui fait tenir ce plan, et que Naya doit reproduire :
- deux personnes, un seul plan : Jeanne (objectif calorique, jeûne 16:8, index glycémique bas, anti-inflammatoire, sans légumineuses lourdes) et Milan (même plat avec une variante plus copieuse/confort) ;
- par jour : déjeuner, dîner, dessert du soir (planifié, pas une récompense), avec kcal et macros approximatifs ;
- déjeuner à 12 h pile ; batch cooking le dimanche, 2 h max, « rien à décider en semaine », assemblage en 5 à 10 min ;
- équipement : Thermomix, four ; magasins : Picard (surgelés, protéines) × Aldi (épicerie, frais) ;
- liste de courses groupée par magasin et rayon, marquée « pour Jeanne / pour Milan / pour les deux », avec « déjà au placard, ne pas racheter » ;
- phase du cycle menstruel prise en compte (règles, folliculaire, ovulation, lutéale) ;
- quelques règles de semaine et snacks approuvés.

## Constat technique qui oriente le design

Le moteur de placement de Naya (`fixOverlappingTasks`, `findFirstFreeSlot`, `creerTache`) ne connaît que les heures et jours de travail : une tâche le soir ou le samedi est refusée ou ramenée dans 9 h–18 h. La vie perso a donc **son propre créneau et son propre placement**, et le moteur de travail doit la laisser tranquille (mais la compter comme occupée).

## Ce qui est construit (V1)

### 1. Interrupteur
- Option par utilisatrice : variable `VIE_PERSO_USERS` (liste d'ids), même modèle que `FIL_CONDUCTEUR_USERS`. Onglet visible seulement si actif. Facturation (add-on Stripe) : plus tard, comme `prospectionPlan`.

### 2. Domaine « perso » sur les tâches
- Marqueur : `tasks.source = 'vie_perso'` (décision au plan : pas de colonne neuve sur `tasks`, la source suffit et le moteur sait déjà ignorer des sources).
- Une tâche perso a toujours une date et une heure explicites, `schedulingMode = 'fixed'`, `projectId` nul.
- `creerTache` ne refuse pas un jour non travaillé pour une tâche perso.
- Le moteur de travail (`fixOverlappingTasks` / `retasserJours`, `findFirstFreeSlot`, `checkSlotAvailability`, placement du jour, report automatique des tâches non faites, auto-planner) ne déplace jamais une tâche perso ; si une tâche perso tombe dans la fenêtre de travail (Jeanne l'y a mise), elle compte comme plage bloquée, comme un événement d'agenda.
- Les tâches perso n'entrent pas dans les comptes de charge de travail (taille du jour, budget par projet).

### 3. Créneaux perso (réglages)
Table `vie_perso_profil` (une ligne par utilisatrice), modifiable dans l'onglet :
- soirs : début et fin (défaut 18 h 30 – 22 h) ; week-end : début et fin (défaut 9 h – 20 h) ;
- heures de repas : déjeuner (défaut 12 h 00), dîner (défaut 19 h 30) ;
- jour et durée max du batch (défaut dimanche, 120 min, 10 h 00) ; jour et heure des courses (défaut samedi 10 h 00, 60 min) ;
- jeûne (texte libre, ex. « 16:8, rien avant 12 h ») ; équipement (liste, ex. Thermomix, four, airfryer) ; magasins (liste ordonnée, ex. Picard, Aldi) ; placard (liste « ne pas racheter ») ;
- cycle (facultatif) : date des dernières règles + durée moyenne du cycle. Sert seulement à calculer la phase de chaque jour pour la consigne de génération. Jamais montré ailleurs.

### 4. Foyer
Table `vie_perso_membres` : prénom, est-ce moi, régime et objectifs (texte libre, ex. « 1 400 kcal, low-GI, anti-inflammatoire »), exclusions (« pas de légumineuses lourdes »), aime, n'aime pas, mange à la maison (quels repas : déjeuner, dîner, les deux ; par défaut les deux). Pré-rempli pour Jeanne à partir de son plan : Jeanne et Milan.

### 5. Inspirations recettes
Table `vie_perso_recettes` : titre, lien (facultatif), notes, avis (`aime` | `bof` | `non`). On colle un lien (Pinterest, blog) ou un titre ; Naya ne lit pas les pages en V1 (Pinterest n'a pas d'API publique de lecture des tableaux sans app validée ; à faire plus tard). Les « aime » nourrissent la génération, les « non » l'excluent.

### 6. Plan de la semaine
Table `vie_perso_plans` : utilisatrice, lundi de la semaine (unique ensemble), statut (`brouillon` | `valide`), contenu JSON validé (zod), coût, dates.

Contenu généré (genererStructure, modèle smart) :
- `jours[7]` : date, phase du cycle si connue, repas `dejeuner | diner | dessert` → titre, détail (quantités), kcal et P/L/G approximatifs pour la personne « moi », variantes par autre membre (texte), temps de préparation le jour même (min) ;
- `batch` : durée totale (≤ durée max), étapes ordonnées (appareil, action) ;
- `courses` : articles (nom, quantité, magasin, rayon, pour qui) ; les articles du placard sont exclus ;
- `regles` : 3 à 5 rappels de semaine ; `snacks` : quelques snacks approuvés.

Règles de la consigne : respecter chaque membre (exclusions jamais violées), le jeûne, l'équipement réel, les magasins donnés, les inspirations « aime », la phase du cycle ; plats communs avec variantes plutôt que deux cuisines ; tout le gros du travail dans le batch ; préparation du soir ≤ 20 min sauf week-end ; français, pas de tiret long ; ne pas inventer d'appareil.

Actions :
- **Préparer la semaine** (semaine prochaine par défaut, ou semaine en cours) → brouillon (génération en arrière-plan, 202 puis interrogation de l'état, comme le premier jet AO).
- **Changer un repas** : régénère un seul repas (consigne courte, modèle rapide) ; les courses sont recalculées par le même appel.
- **Valider** → place les tâches (§7) ; re-valider remplace les tâches perso non faites issues de ce plan.
- **Liste de courses** : cases à cocher (état gardé dans le plan), groupée par magasin puis rayon, copier en texte.

### 7. Placement dans le planning
À la validation, Naya crée des tâches perso (source `vie_perso`, `actionData.planId`) :
- **Courses** : jour et heure des courses, durée réglée (une tâche par magasin si plusieurs).
- **Batch cooking** : jour du batch, heure réglée, durée du batch généré ; description = étapes.
- **Préparer le dîner** : chaque jour où la préparation du soir dépasse 0 min, finissant à l'heure du dîner ; description = plat + variantes.
- Le déjeuner ne crée pas de tâche (il tombe dans la pause déjeuner déjà prévue).

Si un créneau est occupé (événement d'agenda, autre tâche perso), la tâche glisse au premier créneau libre de la même fenêtre perso du même jour, sinon elle reste à l'heure prévue (le chevauchement est affiché, pas caché).

### 8. Activités perso
Table `vie_perso_activites` : titre, description libre, avec qui, quand (`soir` | `week-end` | `indifferent`), date cible facultative, statut, contenu JSON (achats, étapes).
- **Nouvelle activité** : Jeanne décrit (« lettres en feutrine pour Noël, avec ma nièce, un week-end ») ; Naya découpe (genererStructure, modèle rapide) en liste d'achats et étapes (titre, durée, seule ou ensemble).
- **Planifier** : chaque étape devient une tâche perso placée au premier créneau libre de la fenêtre choisie (soirs ou week-ends), avant la date cible si donnée ; une étape « ensemble » se place le week-end. Les achats deviennent une tâche « Acheter le matériel » placée avant la première étape.

### 9. Écrans
- Web : nouvel onglet « Vie perso » (`/vie-perso`) dans l'espace « Aujourd'hui », visible si l'option est active. Sections : Semaine (plan : 7 jours, batch, courses, règles), Activités, Réglages (profil, foyer, inspirations).
- Les tâches perso apparaissent dans Aujourd'hui, Semaine et la vue horaire avec une marque discrète (pastille « perso ») ; la grille horaire s'étend jusqu'à 23 h.
- Mobile : les tâches perso apparaissent déjà via le planning ; pas d'écran dédié en V1.

### 10. Agent (discussion)
- Lecture : `consulter_vie_perso` (plan de la semaine, courses non cochées, activités).
- À valider : `preparer_repas_semaine`, `planifier_activite` (décrite en texte).
- Direct : `ajouter_course` (ajoute un article à la liste de la semaine courante).

## Hors champ (V1)
Lecture automatique de Pinterest ou des pages de recettes ; commande en ligne des courses ; écran mobile dédié ; facturation ; écriture dans Google Agenda ; plusieurs foyers ; suivi du poids.

## Ce qui est laissé au constructeur
Découpage des fichiers (dossier `server/services/vie-perso/`), noms exacts des routes sous `/api/vie-perso/*`, composants client, textes i18n fr/en.
