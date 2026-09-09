# Envoi intelligent — plan d'implémentation

> **Pour les agents :** SOUS-SKILL REQUISE — `superpowers:subagent-driven-development`. Les étapes utilisent des cases à cocher (`- [ ]`).

**Objectif :** ne plus jamais écrire à un prospect en dehors de ses heures ouvrées à lui, et travailler par sessions plutôt qu'en métronome.

**Architecture :** trois filtres empilés. La garde existante (`prospection-linkedin-guard.ts`) reste le filtre le plus dur et **n'est pas modifiée**. On lui ajoute en amont une fenêtre propre à la cible, déduite de son pays, et en aval un découpage de la journée en sessions placées là où les cibles en attente sont joignables.

**Spec :** `docs/superpowers/specs/2026-09-09-naya-envoi-intelligent-design.md`

**Stack :** Express + Drizzle + PostgreSQL Neon, vitest. Serveur uniquement — `mobile/` n'est pas touché.

## Contraintes globales

- **La garde n'est jamais assouplie.** Tout refus de `decideLinkedInAction` reste un refus. Ce lot ne peut que **restreindre** davantage, jamais élargir.
- **Absence de mesure ≠ mesure nulle.** Un pays inconnu, une intersection vide, une lecture ratée → **refus + signalement**, jamais une autorisation ni un repli sur la fenêtre de l'utilisatrice (qui est précisément le défaut actuel).
- **Jamais de refus silencieux.** Un lead écarté doit porter la raison, lisible hors des logs. Un refus muet et permanent est le défaut corrigé la veille sur `linkedinAccountConnectedAt`.
- **Fonctions pures :** pas d'accès base, pas d'horloge implicite (`Date.now()`, `new Date()` sans argument), pas d'aléa interne. L'instant et la graine entrent par paramètre.
- **Fuseaux :** toute conversion passe par `server/utils/timezone.ts`. Jamais `getHours()`, `getDay()` ni `new Date("...")` nu — le processus tourne en UTC en production.
- **Constantes exportées, nommées, documentées comme défauts révisables.** Heures ouvrées d'une cible : 9 h – 18 h locales, lundi–vendredi. Sessions : 2 à 3 par jour, 10 à 20 min. Ces heures sont une **convention, pas une mesure** : Naya ne sait pas quand ses cibles travaillent.
- **Pas de troisième nombre pour le nombre d'actions par session** : il découle de la durée de session et du délai minimum déjà porté par la garde.
- **Migrations :** `npx drizzle-kit generate`, **relire le SQL**, appliquer sur **dev-local uniquement**. Lire `MIGRATIONS.md` avant de toucher une base. Un `DROP` dans le SQL généré → arrêt et signalement.
- **Ne jamais lancer `npm install`.** **Ne jamais `git push`.** Ne pas toucher la production ni ses variables.
- Vérification à chaque tâche : `npx tsc --noEmit -p tsconfig.json` silencieux et `npx vitest run` vert **sous deux fuseaux éloignés** (`TZ=UTC` et `TZ=Pacific/Kiritimati`).
- **Si une micro-décision n'est pas couverte, noter l'hypothèse dans le commit** plutôt que deviner en silence.

## Structure des fichiers

| Fichier | Responsabilité |
| --- | --- |
| `server/utils/timezone.ts` *(modifié)* | Généralise la conversion heure murale → instant à n'importe quel fuseau. |
| `server/services/prospection-target-zones.ts` *(créé)* | Table pays → fuseaux IANA. Donnée, pas logique. |
| `server/services/prospection-target-hours.ts` *(créé)* | Fenêtre UTC joignable d'une cible pour une date. Pure. |
| `server/services/prospection-sessions.ts` *(créé)* | Découpage de la journée en sessions, placées selon les fuseaux en attente. Pure. |
| `server/services/prospection-sender.ts` *(modifié)* | Branchement. Aucune logique de décision. |
| `shared/schema.ts` *(modifié)* | Colonne portant la raison de non-joignabilité. |

---

### Task 1 : généraliser la conversion de fuseau

**Fichiers :**
- Modifier : `server/utils/timezone.ts`
- Test : `server/utils/timezone.test.ts`

**Interfaces :**
- Produit : `wallClockToInstant(timeZone: string, dateStr: string, hhmm: string): Date`

`parisWallClockToInstant` contient déjà l'algorithme correct à deux passes d'échantillonnage (corrigé pour l'heure d'été après un défaut трouvé en revue). Il est codé en dur sur `Europe/Paris`. On le généralise **sans changer son comportement** : `parisWallClockToInstant` devient un appel à la version générique.

- [ ] **Étape 1 : écrire les tests d'abord**

```ts
import { describe, it, expect } from "vitest";
import { wallClockToInstant } from "./timezone";

describe("wallClockToInstant", () => {
  it("convertit une heure murale de New York en heure d'été", () => {
    // 2026-07-15 09:00 EDT = UTC-4 → 13:00 UTC
    expect(wallClockToInstant("America/New_York", "2026-07-15", "09:00").toISOString())
      .toBe("2026-07-15T13:00:00.000Z");
  });

  it("convertit une heure murale de New York en heure d'hiver", () => {
    // 2026-01-15 09:00 EST = UTC-5 → 14:00 UTC
    expect(wallClockToInstant("America/New_York", "2026-01-15", "09:00").toISOString())
      .toBe("2026-01-15T14:00:00.000Z");
  });

  it("gère un décalage à la demi-heure", () => {
    // Asia/Kolkata = UTC+5:30, pas de changement d'heure
    expect(wallClockToInstant("Asia/Kolkata", "2026-07-15", "09:00").toISOString())
      .toBe("2026-07-15T03:30:00.000Z");
  });

  it("gère minuit sans produire 24 h", () => {
    expect(wallClockToInstant("Asia/Hong_Kong", "2026-07-15", "00:00").toISOString())
      .toBe("2026-07-14T16:00:00.000Z");
  });

  it("reste correct dans la zone dangereuse d'une bascule non européenne", () => {
    // Bascule US le 2026-11-01 à 02:00 locale. 01:30 existe et n'est pas ambiguë
    // côté algorithme : l'aller-retour doit redonner l'heure demandée.
    const instant = wallClockToInstant("America/New_York", "2026-11-01", "01:30");
    const relu = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).format(instant);
    expect(relu).toBe("01:30");
  });
});
```

