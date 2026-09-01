import { describe, it, expect } from "vitest";
import { parseMeasuredAtToUtcMidnight, todayAtUtcMidnight } from "./measured-at";
import { parseReceptionMeasuredAt } from "./validate-input";
import { parseReceptionCsv } from "./sources/manual";

describe("parseMeasuredAtToUtcMidnight", () => {
  it("absent, null ou vide → aujourd'hui à minuit UTC", () => {
    const now = new Date("2026-08-26T22:30:00.000Z");
    const attendu = "2026-08-26T00:00:00.000Z";
    for (const brut of [undefined, null, "", "   "]) {
      const r = parseMeasuredAtToUtcMidnight(brut, "measured_at", now);
      expect("value" in r && r.value.toISOString()).toBe(attendu);
    }
  });

  it("normalise une date horodatée au jour, minuit UTC", () => {
    const r = parseMeasuredAtToUtcMidnight("2026-08-15T13:45:00.000Z", "measured_at");
    expect("value" in r && r.value.toISOString()).toBe("2026-08-15T00:00:00.000Z");
  });

  it("extrait le jour calendaire SANS dépendre du fuseau du serveur", () => {
    // "2026-08-15 01:00:00" (sans décalage explicite) serait lu comme une heure LOCALE par
    // `new Date(string)` : sur un serveur en UTC+2, 01h locale le 15 = 23h UTC le 14.
    const r = parseMeasuredAtToUtcMidnight("2026-08-15 01:00:00", "measured_at");
    expect("value" in r && r.value.toISOString()).toBe("2026-08-15T00:00:00.000Z");
  });

  it("rejette un débordement calendaire silencieux (Date.UTC avance sinon)", () => {
    expect("error" in parseMeasuredAtToUtcMidnight("2026-02-30", "measured_at")).toBe(true);
    expect("error" in parseMeasuredAtToUtcMidnight("2026-13-40", "measured_at")).toBe(true);
  });

  it("rejette une chaîne qui ne commence pas par AAAA-MM-JJ", () => {
    expect("error" in parseMeasuredAtToUtcMidnight("pas une date", "measured_at")).toBe(true);
    expect("error" in parseMeasuredAtToUtcMidnight("15/08/2026", "measured_at")).toBe(true);
  });

  it("nomme le champ tel que l'appelant le connaît dans ses messages d'erreur", () => {
    const csv = parseMeasuredAtToUtcMidnight("zut", "measured_at");
    const json = parseMeasuredAtToUtcMidnight("zut", "measuredAt");
    expect("error" in csv && csv.error).toContain("measured_at");
    expect("error" in json && json.error).toContain("measuredAt");
  });

  it("todayAtUtcMidnight ramène bien à minuit UTC, pas à minuit local", () => {
    expect(todayAtUtcMidnight(new Date("2026-08-26T23:59:59.999Z")).toISOString())
      .toBe("2026-08-26T00:00:00.000Z");
  });
});

/**
 * LE test qui manquait : les deux chemins d'entrée (CSV et JSON) doivent produire
 * EXACTEMENT la même date pour la même saisie. `measured_at` normalisé au jour est un tiers
 * de la clé d'idempotence `(content_id, platform, measured_at)` : s'ils divergeaient d'un
 * jour, rejouer la même mesure depuis l'autre chemin créerait une deuxième ligne sans
 * qu'aucune erreur ne soit levée nulle part.
 */
describe("accord entre le chemin CSV et le chemin JSON", () => {
  const entrees = [
    "2026-08-15",
    "2026-08-15T13:45:00.000Z",
    "2026-08-15 01:00:00",
    "2026-01-01T23:59:59Z",
    "2026-12-31",
  ];

  for (const entree of entrees) {
    it(`"${entree}" : même jour normalisé des deux côtés`, () => {
      const json = parseReceptionMeasuredAt(entree);
      const csv = parseReceptionCsv(
        `content_id,platform,reach,measured_at\n42,instagram,1000,${entree}`,
      );
      expect(csv.errors).toEqual([]);
      expect("value" in json && json.value.toISOString()).toBe(csv.rows[0].measuredAt.toISOString());
    });
  }

  it("une saisie invalide est refusée des DEUX côtés, jamais acceptée par l'un seulement", () => {
    for (const entree of ["2026-02-30", "pas une date", "15/08/2026"]) {
      const json = parseReceptionMeasuredAt(entree);
      const csv = parseReceptionCsv(
        `content_id,platform,reach,measured_at\n42,instagram,1000,${entree}`,
      );
      expect("error" in json).toBe(true);
      expect(csv.errors).toHaveLength(1);
      expect(csv.rows).toEqual([]);
    }
  });

  it("l'absence de date vaut aujourd'hui des deux côtés", () => {
    const json = parseReceptionMeasuredAt(undefined);
    const csv = parseReceptionCsv("content_id,platform,reach\n42,instagram,1000");
    expect("value" in json && json.value.toISOString()).toBe(csv.rows[0].measuredAt.toISOString());
  });
});
