import { describe, it, expect } from "vitest";
import {
  parseReceptionIntOrNull,
  parseReceptionSentiment,
  parseReceptionMeasuredAt,
} from "./validate-input";

describe("parseReceptionIntOrNull", () => {
  it("traite undefined, null et la chaîne vide (après trim) comme null — jamais un zéro", () => {
    expect(parseReceptionIntOrNull(undefined, "saves")).toEqual({ value: null });
    expect(parseReceptionIntOrNull(null, "saves")).toEqual({ value: null });
    expect(parseReceptionIntOrNull("", "saves")).toEqual({ value: null });
    expect(parseReceptionIntOrNull("   ", "saves")).toEqual({ value: null });
  });

  it("garde 0 comme zéro MESURÉ, jamais confondu avec l'absence", () => {
    expect(parseReceptionIntOrNull(0, "saves")).toEqual({ value: 0 });
    expect(parseReceptionIntOrNull("0", "saves")).toEqual({ value: 0 });
  });

  it("accepte un entier positif, en number comme en string", () => {
    expect(parseReceptionIntOrNull(42, "saves")).toEqual({ value: 42 });
    expect(parseReceptionIntOrNull("42", "saves")).toEqual({ value: 42 });
  });

  it("rejette une valeur négative", () => {
    const r = parseReceptionIntOrNull(-3, "saves");
    expect("error" in r).toBe(true);
  });

  it("rejette un nombre non entier", () => {
    const r = parseReceptionIntOrNull(3.5, "saves");
    expect("error" in r).toBe(true);
  });

  it("rejette une chaîne non numérique non vide", () => {
    const r = parseReceptionIntOrNull("abc", "saves");
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toContain("saves");
  });

  it("rejette un type inattendu (booléen, objet, tableau)", () => {
    expect("error" in parseReceptionIntOrNull(true, "saves")).toBe(true);
    expect("error" in parseReceptionIntOrNull({}, "saves")).toBe(true);
    expect("error" in parseReceptionIntOrNull([1], "saves")).toBe(true);
  });
});

describe("parseReceptionSentiment", () => {
  it("traite undefined, null et la chaîne vide comme null", () => {
    expect(parseReceptionSentiment(undefined)).toEqual({ value: null });
    expect(parseReceptionSentiment(null)).toEqual({ value: null });
    expect(parseReceptionSentiment("")).toEqual({ value: null });
    expect(parseReceptionSentiment("  ")).toEqual({ value: null });
  });

  it("garde 0 comme valeur mesurée, jamais confondu avec l'absence", () => {
    expect(parseReceptionSentiment(0)).toEqual({ value: 0 });
    expect(parseReceptionSentiment("0")).toEqual({ value: 0 });
  });

  it("accepte une valeur dans -1..1", () => {
    expect(parseReceptionSentiment(0.5)).toEqual({ value: 0.5 });
    expect(parseReceptionSentiment(-1)).toEqual({ value: -1 });
    expect(parseReceptionSentiment(1)).toEqual({ value: 1 });
  });

  it("rejette une valeur hors de l'intervalle -1..1", () => {
    expect("error" in parseReceptionSentiment(1.5)).toBe(true);
    expect("error" in parseReceptionSentiment(-2)).toBe(true);
  });

  it("rejette une chaîne non numérique non vide", () => {
    expect("error" in parseReceptionSentiment("positif")).toBe(true);
  });
});

describe("parseReceptionMeasuredAt", () => {
  it("absent ou vide → aujourd'hui à minuit UTC", () => {
    const now = new Date();
    const expected = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    const undef = parseReceptionMeasuredAt(undefined);
    expect("value" in undef && undef.value.toISOString()).toBe(expected.toISOString());

    const nul = parseReceptionMeasuredAt(null);
    expect("value" in nul && nul.value.toISOString()).toBe(expected.toISOString());

    const empty = parseReceptionMeasuredAt("");
    expect("value" in empty && empty.value.toISOString()).toBe(expected.toISOString());
  });

  it("normalise une date fournie au jour, minuit UTC", () => {
    const r = parseReceptionMeasuredAt("2026-08-15T13:45:00.000Z");
    expect("value" in r && r.value.toISOString()).toBe("2026-08-15T00:00:00.000Z");
  });

  it("extrait le jour calendaire SANS dépendre du fuseau du serveur", () => {
    const r = parseReceptionMeasuredAt("2026-08-15 01:00:00");
    expect("value" in r && r.value.toISOString()).toBe("2026-08-15T00:00:00.000Z");
  });

  it("rejette un type non-string", () => {
    expect("error" in parseReceptionMeasuredAt(12345)).toBe(true);
  });

  it("rejette une date calendaire invalide (débordement)", () => {
    expect("error" in parseReceptionMeasuredAt("2026-13-40")).toBe(true);
  });

  it("rejette une chaîne qui ne commence pas par AAAA-MM-JJ", () => {
    expect("error" in parseReceptionMeasuredAt("pas une date")).toBe(true);
  });
});
