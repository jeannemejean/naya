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

  // NB : cette fonction ne prend pas le jour en paramètre séparé de `seed` — c'est
  // la graine, dérivée en amont (typiquement de la date), qui fait varier le
  // découpage d'un jour à l'autre. Le test ci-dessous vérifie donc directement la
  // propriété dont dépend "un jour différent" : graine différente => découpage
  // différent.
  it("produit un decoupage different pour une graine differente (la graine encode le jour)", () => {
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
    // US est volontairement inclus : sans ville, sa fenêtre pays (19h-22h UTC,
    // voir prospection-target-hours.test.ts) ne recoupe pas du tout la fenêtre de
    // l'utilisatrice (07h-16h UTC). Un bug qui oublierait de borner le créneau
    // pays par la fenêtre utilisatrice (Math.max/Math.min) laisserait passer un
    // créneau US brut, entièrement hors bornes — c'est précisément ce que cette
    // assertion ferait tomber.
    const s = planDailySessions({ ...FENETRE, pendingCountryCodes: ["FR", "US"], seed: 1 });
    for (const sess of s) {
      expect(sess.start.getTime()).toBeGreaterThanOrEqual(FENETRE.userWindowStart.getTime());
      expect(sess.end.getTime()).toBeLessThanOrEqual(FENETRE.userWindowEnd.getTime());
      expect(sess.end.getTime()).toBeGreaterThan(sess.start.getTime());
    }
  });

  it("couvre les fuseaux presents : une file dont le pays ouvre plus tard decale le dernier rendez-vous", () => {
    // ⚠️ Le brief original comparait FR à US. C'est infaisable avec cet input
    // (pas de ville) : targetWindowUTC("US", null, ...) rend 19h-22h UTC (repli
    // sur l'intersection des 29 fuseaux US, voir prospection-target-hours.ts /
    // .test.ts), qui ne recoupe JAMAIS la fenêtre 07h-16h UTC de FENETRE — une
    // file "US" seule produit donc TOUJOURS [] ici, quel que soit le seed, et
    // Math.max(...[].map(...)) est -Infinity : le test tel qu'écrit dans le
    // brief échoue nécessairement, il ne prouve rien sur la couverture des
    // fuseaux. On le remplace par SN (Africa/Dakar, UTC+0, pas d'heure d'été) :
    // sa fenêtre ouvrée locale (09h-18h UTC) recoupe bien 07h-16h UTC, mais
    // démarre 2h après celle de FR (07h-16h UTC, qui coïncide avec la fenêtre de
    // l'utilisatrice puisqu'elle est aussi à Paris). Vérifié empiriquement sur
    // les seeds 1 à 10 : le dernier rendez-vous d'une file SN est strictement
    // plus tardif que celui d'une file FR, dans TOUS les cas.
    const fr = planDailySessions({ ...FENETRE, pendingCountryCodes: ["FR"], seed: 5 });
    const sn = planDailySessions({ ...FENETRE, pendingCountryCodes: ["SN"], seed: 5 });
    expect(fr.length).toBeGreaterThan(0);
    expect(sn.length).toBeGreaterThan(0);
    const dernierFr = Math.max(...fr.map((s) => s.end.getTime()));
    const dernierSn = Math.max(...sn.map((s) => s.end.getTime()));
    expect(dernierSn).toBeGreaterThan(dernierFr);
  });

  it("ne produit aucune session quand la file est vide", () => {
    expect(planDailySessions({ ...FENETRE, pendingCountryCodes: [], seed: 9 })).toEqual([]);
  });

  it("ne produit aucune session quand aucune cible n'est joignable dans la fenetre", () => {
    // NZ : 9h-18h a Auckland (hiver, UTC+12, pas d'heure d'ete) ne croise pas
    // 9h-18h a Paris (2026-07-15 est un mercredi, donc jour ouvre cote NZ aussi —
    // ce n'est pas le controle "jour ouvre" qui rend [], c'est bien l'absence de
    // recoupement horaire).
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
