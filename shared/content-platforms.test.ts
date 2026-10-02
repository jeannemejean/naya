import { describe, it, expect } from "vitest";
import {
  PLATEFORMES_CONNUES, TYPES_CONTENU_CONNUS, estPlateformeConnue, estTypeContenuConnu,
} from "./content-platforms";

describe("estPlateformeConnue", () => {
  it("accepte chaque plateforme de la liste", () => {
    for (const p of PLATEFORMES_CONNUES) expect(estPlateformeConnue(p)).toBe(true);
  });

  it("rejette une plateforme que le prompt d'extraction propose mais que l'interface ne connaît pas", () => {
    expect(estPlateformeConnue("tiktok")).toBe(false);
    expect(estPlateformeConnue("youtube")).toBe(false);
    expect(estPlateformeConnue("newsletter")).toBe(false);
  });
});

describe("estTypeContenuConnu", () => {
  it("accepte chaque type de la liste", () => {
    for (const t of TYPES_CONTENU_CONNUS) expect(estTypeContenuConnu(t)).toBe(true);
  });

  it("rejette un type que le prompt d'extraction propose mais que l'interface ne connaît pas", () => {
    expect(estTypeContenuConnu("carousel")).toBe(false);
    expect(estTypeContenuConnu("reel")).toBe(false);
    expect(estTypeContenuConnu("video")).toBe(false);
  });
});
