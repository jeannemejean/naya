import { describe, it, expect, vi } from "vitest";
import { targetWindowUTC, isTargetReachableAt } from "./prospection-target-hours";
import * as zonesModule from "./prospection-target-zones";

describe("targetWindowUTC", () => {
  it("rend la fenetre locale d'un pays mono-fuseau (pas de ville)", () => {
    // 2026-07-15, Paris = UTC+2 → 09:00-18:00 locales = 07:00-16:00 UTC
    const w = targetWindowUTC("FR", null, "2026-07-15");
    expect(w.reachable).toBe(true);
    if (!w.reachable) return;
    expect(w.start.toISOString()).toBe("2026-07-15T07:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-07-15T16:00:00.000Z");
  });

  it("rend l'intersection de tous les fuseaux d'un pays multi-fuseaux quand la ville est absente", () => {
    // US en juillet : intersection = [max des ouvertures, min des fermetures].
    // Honolulu (UTC-10, pas de DST) ouvre le plus tard en UTC : 19:00.
    // Les fuseaux Eastern (EDT, UTC-4) ferment le plus tot en UTC : 22:00.
    const w = targetWindowUTC("US", null, "2026-07-15");
    expect(w.reachable).toBe(true);
    if (!w.reachable) return;
    expect(w.start.toISOString()).toBe("2026-07-15T19:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-07-15T22:00:00.000Z");
  });

  it("une ville reconnue restreint la fenetre a SON seul fuseau, plus large que l'intersection du pays", () => {
    // Preuve chiffree que la ville sert a quelque chose : sans ville, l'intersection
    // US ne fait que 3h (19:00-22:00 UTC). Avec "New York" (America/New_York,
    // EDT UTC-4 en juillet), la fenetre est le fuseau unique 13:00-22:00 UTC : 9h,
    // donc strictement plus large. Un bug qui ignorerait la ville (ou qui la
    // passerait mal a l'intersection) ferait echouer ces valeurs exactes.
    const sansVille = targetWindowUTC("US", null, "2026-07-15");
    const avecVille = targetWindowUTC("US", "New York", "2026-07-15");
    expect(sansVille.reachable).toBe(true);
    expect(avecVille.reachable).toBe(true);
    if (!sansVille.reachable || !avecVille.reachable) return;

    expect(avecVille.start.toISOString()).toBe("2026-07-15T13:00:00.000Z");
    expect(avecVille.end.toISOString()).toBe("2026-07-15T22:00:00.000Z");

    const largeurSansVille = sansVille.end.getTime() - sansVille.start.getTime();
    const largeurAvecVille = avecVille.end.getTime() - avecVille.start.getTime();
    expect(largeurAvecVille).toBeGreaterThan(largeurSansVille);
    expect(largeurAvecVille).toBe(9 * 60 * 60 * 1000);
    expect(largeurSansVille).toBe(3 * 60 * 60 * 1000);
  });

  it("une ville ambigue sans discriminant d'Etat retombe sur l'intersection du pays, jamais sur une supposition", () => {
    // "Portland" existe en Oregon (Pacifique) et dans le Maine (Est) : zoneForCity
    // rend null sans Etat precise. L'ordre de resolution doit alors retomber sur
    // l'intersection du pays entier, identique au cas sans ville.
    const sansVille = targetWindowUTC("US", null, "2026-07-15");
    const villeAmbigue = targetWindowUTC("US", "Portland", "2026-07-15");
    expect(sansVille.reachable).toBe(true);
    expect(villeAmbigue.reachable).toBe(true);
    if (!sansVille.reachable || !villeAmbigue.reachable) return;
    expect(villeAmbigue.start.toISOString()).toBe(sansVille.start.toISOString());
    expect(villeAmbigue.end.toISOString()).toBe(sansVille.end.toISOString());
  });

  it("une ville ambigue AVEC discriminant d'Etat resout bien vers un seul fuseau (pas l'intersection)", () => {
    // "Portland, OR" leve l'ambiguite vers America/Los_Angeles (Pacifique).
    const w = targetWindowUTC("US", "Portland, OR", "2026-07-15");
    expect(w.reachable).toBe(true);
    if (!w.reachable) return;
    // America/Los_Angeles = PDT UTC-7 en juillet : 09:00-18:00 locale = 16:00-01:00 UTC.
    expect(w.start.toISOString()).toBe("2026-07-15T16:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-07-16T01:00:00.000Z");
  });

  it("signale un pays inconnu au lieu d'autoriser", () => {
    const w = targetWindowUTC("ZZ", null, "2026-07-15");
    expect(w.reachable).toBe(false);
    if (w.reachable) return;
    expect(w.reason).toBe("country_unknown");
    expect(w.detail.length).toBeGreaterThan(0);
  });

  it("signale un pays absent au lieu d'autoriser, meme avec une ville renseignee", () => {
    const w = targetWindowUTC(null, "New York", "2026-07-15");
    expect(w.reachable).toBe(false);
    if (w.reachable) return;
    expect(w.reason).toBe("country_unknown");
  });

  it("signale l'absence de fenetre commune quand l'intersection des fuseaux est vide", () => {
    // Aucun pays reel de la table n'a un etalement >= 9h (US, le plus large, plafonne
    // a 6h). On fabrique donc le cas en substituant deux fuseaux IANA reels et tres
    // eloignes (Pacific/Kiritimati UTC+14, Etc/GMT+12 UTC-12 -> 26h d'ecart) pour
    // prouver que le calcul d'intersection detecte bien une fenetre vide et refuse,
    // plutot que de verifier une propriete qui serait vraie meme si la branche
    // no_common_window n'existait pas.
    const spy = vi
      .spyOn(zonesModule, "zonesForCountry")
      .mockReturnValue(["Pacific/Kiritimati", "Etc/GMT+12"]);
    try {
      const w = targetWindowUTC("US", null, "2026-07-15");
      expect(w.reachable).toBe(false);
      if (w.reachable) return;
      expect(w.reason).toBe("no_common_window");
      expect(w.detail.length).toBeGreaterThan(0);
    } finally {
      spy.mockRestore();
    }
  });

  it("refuse le week-end", () => {
    // 2026-07-18 est un samedi
    const w = targetWindowUTC("FR", null, "2026-07-18");
    expect(w.reachable).toBe(false);
    if (w.reachable) return;
    expect(w.reason).toBe("not_a_workday");
  });
});