- [ ] **Étape 2 : lancer et constater l'échec**

`npx vitest run server/utils/timezone.test.ts`
Attendu : `wallClockToInstant is not a function` (ou erreur d'import). **Si un test passe déjà, la fonction existe : arrête-toi et rapporte.**

- [ ] **Étape 3 : généraliser**

Renomme `parisOffsetMinutesAt(instant)` en `offsetMinutesAt(timeZone, instant)` en remplaçant `timeZone: "Europe/Paris"` par le paramètre. Extrais le corps de `parisWallClockToInstant` en :

```ts
export function wallClockToInstant(timeZone: string, dateStr: string, hhmm: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  const [hour, minute] = hhmm.split(":").map(Number);
  const candidateUTC = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const firstGuessOffsetMin = offsetMinutesAt(timeZone, new Date(candidateUTC));
  const correctedInstant = candidateUTC - firstGuessOffsetMin * 60_000;
  const offsetMin = offsetMinutesAt(timeZone, new Date(correctedInstant));
  return new Date(candidateUTC - offsetMin * 60_000);
}

export function parisWallClockToInstant(dateStr: string, hhmm: string): Date {
  return wallClockToInstant(PARIS_TZ, dateStr, hhmm);
}
```

Conserve **intégralement** le commentaire d'en-tête existant : il documente le défaut d'échantillonnage corrigé en revue et la raison des deux passes (balayage de 8640 couples sur 2024-2035). Adapte-le pour dire que la garantie vaut désormais pour tout fuseau.

- [ ] **Étape 4 : vérifier**

`TZ=UTC npx vitest run` puis `TZ=Pacific/Kiritimati npx vitest run` — tout vert, **y compris les tests Paris existants, inchangés**. `npx tsc --noEmit -p tsconfig.json` silencieux.

- [ ] **Étape 5 : commit**

```bash
git add server/utils/timezone.ts server/utils/timezone.test.ts
git commit -m "refactor(timezone): conversion heure murale generalisee a tout fuseau"
```

---

### Task 2 : la table pays → fuseaux

**Fichiers :**
- Créer : `server/services/prospection-target-zones.ts`
- Test : `server/services/prospection-target-zones.test.ts`

**Interfaces :**
- Produit : `zonesForCountry(countryCode: string): string[] | null`

De la donnée, pas de la logique. `null` = pays inconnu, qui devra provoquer un refus en aval.

**Décision de périmètre à respecter :** la ville n'est **pas** utilisée. La spec l'autorisait pour lever l'ambiguïté d'un pays multi-fuseaux, mais l'intersection de tous les fuseaux du pays est toujours valable et ne demande aucune table de villes à maintenir. On ne construit pas ce qu'on n'a pas prouvé nécessaire.

- [ ] **Étape 1 : écrire les tests d'abord**

```ts
import { describe, it, expect } from "vitest";
import { zonesForCountry } from "./prospection-target-zones";

describe("zonesForCountry", () => {
  it("rend un fuseau unique pour un pays mono-fuseau", () => {
    expect(zonesForCountry("FR")).toEqual(["Europe/Paris"]);
  });

  it("rend tous les fuseaux d'un pays multi-fuseaux", () => {
    const us = zonesForCountry("US");
    expect(us).toContain("America/New_York");
    expect(us).toContain("America/Los_Angeles");
    expect(us!.length).toBeGreaterThan(2);
  });

  it("couvre les pays reellement presents dans la base", () => {
    for (const cc of ["FR", "EG", "US", "IN", "GB", "ES", "AE", "HK", "KW", "CA", "MG"]) {
      expect(zonesForCountry(cc), `pays manquant : ${cc}`).not.toBeNull();
    }
  });

  it("accepte un code en minuscules", () => {
    expect(zonesForCountry("fr")).toEqual(["Europe/Paris"]);
  });

  it("rend null pour un pays inconnu, jamais un tableau vide", () => {
    expect(zonesForCountry("ZZ")).toBeNull();
    expect(zonesForCountry("")).toBeNull();
  });

  it("ne declare que des fuseaux IANA valides", () => {
    const tous = ["FR", "US", "CA", "ES", "AU", "BR", "RU", "IN", "HK"]
      .flatMap((cc) => zonesForCountry(cc) ?? []);
    for (const z of tous) {
      expect(() => new Intl.DateTimeFormat("en-US", { timeZone: z }), `fuseau invalide : ${z}`)
        .not.toThrow();
    }
  });
});
```

- [ ] **Étape 2 : lancer et constater l'échec**

`npx vitest run server/services/prospection-target-zones.test.ts`
Attendu : module introuvable.

- [ ] **Étape 3 : écrire la table**

```ts
/**
 * Pays (ISO 3166-1 alpha-2) → fuseaux IANA qu'il couvre.
 *
 * DONNÉE, pas logique. Un pays multi-fuseaux liste TOUS ses fuseaux : l'appelant
 * en prend l'intersection plutôt que de deviner lequel s'applique. La ville n'est
 * volontairement pas utilisée — l'intersection est toujours valable et n'exige
 * aucune table de villes à maintenir.
 *
 * `null` (pays absent) ≠ tableau vide : absent veut dire « on ne sait pas », et
 * l'appelant doit REFUSER, pas se replier sur le fuseau de l'utilisatrice.
 *
 * Liste volontairement partielle : elle couvre les pays présents en base plus les
 * marchés voisins. Ajouter un pays est une modification de donnée, sans risque.
 */
const ZONES_PAR_PAYS: Record<string, string[]> = {
  // Europe
  FR: ["Europe/Paris"], BE: ["Europe/Brussels"], CH: ["Europe/Zurich"],
  DE: ["Europe/Berlin"], IT: ["Europe/Rome"], NL: ["Europe/Amsterdam"],
  GB: ["Europe/London"], IE: ["Europe/Dublin"], PT: ["Europe/Lisbon", "Atlantic/Azores"],
  ES: ["Europe/Madrid", "Atlantic/Canary"], LU: ["Europe/Luxembourg"],
  SE: ["Europe/Stockholm"], NO: ["Europe/Oslo"], DK: ["Europe/Copenhagen"],
  PL: ["Europe/Warsaw"], AT: ["Europe/Vienna"], GR: ["Europe/Athens"],
  // Amériques
  US: ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
       "America/Anchorage", "Pacific/Honolulu"],
  CA: ["America/St_Johns", "America/Halifax", "America/Toronto", "America/Winnipeg",
       "America/Edmonton", "America/Vancouver"],
  MX: ["America/Mexico_City", "America/Tijuana"],
  BR: ["America/Sao_Paulo", "America/Manaus", "America/Rio_Branco"],
  AR: ["America/Argentina/Buenos_Aires"], CL: ["America/Santiago", "Pacific/Easter"],
  // Afrique / Moyen-Orient
  EG: ["Africa/Cairo"], MA: ["Africa/Casablanca"], TN: ["Africa/Tunis"],
  DZ: ["Africa/Algiers"], SN: ["Africa/Dakar"], CI: ["Africa/Abidjan"],
  ZA: ["Africa/Johannesburg"], MG: ["Indian/Antananarivo"], MU: ["Indian/Mauritius"],
  AE: ["Asia/Dubai"], KW: ["Asia/Kuwait"], SA: ["Asia/Riyadh"], QA: ["Asia/Qatar"],
  IL: ["Asia/Jerusalem"], TR: ["Europe/Istanbul"], LB: ["Asia/Beirut"],
  // Asie / Océanie
  IN: ["Asia/Kolkata"], HK: ["Asia/Hong_Kong"], SG: ["Asia/Singapore"],
  JP: ["Asia/Tokyo"], KR: ["Asia/Seoul"], CN: ["Asia/Shanghai"],
  TH: ["Asia/Bangkok"], VN: ["Asia/Ho_Chi_Minh"], ID: ["Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura"],
  AU: ["Australia/Perth", "Australia/Adelaide", "Australia/Brisbane", "Australia/Sydney"],
  NZ: ["Pacific/Auckland"],
};

export function zonesForCountry(countryCode: string): string[] | null {
  if (!countryCode) return null;
  return ZONES_PAR_PAYS[countryCode.trim().toUpperCase()] ?? null;
}
```

- [ ] **Étape 4 : vérifier**

`TZ=UTC npx vitest run` et `TZ=Pacific/Kiritimati npx vitest run` verts, `npx tsc --noEmit -p tsconfig.json` silencieux.

- [ ] **Étape 5 : commit**

```bash
git add server/services/prospection-target-zones.ts server/services/prospection-target-zones.test.ts
git commit -m "feat(envoi-intelligent): table pays vers fuseaux IANA"
```

---

### Task 3 : la fenêtre joignable d'une cible

**Fichiers :**
- Créer : `server/services/prospection-target-hours.ts`
- Test : `server/services/prospection-target-hours.test.ts`

**Interfaces :**
- Consomme : `wallClockToInstant` (Task 1), `zonesForCountry` (Task 2)
- Produit :

```ts
export const TARGET_WORK_START_HHMM = "09:00";
export const TARGET_WORK_END_HHMM = "18:00";
export const TARGET_WORK_DAYS: ReadonlySet<string>;

export type TargetWindow =
  | { reachable: true; start: Date; end: Date }
  | { reachable: false; reason: "country_unknown" | "no_common_window" | "not_a_workday" | "outside_window"; detail: string };

export function targetWindowUTC(countryCode: string | null, dateStr: string): TargetWindow;
export function isTargetReachableAt(countryCode: string | null, now: Date, dateStr: string): TargetWindow;
```

La fenêtre est l'**intersection** des créneaux 9 h – 18 h locaux de **tous** les fuseaux du pays : valable où que soit la personne. `end` est exclusif.

- [ ] **Étape 1 : écrire les tests d'abord**

```ts
import { describe, it, expect } from "vitest";
import { targetWindowUTC, isTargetReachableAt } from "./prospection-target-hours";

describe("targetWindowUTC", () => {
  it("rend la fenetre locale d'un pays mono-fuseau", () => {
    // 2026-07-15, Paris = UTC+2 → 09:00-18:00 locales = 07:00-16:00 UTC
    const w = targetWindowUTC("FR", "2026-07-15");
    expect(w.reachable).toBe(true);
    if (!w.reachable) return;
    expect(w.start.toISOString()).toBe("2026-07-15T07:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-07-15T16:00:00.000Z");
  });

  it("rend l'intersection de tous les fuseaux d'un pays multi-fuseaux", () => {
    // US en juillet : le plus a l'est (New_York, UTC-4) ouvre a 13:00 UTC et ferme
    // a 22:00 UTC ; Honolulu (UTC-10) ouvre a 19:00 UTC. L'intersection commence
    // donc au plus tard des debuts et finit au plus tot des fins.
    const w = targetWindowUTC("US", "2026-07-15");
    if (!w.reachable) throw new Error("attendu joignable");
    expect(w.start.getTime()).toBeGreaterThan(
      new Date("2026-07-15T13:00:00.000Z").getTime(),
    );
    expect(w.end.getTime()).toBeLessThanOrEqual(
      new Date("2026-07-15T22:00:00.000Z").getTime(),
    );
    expect(w.end.getTime()).toBeGreaterThan(w.start.getTime());
  });

  it("signale un pays inconnu au lieu d'autoriser", () => {
    const w = targetWindowUTC("ZZ", "2026-07-15");
    expect(w.reachable).toBe(false);
    if (w.reachable) return;
    expect(w.reason).toBe("country_unknown");
    expect(w.detail.length).toBeGreaterThan(0);
  });

  it("signale un pays absent au lieu d'autoriser", () => {
    const w = targetWindowUTC(null, "2026-07-15");
    expect(w.reachable).toBe(false);
    if (w.reachable) return;
    expect(w.reason).toBe("country_unknown");
  });

  it("signale l'absence de fenetre commune quand l'intersection est vide", () => {
    // Fabrique le cas : un pays dont les fuseaux sont trop ecartes n'a pas de
    // creneau 9-18 commun. On le verifie sur un pays reel a large etalement.
    const w = targetWindowUTC("ID", "2026-07-15");
    if (!w.reachable) {
      expect(w.reason).toBe("no_common_window");
    } else {
      // Si l'intersection existe, elle doit rester coherente.
      expect(w.end.getTime()).toBeGreaterThan(w.start.getTime());
    }
  });

  it("refuse le week-end", () => {
    // 2026-07-18 est un samedi
    const w = targetWindowUTC("FR", "2026-07-18");
    expect(w.reachable).toBe(false);
    if (w.reachable) return;
    expect(w.reason).toBe("not_a_workday");
  });
});

describe("isTargetReachableAt", () => {
  it("autorise a l'interieur de la fenetre", () => {
    const r = isTargetReachableAt("FR", new Date("2026-07-15T10:00:00.000Z"), "2026-07-15");
    expect(r.reachable).toBe(true);
  });

  it("refuse avant l'ouverture", () => {
    const r = isTargetReachableAt("FR", new Date("2026-07-15T06:59:00.000Z"), "2026-07-15");
    expect(r.reachable).toBe(false);
  });

  it("refuse a la borne de fin, exclusive", () => {
    const r = isTargetReachableAt("FR", new Date("2026-07-15T16:00:00.000Z"), "2026-07-15");
    expect(r.reachable).toBe(false);
  });
});
```

- [ ] **Étape 2 : lancer et constater l'échec**

`npx vitest run server/services/prospection-target-hours.test.ts` → module introuvable.

- [ ] **Étape 3 : implémenter**

```ts
import { wallClockToInstant } from "../utils/timezone";
import { zonesForCountry } from "./prospection-target-zones";

/**
 * Heures ouvrées supposées d'un prospect, dans SON fuseau.
 *
 * ⚠️ DÉFAUT RÉVISABLE, et surtout : c'est une CONVENTION, pas une mesure. Naya ne
 * sait pas quand ses cibles travaillent — l'enrichissement ne capture aucun
 * horodatage d'activité (vérifié : le champ `activity` porte id/img/link/title/
 * interaction, jamais de date). Le jour où on capte l'activité réelle, ces bornes
 * deviennent une mesure. En attendant, elles sont nommées ici pour qu'on se
 * souvienne qu'on les a choisies.
 */
export const TARGET_WORK_START_HHMM = "09:00";
export const TARGET_WORK_END_HHMM = "18:00";
export const TARGET_WORK_DAYS: ReadonlySet<string> = new Set(["mon", "tue", "wed", "thu", "fri"]);

const JOURS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export type TargetWindow =
  | { reachable: true; start: Date; end: Date }
  | { reachable: false; reason: "country_unknown" | "no_common_window" | "not_a_workday" | "outside_window"; detail: string };

/**
 * Fenêtre UTC pendant laquelle une cible de ce pays est joignable, ce jour-là.
 *
 * Pays multi-fuseaux : on prend l'INTERSECTION des créneaux locaux de tous ses
 * fuseaux, plutôt que de deviner lequel s'applique. Étroit, mais juste où que soit
 * la personne. Aux États-Unis, cela donne l'après-midi côte est, qui est aussi la
 * matinée côte ouest.
 *
 * PURE : `dateStr` et le pays entrent par paramètre, aucune horloge implicite.
 */
export function targetWindowUTC(countryCode: string | null, dateStr: string): TargetWindow {
  const zones = countryCode ? zonesForCountry(countryCode) : null;
  if (!zones || zones.length === 0) {
    return {
      reachable: false,
      reason: "country_unknown",
      detail:
        `pays « ${countryCode ?? "absent"} » inconnu de la table des fuseaux — refus par prudence. ` +
        `Ne PAS se replier sur le fuseau de l'utilisatrice : c'est ce repli qui fait ` +
        `aujourd'hui arriver des messages en pleine nuit chez la cible.`,
    };
  }

  // Jour ouvré évalué en UTC sur la date civile demandée : la date est déjà celle
  // que l'appelant a choisie, on ne la redécale pas.
  const [y, m, d] = dateStr.split("-").map(Number);
  const jour = JOURS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  if (!TARGET_WORK_DAYS.has(jour)) {
    return { reachable: false, reason: "not_a_workday", detail: `${dateStr} est un ${jour} chez la cible.` };
  }

  let start = -Infinity;
  let end = Infinity;
  for (const zone of zones) {
    const zStart = wallClockToInstant(zone, dateStr, TARGET_WORK_START_HHMM).getTime();
    const zEnd = wallClockToInstant(zone, dateStr, TARGET_WORK_END_HHMM).getTime();
    start = Math.max(start, zStart);
    end = Math.min(end, zEnd);
  }

  if (!(end > start)) {
    return {
      reachable: false,
      reason: "no_common_window",
      detail:
        `les fuseaux de ce pays (${zones.join(", ")}) n'ont aucun créneau ${TARGET_WORK_START_HHMM}-` +
        `${TARGET_WORK_END_HHMM} commun le ${dateStr} — cible signalée, jamais contactée au hasard.`,
    };
  }
  return { reachable: true, start: new Date(start), end: new Date(end) };
}

