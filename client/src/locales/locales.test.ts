import { describe, it, expect } from "vitest";
import fr from "./fr";
import en from "./en";

/** Aplatit un dictionnaire imbriqué en liste de chemins : { a: { b: "x" } } → ["a.b"]. */
function flattenKeys(obj: unknown, prefix = ""): string[] {
  if (obj === null || typeof obj !== "object") return [prefix];
  return Object.entries(obj as Record<string, unknown>).flatMap(([key, value]) =>
    flattenKeys(value, prefix ? `${prefix}.${key}` : key),
  );
}

describe("dictionnaires de traduction", () => {
  const frKeys = flattenKeys(fr).sort();
  const enKeys = flattenKeys(en).sort();

  it("aucune clé française ne manque à l'anglais", () => {
    const manquantes = frKeys.filter((k) => !enKeys.includes(k));
    expect(manquantes).toEqual([]);
  });

  it("aucune clé anglaise ne manque au français", () => {
    const manquantes = enKeys.filter((k) => !frKeys.includes(k));
    expect(manquantes).toEqual([]);
  });

  it("aucune valeur n'est vide", () => {
    const vides = [...flattenValues(fr, "fr"), ...flattenValues(en, "en")];
    expect(vides).toEqual([]);
  });
});

/** Renvoie les chemins dont la valeur est une chaîne vide ou blanche. */
function flattenValues(obj: unknown, langue: string, prefix = ""): string[] {
  if (typeof obj === "string") return obj.trim() === "" ? [`${langue}:${prefix}`] : [];
  if (obj === null || typeof obj !== "object") return [];
  return Object.entries(obj as Record<string, unknown>).flatMap(([key, value]) =>
    flattenValues(value, langue, prefix ? `${prefix}.${key}` : key),
  );
}