describe("isTargetReachableAt", () => {
  it("autorise a l'interieur de la fenetre", () => {
    const r = isTargetReachableAt("FR", null, new Date("2026-07-15T10:00:00.000Z"), "2026-07-15");
    expect(r.reachable).toBe(true);
  });

  it("refuse avant l'ouverture", () => {
    const r = isTargetReachableAt("FR", null, new Date("2026-07-15T06:59:00.000Z"), "2026-07-15");
    expect(r.reachable).toBe(false);
    if (r.reachable) return;
    expect(r.reason).toBe("outside_window");
  });

  it("refuse a la borne de fin, exclusive", () => {
    const r = isTargetReachableAt("FR", null, new Date("2026-07-15T16:00:00.000Z"), "2026-07-15");
    expect(r.reachable).toBe(false);
    if (r.reachable) return;
    expect(r.reason).toBe("outside_window");
  });

  it("transmet la ville : joignable a 14h UTC via New York, pas via l'intersection pays seule", () => {
    // Preuve que la ville se propage bien jusqu'a isTargetReachableAt, pas seulement
    // a targetWindowUTC : 14:00 UTC est hors de l'intersection US (19:00-22:00) mais
    // a l'interieur de la fenetre New York seule (13:00-22:00).
    const instant = new Date("2026-07-15T14:00:00.000Z");
    const sansVille = isTargetReachableAt("US", null, instant, "2026-07-15");
    const avecVille = isTargetReachableAt("US", "New York", instant, "2026-07-15");
    expect(sansVille.reachable).toBe(false);
    if (!sansVille.reachable) expect(sansVille.reason).toBe("outside_window");
    expect(avecVille.reachable).toBe(true);
  });
});