/** La cible est-elle joignable À CET INSTANT ? Borne de fin exclusive. */
export function isTargetReachableAt(countryCode: string | null, now: Date, dateStr: string): TargetWindow {
  const w = targetWindowUTC(countryCode, dateStr);
  if (!w.reachable) return w;
  const t = now.getTime();
  if (t < w.start.getTime() || t >= w.end.getTime()) {
    return {
      reachable: false,
      reason: "outside_window",
      detail: `hors de la fenêtre locale de la cible (${w.start.toISOString()} → ${w.end.toISOString()}).`,
    };
  }
  return w;
}
```

- [ ] **Étape 4 : vérifier** — `TZ=UTC` puis `TZ=Pacific/Kiritimati`, plus `npx tsc --noEmit -p tsconfig.json`.

- [ ] **Étape 5 : commit**

```bash
git add server/services/prospection-target-hours.ts server/services/prospection-target-hours.test.ts
git commit -m "feat(envoi-intelligent): fenetre joignable d'une cible dans son fuseau"
```

---

### Task 4 : placer les sessions là où sont les cibles

**Fichiers :**
- Créer : `server/services/prospection-sessions.ts`
- Test : `server/services/prospection-sessions.test.ts`

**Interfaces :**
- Consomme : `targetWindowUTC` (Task 3)
- Produit :

```ts
export const SESSIONS_MIN_PER_DAY = 2;
export const SESSIONS_MAX_PER_DAY = 3;
export const SESSION_MIN_DURATION_MS = 10 * 60_000;
export const SESSION_MAX_DURATION_MS = 20 * 60_000;

