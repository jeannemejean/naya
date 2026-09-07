# Capter le résultat — plan d'implémentation

> **Pour les agents :** SOUS-SKILL REQUISE — `superpowers:subagent-driven-development`. Les étapes utilisent des cases à cocher (`- [ ]`).

**Objectif :** que Naya sache enfin ce qui a été fait — une notification à l'heure de fin de chaque tâche, répondable sans ouvrir l'app.

**Architecture :** l'app iOS programme elle-même des **notifications locales** (pas de push serveur, pas de jeton, pas d'APNs) à partir du plan du jour. La réponse remonte par la route de complétion existante, plus une trace dans `task_prompts` qui distingue « ignorée » de « pas fait ». Deux fonctions **pures** portent le retour immédiat et la soupape.

**Spec :** `docs/superpowers/specs/2026-09-07-naya-capter-le-resultat-design.md`

**Stack :** Expo SDK 54 / React Native (mobile), Express + Drizzle + PostgreSQL Neon (serveur), vitest.

## Contraintes globales

- **iOS uniquement.** Rien pour Android.
- **On écrit `completedAt`. On n'écrit JAMAIS `actualDuration`.** Répondre « fait » à l'heure de fin ne dit rien de l'heure de début ; l'inventer serait fabriquer une mesure à partir d'une absence — l'erreur que le Fil 3 a dû rattraper quatre fois.
- **Absence de réponse ≠ réponse négative.** Une notification ignorée n'est pas un « pas fait ». La table `task_prompts` existe pour tenir cette distinction.
- **Deux boutons : Fait / Pas fait.** Pas de « Reporter à demain » — doublon de `runEndOfDayRollover`, et euphémisme qui deviendrait la sortie confortable.
- **Le retour immédiat se tait quand il n'a rien de solide.** Jamais de compteur, jamais de palmarès, jamais de comparaison. Le silence est une sortie valide.
- **i18n :** toute chaîne visible dans `client/src/locales/fr.ts` **ET** `en.ts` côté web ; côté mobile, suivre le pattern du fichier touché. `locales.test.ts` vérifie la parité web.
- **Migrations :** `npx drizzle-kit generate`, **relecture du SQL**, application sur **dev-local uniquement** dans ce plan. La prod a désormais une baseline et `npm run db:migrate` — elle se migre au déploiement, hors de ce plan. `db:push:dev` reste réservé à dev-local.
- **Ne jamais lancer `npm install`** à la racine : il élague des paquets et crée des dossiers `« * 2 »`. Sur `mobile/`, utiliser **`npx expo install`** et jamais `npm install` — c'est ce qui avait tiré une version d'un autre SDK et cassé le démarrage.
- **Ne pas `git push`.** Le plan se termine par une revue.
- Vérification à chaque tâche serveur : `npx tsc --noEmit -p tsconfig.json` silencieux et `npx vitest run` tout vert.
- **Si une micro-décision n'est pas couverte, note ton hypothèse dans le commit.**

---

## Structure des fichiers

| Fichier | Responsabilité |
| --- | --- |
| `server/services/result-capture/insight.ts` | *(créé)* `buildImmediateInsight` — PUR |
| `server/services/result-capture/insight.test.ts` | *(créé)* |
| `server/services/result-capture/throttle.ts` | *(créé)* `unansweredStreak`, `shouldReduceFrequency` — PURS |
| `server/services/result-capture/throttle.test.ts` | *(créé)* |
| `shared/schema.ts` | *(modifié)* table `task_prompts` |
| `server/storage.ts` | *(modifié)* accès `task_prompts` |
| `server/routes.ts` | *(modifié)* enregistrement d'une réponse, plan du jour à notifier |
| `mobile/lib/notifications.ts` | *(créé)* programmation et annulation des alarmes locales |
| `mobile/app/_layout.tsx` | *(modifié)* enregistrement du gestionnaire de réponse |
| `mobile/app/(tabs)/index.tsx` | *(modifié)* reprogrammation quand le plan change |

---

### Task 1 : lever les deux inconnues — AUCUN code de feature

**Fichiers :** `mobile/app.json`, `mobile/package.json` (temporairement), et un compte rendu écrit.

C'est la tâche la plus importante du plan et elle ne produit pas de feature. Elle répond à deux questions dont dépend tout le reste. **Si tu écris du code de feature pendant cette tâche, tu as mal compris.**

