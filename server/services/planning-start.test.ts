import { describe, it, expect } from "vitest";
import { debutEffectifDePlanification } from "./planning-start";

/**
 * À partir de quelle date le planificateur doit-il générer ?
 *
 * Demande de Jeanne (24 septembre 2026) : « si on définit un jour particulier de démarrage,
 * Naya doit pouvoir planifier directement pour ce jour-là et donner une petite vision de
 * structure de la semaine et du mois à venir ».
 *
 * Le comportement d'avant : une date de départ future faisait SAUTER le planificateur.
 *
 *     if (prefs?.planningStartDate && prefs.planningStartDate > startDate) continue;
 *
 * « La planification démarre vendredi » voulait donc dire « ne rien faire jusqu'à vendredi ».
 * Jeanne ouvrait son planning du vendredi et n'y voyait rien — elle ne pouvait le découvrir
 * que le vendredi matin, une fois le cron de 6 h passé. Impossible de préparer sa semaine.
 *
 * Ça doit vouloir dire « planifier À PARTIR de vendredi ».
 */
describe("debutEffectifDePlanification", () => {
  it("une date de départ FUTURE devient le point de départ de la génération", () => {
    // LE test. C'est exactement le cas de Jeanne : le 24, départ fixé au 25.
    expect(debutEffectifDePlanification("2026-09-24", "2026-09-25")).toBe("2026-09-25");
  });

  it("une date de départ lointaine est respectée telle quelle", () => {
    expect(debutEffectifDePlanification("2026-09-24", "2026-10-15")).toBe("2026-10-15");
  });

  it("une date de départ PASSÉE ne fait pas remonter le temps", () => {
    // Bug visé : générer dans le passé. Une date de départ ancienne veut dire « la
    // planification a commencé », pas « replanifie le mois dernier ».
    expect(debutEffectifDePlanification("2026-09-24", "2026-09-01")).toBe("2026-09-24");
  });

  it("une date de départ égale à aujourd'hui ne change rien", () => {
    expect(debutEffectifDePlanification("2026-09-24", "2026-09-24")).toBe("2026-09-24");
  });

  it("sans date de départ, on part d'aujourd'hui", () => {
    for (const absente of [null, undefined, ""]) {
      expect(
        debutEffectifDePlanification("2026-09-24", absente as string),
        `date ${String(absente)}`,
      ).toBe("2026-09-24");
    }
  });

  it("une date mal formée est ignorée plutôt que d'arrêter la planification", () => {
    // `planningStartDate` est une colonne texte : rien ne garantit son format. Une
    // comparaison de chaînes avec une valeur aberrante pourrait décaler la génération de
    // plusieurs mois, ou la faire sauter. Dans le doute, on part d'aujourd'hui — le
    // comportement le moins surprenant.
    for (const mauvaise of ["25/09/2026", "demain", "2026-13-45", "2026-9-5", "  "]) {
      expect(
        debutEffectifDePlanification("2026-09-24", mauvaise),
        `date « ${mauvaise} »`,
      ).toBe("2026-09-24");
    }
  });

  it("ne saute JAMAIS la planification, quelle que soit la date de départ", () => {
    // La propriété d'ensemble. L'ancien code renvoyait « ne rien faire » ; cette fonction
    // rend toujours une date exploitable. Une journée sans plan n'est jamais le bon défaut.
    for (const depart of [null, "", "2026-09-01", "2026-09-24", "2026-09-25", "2027-01-01", "n'importe quoi"]) {
      const r = debutEffectifDePlanification("2026-09-24", depart as string);
      expect(r, `depart ${String(depart)}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r >= "2026-09-24", `depart ${String(depart)} → ${r} ne doit pas être dans le passé`).toBe(true);
    }
  });
});