export interface Session { start: Date; end: Date }

export function planDailySessions(input: {
  userWindowStart: Date;
  userWindowEnd: Date;
  pendingCountryCodes: string[];
  dateStr: string;
  seed: number;
}): Session[];

export function isWithinAnySession(sessions: Session[], now: Date): boolean;
```

**Le point central :** les sessions ne sont pas tirées au hasard puis confrontées aux cibles. Elles sont placées **là où les cibles en attente sont joignables**. Sans cela, les leads hors d'Europe attendraient qu'une session tombe au bon endroit par chance.

L'aléa entre par `seed` : même graine → même découpage, donc testable.

- [ ] **Étape 1 : écrire les tests d'abord**

```ts
import { describe, it, expect } from "vitest";
import { planDailySessions, isWithinAnySession } from "./prospection-sessions";

const FENETRE = {
  userWindowStart: new Date("2026-07-15T07:00:00.000Z"), // 9h Paris
  userWindowEnd: new Date("2026-07-15T16:00:00.000Z"),   // 18h Paris
  dateStr: "2026-07-15",
};

describe("planDailySessions", () => {
  it("est deterministe pour une meme graine", () => {
    const a = planDailySessions({ ...FENETRE, pendingCountryCodes: ["FR"], seed: 42 });
    const b = planDailySessions({ ...FENETRE, pendingCountryCodes: ["FR"], seed: 42 });
    expect(a.map((s) => s.start.toISOString())).toEqual(b.map((s) => s.start.toISOString()));
  });

  it("produit un decoupage different d'un jour a l'autre", () => {
    const j1 = planDailySessions({ ...FENETRE, pendingCountryCodes: ["FR"], seed: 1 });
    const j2 = planDailySessions({ ...FENETRE, pendingCountryCodes: ["FR"], seed: 2 });
    expect(j1.map((s) => s.start.toISOString())).not.toEqual(j2.map((s) => s.start.toISOString()));
  });

  it("produit entre 2 et 3 sessions", () => {
    const s = planDailySessions({ ...FENETRE, pendingCountryCodes: ["FR"], seed: 7 });
    expect(s.length).toBeGreaterThanOrEqual(2);
    expect(s.length).toBeLessThanOrEqual(3);
  });

  it("place les sessions dans la fenetre de l'utilisatrice, jamais en dehors", () => {
    const s = planDailySessions({ ...FENETRE, pendingCountryCodes: ["FR", "US"], seed: 3 });
    for (const sess of s) {
      expect(sess.start.getTime()).toBeGreaterThanOrEqual(FENETRE.userWindowStart.getTime());
      expect(sess.end.getTime()).toBeLessThanOrEqual(FENETRE.userWindowEnd.getTime());
      expect(sess.end.getTime()).toBeGreaterThan(sess.start.getTime());
    }
  });

  it("couvre les fuseaux presents : une file americaine tire la fin de journee", () => {
    const fr = planDailySessions({ ...FENETRE, pendingCountryCodes: ["FR"], seed: 5 });
    const us = planDailySessions({ ...FENETRE, pendingCountryCodes: ["US"], seed: 5 });
    const dernierFr = Math.max(...fr.map((s) => s.end.getTime()));
    const dernierUs = Math.max(...us.map((s) => s.end.getTime()));
    expect(dernierUs).toBeGreaterThan(dernierFr);
  });

  it("ne produit aucune session quand la file est vide", () => {
    expect(planDailySessions({ ...FENETRE, pendingCountryCodes: [], seed: 9 })).toEqual([]);
  });

  it("ne produit aucune session quand aucune cible n'est joignable dans la fenetre", () => {
    // NZ : 9-18 a Auckland ne croise pas 9-18 a Paris.
    expect(planDailySessions({ ...FENETRE, pendingCountryCodes: ["NZ"], seed: 4 })).toEqual([]);
  });

  it("ignore un pays inconnu sans planter", () => {
    const s = planDailySessions({ ...FENETRE, pendingCountryCodes: ["ZZ", "FR"], seed: 6 });
    expect(s.length).toBeGreaterThanOrEqual(2);
  });
});