**Question A — l'entitlement.** `expo-notifications` ajoutait `aps-environment` *même retiré des `plugins`*, ce qui a fait échouer les builds #5 à #9 (profil de signature sans capacité Push). **L'usage purement local en est-il exempt ?**

**Question B — la réponse app fermée.** Tout le design repose sur « répondre sans ouvrir l'app ». Une action de notification réveille l'app en arrière-plan — mais **l'app complètement fermée** est précisément l'état où sera l'utilisatrice. **La réponse remonte-t-elle dans cet état ?**

- [ ] **Étape 1 : installer le paquet, correctement**

```bash
cd mobile && npx expo install expo-notifications
```

**Jamais `npm install`** sur `mobile/` : c'est ce qui avait hoisté `expo-font@56` sur un runtime SDK 54 et cassé le démarrage. Puis :

```bash
npx expo install --check
```
Attendu : aucun décalage de version signalé. S'il y en a, corrige-les avant d'aller plus loin.

- [ ] **Étape 2 : écrire un écran de test jetable**

Dans `mobile/app/(tabs)/profile.tsx`, un bouton temporaire qui programme une notification locale à +60 s avec deux actions (`Fait` / `Pas fait`), et un gestionnaire de réponse qui écrit dans le journal de crash existant (`mobile/lib/crash.ts` poste vers `/api/mobile-crash`, lisible en GET — c'est le canal de diagnostic déjà en place, réutilise-le plutôt que d'en inventer un).

- [ ] **Étape 3 : construire pour le simulateur d'abord**

```bash
cd mobile && eas build -p ios --profile simulator --non-interactive --no-wait
```

Le profil `simulator` existe déjà dans `eas.json`. Récupère le `.tar.gz`, `tar -xzf`, puis :

```bash
xcrun simctl install booted Naya.app
xcrun simctl launch --console-pty booted app.hellonaya.naya
```

**C'est la méthode qui a débloqué la saga des crashs** : le log de lancement révèle l'erreur JS exacte, et le build EAS contourne le blocage `fmt` d'Xcode local.

- [ ] **Étape 4 : répondre à la question A**

Si le build simulateur **passe**, l'entitlement n'a pas bloqué la compilation. Vérifie quand même le profil produit pour un build `production` :

```bash
eas build -p ios --profile production --non-interactive --no-wait
```

Attendu si tout va bien : pas de `XCODE_BUILD_ERROR` sur `aps-environment`. **Si ce build échoue là-dessus, la réponse à A est « non »** — il faut la capacité Push sur le profil, ce qui exige une session interactive de Jeanne. **Arrête-toi et rapporte.**

- [ ] **Étape 5 : répondre à la question B**

Sur le simulateur, programme la notification, **ferme complètement l'app** (glisse-la hors du sélecteur d'apps, ne la mets pas seulement en arrière-plan), attends la notification, appuie sur « Fait ».

Puis lis le journal :
```bash
curl -s https://www.hellonaya.app/api/mobile-crash | tail -20
```

**Si l'entrée est là, la réponse à B est « oui »** et le design tient. **Si elle n'est pas là**, la promesse centrale tombe : il faudra une file locale qui se vide à la prochaine ouverture, et les tâches 6 et 7 de ce plan sont à repenser. **Arrête-toi et rapporte.**

- [ ] **Étape 6 : nettoyer et consigner**

Retire l'écran de test jetable. **Garde** `expo-notifications` installé si les deux réponses sont positives.

Écris les deux réponses, avec leurs preuves (extraits de log, statut des builds), dans `docs/superpowers/specs/2026-09-07-naya-capter-le-resultat-design.md`, dans une nouvelle section « Réponses aux deux inconnues ». C'est là que le prochain lecteur ira les chercher.

- [ ] **Étape 7 : commit**

```bash
git add mobile/package.json mobile/package-lock.json mobile/app.json docs/superpowers/specs/2026-09-07-naya-capter-le-resultat-design.md
git commit -m "spike(resultat): réponses aux deux inconnues iOS — entitlement et réponse app fermée"
```

> **PORTE.** Ne commence pas la tâche 2 avant que les deux réponses soient écrites. Si l'une est négative, rapporte à Jeanne : le plan change.

---

### Task 2 : le retour immédiat (fonction pure)

**Fichiers :** Créer `server/services/result-capture/insight.ts` et `insight.test.ts`