describe("isWithinAnySession", () => {
  it("reconnait un instant a l'interieur d'une session", () => {
    const s = [{ start: new Date("2026-07-15T09:00:00.000Z"), end: new Date("2026-07-15T09:15:00.000Z") }];
    expect(isWithinAnySession(s, new Date("2026-07-15T09:05:00.000Z"))).toBe(true);
  });

  it("exclut la borne de fin", () => {
    const s = [{ start: new Date("2026-07-15T09:00:00.000Z"), end: new Date("2026-07-15T09:15:00.000Z") }];
    expect(isWithinAnySession(s, new Date("2026-07-15T09:15:00.000Z"))).toBe(false);
  });

  it("refuse quand il n'y a aucune session", () => {
    expect(isWithinAnySession([], new Date("2026-07-15T09:05:00.000Z"))).toBe(false);
  });
});
```

- [ ] **Étape 2 : lancer et constater l'échec** — module introuvable.

- [ ] **Étape 3 : implémenter**

```ts
import { targetWindowUTC } from "./prospection-target-hours";

/** ⚠️ DÉFAUTS RÉVISABLES. Un humain ouvre LinkedIn, traite quelques personnes, referme. */
export const SESSIONS_MIN_PER_DAY = 2;
export const SESSIONS_MAX_PER_DAY = 3;
export const SESSION_MIN_DURATION_MS = 10 * 60_000;
export const SESSION_MAX_DURATION_MS = 20 * 60_000;

export interface Session { start: Date; end: Date }

/** Générateur déterministe (mulberry32) : l'aléa entre par la graine, jamais tiré ici. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Découpe la journée en 2 ou 3 sessions, placées LÀ OÙ LES CIBLES EN ATTENTE SONT
 * JOIGNABLES.
 *
 * L'ordre est inversé par rapport à l'intuition : on ne tire pas des sessions au
 * hasard pour chercher ensuite qui peut recevoir. Le placement décide de qui est
 * joignable ce jour-là — sans cela, les leads hors d'Europe attendraient qu'une
 * session tombe au bon endroit par chance.
 *
 * PURE : aucune horloge, aucun aléa interne.
 */
export function planDailySessions(input: {
  userWindowStart: Date;
  userWindowEnd: Date;
  pendingCountryCodes: string[];
  dateStr: string;
  seed: number;
}): Session[] {
  const uStart = input.userWindowStart.getTime();
  const uEnd = input.userWindowEnd.getTime();
  if (!(uEnd > uStart)) return [];

  // Intervalles réellement exploitables : intersection fenêtre utilisatrice × fenêtre
  // de chaque pays présent. Un pays inconnu ou sans créneau commun est simplement
  // absent d'ici — il sera signalé côté lead, pas ignoré en silence.
  const creneaux: Array<[number, number]> = [];
  for (const cc of new Set(input.pendingCountryCodes)) {
    const w = targetWindowUTC(cc, input.dateStr);
    if (!w.reachable) continue;
    const s = Math.max(uStart, w.start.getTime());
    const e = Math.min(uEnd, w.end.getTime());
    if (e - s >= SESSION_MIN_DURATION_MS) creneaux.push([s, e]);
  }
  if (creneaux.length === 0) return [];

  const rand = rng(input.seed);
  const combien = SESSIONS_MIN_PER_DAY +
    Math.floor(rand() * (SESSIONS_MAX_PER_DAY - SESSIONS_MIN_PER_DAY + 1));

  const sessions: Session[] = [];
  for (let i = 0; i < combien; i++) {
    // On répartit les sessions sur les créneaux disponibles, en tournant : une file
    // mixte FR + US obtient ainsi de la matinée ET de la fin d'après-midi.
    const [cs, ce] = creneaux[i % creneaux.length];
    const duree = SESSION_MIN_DURATION_MS +
      Math.floor(rand() * (SESSION_MAX_DURATION_MS - SESSION_MIN_DURATION_MS + 1));
    const marge = ce - cs - duree;
    if (marge < 0) continue;
    const start = cs + Math.floor(rand() * (marge + 1));
    sessions.push({ start: new Date(start), end: new Date(start + duree) });
  }
  return sessions.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** Borne de fin exclusive, comme partout ailleurs dans ce lot. */
export function isWithinAnySession(sessions: Session[], now: Date): boolean {
  const t = now.getTime();
  return sessions.some((s) => t >= s.start.getTime() && t < s.end.getTime());
}
```

- [ ] **Étape 4 : vérifier** sous les deux fuseaux + `tsc`.

- [ ] **Étape 5 : commit**

```bash
git add server/services/prospection-sessions.ts server/services/prospection-sessions.test.ts
git commit -m "feat(envoi-intelligent): sessions placees la ou les cibles sont joignables"
```

---

### Task 5 : signaler une cible non joignable, sans jamais la perdre en silence

**Fichiers :**
- Modifier : `shared/schema.ts` (table `leads`)
- Modifier : `server/storage.ts`
- Migration : `migrations/`

**Interfaces :**
- Produit : colonne `leads.outreach_unreachable_reason` (`text`, nullable) et `storage.setLeadUnreachable(leadId, reason: string | null)`

Un lead écarté parce que son pays est inconnu ou sans créneau commun doit **porter la raison**. Un refus muet et permanent est le défaut corrigé la veille sur `linkedinAccountConnectedAt` : la fonctionnalité paraissait morte et personne ne savait pourquoi.

- [ ] **Étape 1 : ajouter la colonne**

Dans `shared/schema.ts`, table `leads` :

```ts
  /**
   * Pourquoi ce lead n'est pas joignable par la fenêtre horaire (pays inconnu,
   * aucun créneau commun). `null` = joignable. JAMAIS un refus silencieux :
   * cette colonne existe pour qu'un lead écarté soit visible et diagnosticable.
   */
  outreachUnreachableReason: text("outreach_unreachable_reason"),
```

- [ ] **Étape 2 : générer et RELIRE le SQL**

```bash
npx drizzle-kit generate
```

Ouvre le fichier généré. Attendu : un seul `ALTER TABLE "leads" ADD COLUMN "outreach_unreachable_reason" text;`. **S'il contient un `DROP`, arrête-toi et rapporte sans appliquer.**

- [ ] **Étape 3 : appliquer sur dev-local UNIQUEMENT**

Lis `MIGRATIONS.md` §4. Vérifie que le `DATABASE_URL` du `.env` pointe bien sur l'endpoint dev-local **avant** d'exécuter quoi que ce soit. La production ne reçoit rien dans ce plan.

- [ ] **Étape 4 : ajouter l'accès en base**

Dans `server/storage.ts`, à côté des autres écritures sur `leads` :

```ts
  async setLeadUnreachable(leadId: number, reason: string | null): Promise<void> {
    await db.update(leads)
      .set({ outreachUnreachableReason: reason })
      .where(eq(leads.id, leadId));
  },
```

Déclare la signature dans l'interface `IStorage`.

- [ ] **Étape 5 : vérifier** — `npx tsc --noEmit -p tsconfig.json` silencieux, `npx vitest run` vert. `account-reset-plan.test.ts` doit rester vert (il vérifie l'invariant des clés étrangères).

- [ ] **Étape 6 : commit**

```bash
git add shared/schema.ts server/storage.ts migrations/
git commit -m "feat(envoi-intelligent): trace la raison de non-joignabilite d'un lead"
```

---

### Task 6 : brancher dans le worker

**Fichiers :**
- Modifier : `server/services/prospection-sender.ts`

**Interfaces :**
- Consomme : `isTargetReachableAt` (Task 3), `planDailySessions` / `isWithinAnySession` (Task 4), `setLeadUnreachable` (Task 5)

**Ordre impératif :** la garde existante reste le filtre le plus dur. Les nouveaux filtres ne peuvent que **restreindre davantage**.

- [ ] **Étape 1 : planifier les sessions une fois par passage**

Au début de `runProspectionSender`, après la lecture des leads dus et **avant** la boucle. La graine doit être stable sur la journée et changer le lendemain — dérive-la de `userId` + date du jour, jamais de `Math.random()` :

```ts
import { parisTodayString } from "../utils/timezone";
import { planDailySessions, isWithinAnySession } from "./prospection-sessions";
import { isTargetReachableAt } from "./prospection-target-hours";

/** Graine stable sur la journée, différente le lendemain et d'un utilisateur à l'autre. */
function graineDuJour(userId: string, dateStr: string): number {
  let h = 2166136261;
  for (const ch of `${userId}:${dateStr}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const todayStr = parisTodayString(now);
const sessionsParUser = new Map<string, ReturnType<typeof planDailySessions>>();

function sessionsDe(userId: string, prefs: any, paysEnAttente: string[]) {
  const cache = sessionsParUser.get(userId);
  if (cache) return cache;
  const plan = planDailySessions({
    userWindowStart: wallClockToInstant(prefs.timezone, todayStr, "09:00"),
    userWindowEnd: wallClockToInstant(prefs.timezone, todayStr, "18:00"),
    pendingCountryCodes: paysEnAttente,
    dateStr: todayStr,
    seed: graineDuJour(userId, todayStr),
  });
  sessionsParUser.set(userId, plan);
  return plan;
}
```

`paysEnAttente` = les pays des leads dus de cet utilisateur, extraits comme à l'étape 2. Les bornes 9 h / 18 h doivent venir des mêmes constantes que celles déjà utilisées par la garde pour cet utilisateur — **ne réintroduis pas deux sources de vérité pour la fenêtre de l'utilisatrice**.

- [ ] **Étape 2 : appliquer les deux filtres dans la boucle**

Pour chaque lead, **avant** l'appel à `decideLinkedInAction` et avant tout coût d'IA :

```ts
// Le pays n'est pas une colonne : il vit dans le profil enrichi.
const pays: string | null =
  (lead as any)?.enrichedProfile?.linkedin?.raw?.country_code ?? null;

const joignable = isTargetReachableAt(pays, now, todayStr);
if (!joignable.reachable) {
  // ⚠️ DISTINCTION ESSENTIELLE — ne pas la perdre.
  // `country_unknown` et `no_common_window` sont STRUCTURELS : ce lead ne sera
  // jamais joignable en l'état, il faut le signaler pour qu'on puisse le traiter.
  // `outside_window` et `not_a_workday` sont TEMPORELS : ils sont vrais la majeure
  // partie de la journée et ne disent RIEN sur le lead. Les marquer « non
  // joignable » écraserait la base à chaque tick et transformerait « pas
  // maintenant » en « jamais » — exactement le motif que ce dépôt corrige.
  if (joignable.reason === "country_unknown" || joignable.reason === "no_common_window") {
    await storage.setLeadUnreachable(lead.id, `${joignable.reason}: ${joignable.detail}`)
      .catch((e) => console.error("[Prospection] signalement non joignable échoué", e.message));
  }
  continue;
}
// Redevenu joignable (pays enrichi depuis) : on efface la raison, une seule fois.
if ((lead as any).outreachUnreachableReason) {
  await storage.setLeadUnreachable(lead.id, null)
    .catch((e) => console.error("[Prospection] effacement non joignable échoué", e.message));
}

// Sommes-nous dans une session de prospection ?
if (!isWithinAnySession(sessionsDe(state.userId, prefs, paysEnAttente), now)) continue;
```

Puis, inchangé, l'appel à `decideLinkedInAction`. **Ne modifie pas la garde.**

Si la lecture du pays échoue ou renvoie autre chose qu'une chaîne, traite-le comme **pays inconnu** — donc refus et signalement, jamais comme joignable.

- [ ] **Étape 3 : vérifier qu'on n'a pas assoupli la garde**

Écris un test d'intégration : une cible joignable chez elle, à l'intérieur d'une session, mais **hors** de la fenêtre de l'utilisatrice → **aucun appel Unipile**. Puis, par mutation, supprime le nouveau filtre de session et vérifie qu'un test devient rouge. **Rapporte le résultat de la mutation** — ne te contente pas d'affirmer que le test est discriminant : trois tests l'ont prétendu à tort sur ce dépôt cette semaine.

- [ ] **Étape 4 : vérifier** — `TZ=UTC npx vitest run` et `TZ=Pacific/Kiritimati npx vitest run` verts, `npx tsc --noEmit -p tsconfig.json` silencieux.

- [ ] **Étape 5 : commit**

```bash
git add server/services/prospection-sender.ts
git commit -m "feat(envoi-intelligent): le worker respecte la fenetre de la cible et les sessions"
```

---

### Task 7 : vérification de bout en bout

- [ ] **Étape 1 : suite complète** — `npx tsc --noEmit -p tsconfig.json`, puis `TZ=UTC npx vitest run` et `TZ=Pacific/Kiritimati npx vitest run`, puis `npm run build`. Tout vert, tests existants inchangés.

- [ ] **Étape 2 : la garde n'a pas été touchée**

```bash
git diff <base-de-branche>..HEAD -- server/services/prospection-linkedin-guard.ts
```
Attendu : **vide**. Ce lot ne devait que l'entourer.

- [ ] **Étape 3 : aucune horloge ni aléa implicites dans les nouveaux modules**

```bash
grep -nE "Date\.now\(\)|new Date\(\)|Math\.random" \
  server/services/prospection-target-hours.ts \
  server/services/prospection-sessions.ts \
  server/services/prospection-target-zones.ts || echo "aucune — OK"
```

- [ ] **Étape 4 : aucun repli silencieux sur le fuseau de l'utilisatrice**

```bash
grep -n "Europe/Paris" server/services/prospection-target-hours.ts server/services/prospection-sessions.ts \
  || echo "aucun codage en dur — OK"
```

- [ ] **Étape 5 : la migration n'a pas touché la production**

Vérifie que `task_prompts` et les colonnes de ce lot sont absentes de la production, et présentes sur dev-local.

- [ ] **Étape 6 : rendre la main.** Ne pousse pas, ne merge pas.

---

## Notes pour l'implémenteur

Ce dépôt a corrigé **huit défauts Critiques** en une semaine, tous du même motif : **confondre « je n'ai pas pu mesurer » avec « la mesure vaut zéro »**. Une lecture ratée traitée comme une file vide, une alarme pas encore sonnée comptée comme ignorée, une écriture échouée annoncée comme réussie.

Sur ce lot, il prendrait cette forme : un pays inconnu traité comme « joignable maintenant », ou une intersection vide traitée comme « toute la journée ». Les deux enverraient des messages en pleine nuit — le défaut même que ce lot existe pour corriger.

**En cas de doute, refuse et signale.**

Et une leçon de méthode, gagnée trois fois cette semaine : un test écrit après le code passe toujours. Si tu affirmes qu'un test est discriminant, **prouve-le en cassant le code exprès** et rapporte le résultat.