**Interfaces produites :** `TaskAnswer`, `buildImmediateInsight`, `MIN_OBSERVATIONS` — consommés par la tâche 5.

TDD strict : tests d'abord, vus échouer, puis implémentation.

**⚠️ Correction de la spec.** Son exemple « tu finis tes tâches créatives **plus vite que prévu** » n'est **pas réalisable** : il exige `actualDuration`, que ce plan interdit d'écrire. Avec `completedAt` seul, deux motifs sont réellement observables — le taux d'achèvement **par catégorie**, et l'écart **matin / après-midi**. Le plan s'en tient à ceux-là. Ne code pas l'exemple de la spec.

- [ ] **Étape 1 : écrire les tests qui échouent**

```typescript
import { describe, it, expect } from "vitest";
import { buildImmediateInsight, type TaskAnswer } from "./insight";

const rep = (n: number, category: string, done: boolean, hour = 10): TaskAnswer[] =>
  Array.from({ length: n }, () => ({ category, scheduledHour: hour, done }));

describe("buildImmediateInsight", () => {
  it("se tait quand il n'y a pas assez d'observations", () => {
    expect(buildImmediateInsight(rep(4, "admin", false))).toBeNull();
  });

  it("se tait quand rien ne se dégage", () => {
    const melange = [...rep(5, "admin", true), ...rep(5, "admin", false)];
    expect(buildImmediateInsight(melange)).toBeNull();
  });

  it("nomme une catégorie qui ne passe jamais", () => {
    const r = buildImmediateInsight(rep(6, "admin", false));
    expect(r).not.toBeNull();
    expect(r!.toLowerCase()).toContain("admin");
  });

  it("nomme l'écart matin / après-midi quand il est net", () => {
    const r = buildImmediateInsight([
      ...rep(5, "contenu", true, 9),
      ...rep(5, "contenu", false, 16),
    ]);
    expect(r).not.toBeNull();
    expect(r!.toLowerCase()).toMatch(/matin|après-midi/);
  });

  // Interdit de la spec : jamais de compteur, jamais de palmarès.
  it("ne produit jamais un compteur du type « 4/6 »", () => {
    const r = buildImmediateInsight(rep(6, "admin", false)) ?? "";
    expect(r).not.toMatch(/\d+\s*\/\s*\d+/);
  });

  it("ne classe jamais les catégories entre elles", () => {
    const r = buildImmediateInsight([
      ...rep(6, "admin", false),
      ...rep(6, "contenu", true),
    ]) ?? "";
    expect(r.toLowerCase()).not.toMatch(/meilleur|pire|classement|mieux que/);
  });

  it("une catégorie sans nom n'est jamais citée", () => {
    const sansNom: TaskAnswer[] = Array.from({ length: 6 }, () => ({
      category: null, scheduledHour: 10, done: false,
    }));
    expect(buildImmediateInsight(sansNom)).toBeNull();
  });
});
```

- [ ] **Étape 2 : lancer les tests pour les voir échouer**

Commande : `npx vitest run server/services/result-capture/insight.test.ts`
Attendu : ÉCHEC — le module `./insight` n'existe pas.

- [ ] **Étape 3 : écrire la fonction**

```typescript
/**
 * Ce que Naya vient de comprendre — une phrase, ou le silence.
 *
 * PURE : aucune base, aucune horloge, aucun appel modèle.
 *
 * Le silence est une sortie VALIDE et préférable à une banalité : c'est la même
 * règle que le `rationale` du score de réception. Et jamais de compteur, jamais de
 * palmarès, jamais de comparaison entre catégories — les interdits du Fil 3
 * s'appliquent ici aussi.
 *
 * ⚠️ Ce qu'on NE PEUT PAS dire aujourd'hui : rien sur les DURÉES. `actualDuration`
 * n'est jamais renseignée (on ne mesure pas l'heure de début), donc toute phrase du
 * type « tu finis plus vite que prévu » serait inventée.
 */

export interface TaskAnswer {
  /** Catégorie de la tâche. `null` = inconnue : on n'en dit jamais rien. */
  category: string | null;
  /** Heure de fin planifiée, 0-23. */
  scheduledHour: number;
  /** `true` = « Fait ». Une notification ignorée n'entre PAS ici. */
  done: boolean;
}

/** Observations minimales avant d'affirmer un motif. DÉFAUT RÉVISABLE. */
export const MIN_OBSERVATIONS = 5;

/** Sous ce taux d'achèvement, on considère que la catégorie ne passe pas. RÉVISABLE. */
const SEUIL_BAS = 0.25;
/** Écart minimal entre matin et après-midi pour le mentionner. RÉVISABLE. */
const ECART_MIN = 0.4;

const MIDI = 13;

export function buildImmediateInsight(answers: TaskAnswer[]): string | null {
  if (answers.length < MIN_OBSERVATIONS) return null;

  // 1. Une catégorie qui ne passe jamais.
  const parCategorie = new Map<string, { total: number; faits: number }>();
  for (const a of answers) {
    if (!a.category) continue; // une catégorie inconnue n'est jamais citée
    const e = parCategorie.get(a.category) ?? { total: 0, faits: 0 };
    e.total++;
    if (a.done) e.faits++;
    parCategorie.set(a.category, e);
  }

  for (const [cat, e] of parCategorie) {
    if (e.total < MIN_OBSERVATIONS) continue;
    if (e.faits / e.total <= SEUIL_BAS) {
      return `Les tâches « ${cat} » ne passent presque jamais. C'est peut-être le moment de les poser autrement.`;
    }
  }

  // 2. L'écart matin / après-midi.
  const matin = answers.filter((a) => a.scheduledHour < MIDI);
  const aprem = answers.filter((a) => a.scheduledHour >= MIDI);
  if (matin.length >= MIN_OBSERVATIONS && aprem.length >= MIN_OBSERVATIONS) {
    const tm = matin.filter((a) => a.done).length / matin.length;
    const ta = aprem.filter((a) => a.done).length / aprem.length;
    if (tm - ta >= ECART_MIN) {
      return `Ce qui est posé le matin se fait ; l'après-midi décroche. Je peux en tenir compte.`;
    }
    if (ta - tm >= ECART_MIN) {
      return `Tes après-midis tiennent mieux que tes matinées. Je peux en tenir compte.`;
    }
  }

  return null;
}
```

- [ ] **Étape 4 : vérifier**

```bash
npx vitest run server/services/result-capture/insight.test.ts
npx tsc --noEmit -p tsconfig.json
```

- [ ] **Étape 5 : commit**

```bash
git add server/services/result-capture/
git commit -m "feat(resultat): ce que Naya vient de comprendre, ou le silence"
```

---

### Task 3 : la soupape (fonction pure)

**Fichiers :** Créer `server/services/result-capture/throttle.ts` et `throttle.test.ts`

**Interfaces produites :** `PromptRecord`, `unansweredStreak`, `shouldReduceFrequency`, `SEUIL_SOUPAPE` — consommés par la tâche 5.

- [ ] **Étape 1 : écrire les tests qui échouent**

```typescript
import { describe, it, expect } from "vitest";
import { unansweredStreak, shouldReduceFrequency, type PromptRecord } from "./throttle";

const p = (answered: boolean): PromptRecord => ({
  answeredAt: answered ? new Date("2026-09-07T10:00:00Z") : null,
});

describe("unansweredStreak", () => {
  it("compte les notifications ignorées les plus récentes", () => {
    // Ordre : de la plus récente à la plus ancienne.
    expect(unansweredStreak([p(false), p(false), p(true), p(false)])).toBe(2);
  });

  it("une réponse remet le compteur à zéro", () => {
    expect(unansweredStreak([p(true), p(false), p(false), p(false)])).toBe(0);
  });

  it("aucune notification = aucune série", () => {
    expect(unansweredStreak([])).toBe(0);
  });
});

describe("shouldReduceFrequency", () => {
  it("ne se déclenche pas à deux", () => {
    expect(shouldReduceFrequency(2)).toBe(false);
  });

  it("se déclenche à trois — le seuil décidé avec Jeanne", () => {
    expect(shouldReduceFrequency(3)).toBe(true);
  });

  it("reste déclenchée au-delà", () => {
    expect(shouldReduceFrequency(7)).toBe(true);
  });
});
```

- [ ] **Étape 2 : lancer les tests pour les voir échouer**

Commande : `npx vitest run server/services/result-capture/throttle.test.ts`
Attendu : ÉCHEC — le module `./throttle` n'existe pas.

- [ ] **Étape 3 : écrire les fonctions**

```typescript
/**
 * La soupape — PURE.
 *
 * Jeanne a choisi une notification par tâche en connaissance de cause. Ce garde-fou
 * existe pour que le jour où c'est trop, elle ajuste plutôt qu'elle coupe : le jour où
 * elle désactive les notifications de Naya, tout s'arrête d'un coup et EN SILENCE,
 * sans qu'aucun signal ne remonte.
 *
 * ⚠️ Une notification IGNORÉE n'est pas un « pas fait ». C'est pour tenir cette
 * distinction que `task_prompts` existe : `answeredAt IS NULL` = ignorée, et ça n'entre
 * jamais dans les observations du retour immédiat.
 */

export interface PromptRecord {
  /** `null` = restée sans réponse. */
  answeredAt: Date | null;
}

/** Notifications ignorées d'affilée avant que Naya se calme. Décidé avec Jeanne. */
export const SEUIL_SOUPAPE = 3;

/** Série d'ignorées la plus récente. `prompts` est trié du plus récent au plus ancien. */
export function unansweredStreak(prompts: PromptRecord[]): number {
  let n = 0;
  for (const p of prompts) {
    if (p.answeredAt !== null) break;
    n++;
  }
  return n;
}

export function shouldReduceFrequency(streak: number): boolean {
  return streak >= SEUIL_SOUPAPE;
}
```

- [ ] **Étape 4 : vérifier**

```bash
npx vitest run server/services/result-capture/throttle.test.ts
npx tsc --noEmit -p tsconfig.json
```

- [ ] **Étape 5 : commit**

```bash
git add server/services/result-capture/
git commit -m "feat(resultat): la soupape — Naya se calme au lieu de se faire couper"
```

---

### Task 4 : la table `task_prompts` et sa migration

**Fichiers :** Modifier `shared/schema.ts`. Générer `migrations/00XX_*.sql`. Modifier `server/storage.ts`.

- [ ] **Étape 1 : déclarer la table**

Dans `shared/schema.ts`, après la table `tasks` :

```typescript
/**
 * Trace des notifications de fin de tâche.
 *
 * Elle existe pour une seule raison : distinguer « restée sans réponse » de
 * « pas fait ». **Absence de réponse ≠ réponse négative** — la même distinction que
 * « non mesuré ≠ mesuré à zéro », et elle se perdra si personne ne la défend.
 *
 * Un compteur dans les préférences aurait suffi à la soupape, mais ne saurait pas dire
 * QUELLES notifications ont été ignorées — donc aucun diagnostic possible.
 */
export const taskPrompts = pgTable("task_prompts", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  scheduledFor: timestamp("scheduled_for").notNull(),
  answeredAt: timestamp("answered_at"),
  answer: text("answer"), // done | not_done ; null tant que sans réponse
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  // La reprogrammation des alarmes doit rester idempotente jusqu'en base.
  uniquePrompt: unique("task_prompts_unique").on(t.taskId, t.scheduledFor),
}));
export type TaskPrompt = typeof taskPrompts.$inferSelect;
export type InsertTaskPrompt = typeof taskPrompts.$inferInsert;
```

Vérifie que `unique` est importé depuis `drizzle-orm/pg-core` (il l'est, utilisé par `content_reception`).

- [ ] **Étape 2 : générer et RELIRE la migration**

```bash
npx drizzle-kit generate
```

**Lis le SQL généré.** Il ne doit contenir que `CREATE TABLE task_prompts`, ses deux clés étrangères et la contrainte unique. **Aucun `DROP`, aucune modification d'une table existante.** Si autre chose apparaît, **arrête-toi et signale-le** : ce serait une nouvelle dérive entre le schéma et la base.

- [ ] **Étape 3 : appliquer sur dev-local UNIQUEMENT**

```bash
DATABASE_URL=$(grep -m1 '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '"') node -e "
const pg=require('pg'), fs=require('fs');
const p=new pg.Pool({connectionString:process.env.DATABASE_URL});
p.query(fs.readFileSync(process.argv[1],'utf8'))
 .then(()=>{console.log('migration appliquée');return p.end()})
 .catch(e=>{console.error('ERREUR:',e.message);process.exit(1)});
" migrations/<le_fichier_généré>.sql
```

**Rien sur la production** : elle se migre au déploiement, par `npm run db:migrate`, hors de ce plan.

- [ ] **Étape 4 : vérifier que le plan de réinitialisation de compte tient**

`task_prompts.user_id` est une clé étrangère vers `users`, et `task_id` vers `tasks`. Les deux sont en `ON DELETE CASCADE`, donc Postgres s'en charge — mais **vérifie-le** en lançant `npx vitest run server/services/account-reset-plan.test.ts`. Ce test a cassé deux fois dans les lots précédents pour cette raison exacte.

- [ ] **Étape 5 : les accès storage**

Ajoute à `server/storage.ts` (et les signatures à `IStorage`) : créer ou remplacer les alarmes d'un jour pour un utilisateur (idempotent, sur la clé `(taskId, scheduledFor)`), enregistrer une réponse, et lire les N dernières alarmes d'un utilisateur triées de la plus récente à la plus ancienne — c'est ce que consomme `unansweredStreak`.

- [ ] **Étape 6 : vérifier** — `npx tsc --noEmit -p tsconfig.json`, `npx vitest run`
- [ ] **Étape 7 : commit** — `git commit -m "feat(resultat): trace des notifications, pour distinguer ignorée de pas faite"`

---

### Task 5 : les routes

**Fichiers :** Modifier `server/routes.ts`

Trois routes, derrière `isAuthenticated`, vérifiant l'appartenance de la tâche :

- `GET /api/task-prompts/today` — les alarmes à poser pour aujourd'hui : pour chaque tâche non terminée du jour ayant un `scheduledEndTime`, `{ taskId, title, scheduledFor }`. Enregistre aussi les lignes `task_prompts` correspondantes (idempotent). Renvoie en plus `reduceFrequency: boolean` calculé par `shouldReduceFrequency(unansweredStreak(...))`, pour que l'app sache se calmer.
- `POST /api/task-prompts/:taskId/answer` — `{ answer: "done" | "not_done", scheduledFor }`. Enregistre la réponse dans `task_prompts`. Si `done` : marque la tâche terminée avec `completedAt = maintenant`. **N'écrit jamais `actualDuration`.** Renvoie `{ insight: string | null }` produit par `buildImmediateInsight` à partir des réponses récentes — les alarmes ignorées **n'entrent pas** dans ce calcul.
- `GET /api/task-prompts/insight` — le dernier retour, pour l'app si elle veut le réafficher.

Validation : `answer` dans les deux valeurs autorisées, `scheduledFor` parsable, `taskId` entier. Un corps malformé produit un 400, jamais un 500.

- [ ] **Étape 1 : écrire les routes** en suivant l'idiome du fichier (`req.userId`, try/catch, codes de statut)
- [ ] **Étape 2 : vérifier** — `tsc`, suite complète, `npm run build`
- [ ] **Étape 3 : commit** — `git commit -m "feat(resultat): routes des alarmes et de leur réponse"`

---

### Task 6 : programmer les alarmes (mobile)

**Fichiers :** Créer `mobile/lib/notifications.ts`. Modifier `mobile/app/(tabs)/index.tsx`.

> Dépend des réponses de la tâche 1. Si la question B est « non », **ne commence pas** : le design change.

`mobile/lib/notifications.ts` expose :
- une demande de permission, appelée une fois ;
- la déclaration de la catégorie d'actions `Fait` / `Pas fait` ;
- `syncPrompts()` : appelle `GET /api/task-prompts/today`, **annule toutes les alarmes existantes**, puis programme les nouvelles. Jamais d'empilement — même discipline que `replaceConversionAttributions` du lot 3B.

`syncPrompts()` est appelée au démarrage et à chaque fois que la liste des tâches du jour change dans `index.tsx`.

Si `reduceFrequency` est vrai, l'app ne programme que la **dernière** alarme de la journée et affiche une phrase disant que Naya se fait plus discrète — c'est la soupape, et elle doit se voir.

**Le texte de la notification** est posé ici, au moment de programmer. Il porte le titre de la tâche et **la raison**, comme Jeanne l'a demandé : court, dans la voix de Naya, une constatation et non une supplique. Registre visé — titre : le nom de la tâche ; corps : « Tu l'as faite ? C'est comme ça que je comprends ton rythme. » **Jamais de culpabilisation, jamais de compteur, jamais de point d'exclamation.** Les chaînes ne sont pas codées en dur au milieu de la logique : regroupe-les en haut du module, pour qu'on puisse les relire sans lire le code.

Imports natifs **paresseux** (`require` dans la fonction), comme `expo-av` et `expo-image-picker` dans ce dépôt : c'est ce qui évite de charger du natif au démarrage, et ça a déjà été une cause de crash au lancement.

- [ ] **Étape 1 : écrire le module et le branchement**
- [ ] **Étape 2 : vérifier** — `cd mobile && npx tsc --noEmit`
- [ ] **Étape 3 : commit** — `git commit -m "feat(resultat): l'app pose ses alarmes à partir du plan du jour"`

---

### Task 7 : traiter la réponse (mobile)

**Fichiers :** Modifier `mobile/app/_layout.tsx`, `mobile/lib/notifications.ts`

Un gestionnaire de réponse enregistré **au plus haut niveau**, qui poste vers `POST /api/task-prompts/:taskId/answer` et, si un `insight` revient, l'affiche dans une notification de confirmation discrète. Si `insight` est `null`, **aucune confirmation** — le silence est la sortie voulue.

Le gestionnaire doit fonctionner **app fermée** : c'est la question B de la tâche 1. Si la réponse était « non », c'est ici qu'on met la file locale qui se vide à la prochaine ouverture, et le plan doit avoir été révisé avant.

Échec réseau : la réponse est mise en file et rejouée à la prochaine ouverture. Ne jamais perdre une réponse — c'est la donnée que tout ce chantier existe pour capter.

- [ ] **Étape 1 : écrire le gestionnaire**
- [ ] **Étape 2 : vérifier** — `cd mobile && npx tsc --noEmit`
- [ ] **Étape 3 : commit** — `git commit -m "feat(resultat): la réponse remonte, et Naya dit ce qu'elle a compris"`

---

### Task 8 : vérification de bout en bout

- [ ] **Étape 1 : suite complète** — `npx tsc --noEmit -p tsconfig.json`, `npx vitest run`, `npm run build`. Tout vert, tests existants inchangés.

- [ ] **Étape 2 : `actualDuration` n'est écrite nulle part**

```bash
grep -rn "actualDuration" server/ --include="*.ts" | grep -v "\.test\." | grep -vE "duration-calibration|realism|routes.ts:.*Variance"
```
Attendu : aucune écriture nouvelle. La colonne reste vide, par construction.

- [ ] **Étape 3 : aucun compteur en sortie utilisateur**

```bash
grep -rnE "[0-9]+\s*/\s*[0-9]+" server/services/result-capture/ | grep -v "\.test\." || echo "aucun compteur — OK"
```

- [ ] **Étape 4 : le schéma sur dev-local**

```bash
DATABASE_URL=$(grep -m1 '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '"') node -e "
const pg=require('pg');const p=new pg.Pool({connectionString:process.env.DATABASE_URL});
p.query(\"SELECT to_regclass('public.task_prompts')::text AS t\").then(r=>{console.log(r.rows[0]);return p.end()});"
```

- [ ] **Étape 5 : build TestFlight et essai réel**

```bash
cd mobile && eas build -p ios --profile production --non-interactive --no-wait
```
Puis submit selon la procédure du dépôt : ajouter la clé ASC dans `eas.json submit` **en local uniquement**, soumettre, puis `git checkout eas.json`. Ne jamais commiter la clé.

Essai attendu sur l'iPhone de Jeanne : une notification arrive à l'heure de fin d'une tâche, « Fait » répond sans ouvrir l'app, et la tâche est cochée en base.

- [ ] **Étape 6 : rendre la main.** Ne pousse pas, ne merge pas.

---

## Notes pour l'implémenteur

- **La tâche 1 est une porte, pas une formalité.** Deux réponses écrites avant toute feature. Si l'une est négative, le plan change — rapporte plutôt que de contourner.
- **Sur `mobile/`, toujours `npx expo install`, jamais `npm install`.** Et après toute installation : `find node_modules -name "* 2*" -delete` puis vérifier `tsc`.
- **`actualDuration` reste vide.** Si tu te surprends à la calculer à partir de l'heure de fin, arrête : c'est l'erreur que ce dépôt a rattrapée quatre fois.
- **Une notification ignorée n'est pas un « pas fait ».** Elle ne doit jamais entrer dans les observations du retour immédiat.
- **Tâches 5, 6, 7 : spécifiées par exigence, pas par code verbatim** — `server/routes.ts` et les écrans mobiles sont trop gros pour que le plan dicte chaque ligne. Lis les patterns voisins et suis-les. Les contraintes listées ne sont pas négociables.
