import { describe, it, expect } from "vitest";
import {
  contenuEstPublie, tacheEstFaite, trierContenus, trierTaches,
  construirePreference, SALIENCE_REJET,
} from "./rejeter";

const nu = { id: 1, publishedAt: null, postStatus: null, contentStatus: null };

describe("contenuEstPublie — on garde dès qu'UN signal est allumé", () => {
  it("rend faux quand aucun signal n'est allumé", () => {
    expect(contenuEstPublie(nu)).toBe(false);
  });

  it("rend vrai sur publishedAt seul", () => {
    expect(contenuEstPublie({ ...nu, publishedAt: new Date("2026-09-01") })).toBe(true);
  });

  it("rend vrai sur postStatus = posted seul", () => {
    expect(contenuEstPublie({ ...nu, postStatus: "posted" })).toBe(true);
  });

  it("rend vrai sur contentStatus = published seul", () => {
    expect(contenuEstPublie({ ...nu, contentStatus: "published" })).toBe(true);
  });

  it("ne confond pas les états intermédiaires de postStatus avec une publication", () => {
    for (const s of ["pending", "uploading", "processing", "posting", "failed"]) {
      expect(contenuEstPublie({ ...nu, postStatus: s })).toBe(false);
    }
  });

  it("ne confond pas les étapes amont de contentStatus avec une publication", () => {
    for (const s of ["idea", "draft", "ready"]) {
      expect(contenuEstPublie({ ...nu, contentStatus: s })).toBe(false);
    }
  });

  it("normalise la casse et les espaces avant de comparer", () => {
    // Variantes de casse qui devraient être reconnues comme publication
    expect(contenuEstPublie({ ...nu, postStatus: "Posted" })).toBe(true);
    expect(contenuEstPublie({ ...nu, postStatus: "POSTED" })).toBe(true);
    expect(contenuEstPublie({ ...nu, postStatus: " posted " })).toBe(true);
    expect(contenuEstPublie({ ...nu, contentStatus: "Published" })).toBe(true);
    expect(contenuEstPublie({ ...nu, contentStatus: "PUBLISHED" })).toBe(true);
    expect(contenuEstPublie({ ...nu, contentStatus: " published " })).toBe(true);
  });
});

describe("tacheEstFaite", () => {
  it("suit completed", () => {
    expect(tacheEstFaite({ id: 1, completed: true })).toBe(true);
    expect(tacheEstFaite({ id: 1, completed: false })).toBe(false);
  });
});

describe("trierContenus", () => {
  it("sépare les gardés des partants", () => {
    const tri = trierContenus([
      { id: 10, publishedAt: new Date("2026-09-01"), postStatus: null, contentStatus: null },
      { id: 11, publishedAt: null, postStatus: "posted", contentStatus: null },
      { id: 12, publishedAt: null, postStatus: null, contentStatus: "published" },
      { id: 13, publishedAt: null, postStatus: "pending", contentStatus: "draft" },
      { id: 14, publishedAt: null, postStatus: null, contentStatus: "idea" },
    ]);
    expect(tri.gardes).toEqual([10, 11, 12]);
    expect(tri.partants).toEqual([13, 14]);
  });

  it("rend deux listes vides sur une entrée vide, sans jeter", () => {
    expect(trierContenus([])).toEqual({ gardes: [], partants: [] });
  });
});

describe("trierTaches", () => {
  it("sépare les faites des non faites", () => {
    const tri = trierTaches([
      { id: 20, completed: true },
      { id: 21, completed: false },
      { id: 22, completed: true },
    ]);
    expect(tri.gardes).toEqual([20, 22]);
    expect(tri.partants).toEqual([21]);
  });
});

describe("construirePreference", () => {
  const campagne = { name: "De Stratège à Scène", objective: "asseoir l'autorité", coreMessage: "la stratège monte sur scène" };

  it("rend une phrase qui se tient SEULE, sans son contexte d'origine", () => {
    // Une entrée de mémoire est relue des mois plus tard, mêlée à d'autres, hors de
    // tout contexte. « Je ne veux pas ça » y serait illisible.
    const p = construirePreference({ campagne, raison: "trop centré sur moi, pas assez sur les clientes" });
    expect(p).toContain("De Stratège à Scène");
    expect(p).toContain("trop centré sur moi, pas assez sur les clientes");
    // Vérifier la structure : guillemets autour du nom, phrases de liaison
    expect(p).toContain("« De Stratège à Scène »");
    expect(p).toContain("Ce qui n'allait pas");
    expect(p.length).toBeGreaterThan(40);
  });

  it("inclut l'objectif et le message central, qui sont ce que Naya doit éviter", () => {
    const p = construirePreference({ campagne, raison: "non" });
    expect(p).toContain("asseoir l'autorité");
    expect(p).toContain("la stratège monte sur scène");
    // Vérifier que ces éléments sont dans des phrases structurées, pas une concaténation brute
    expect(p).toContain("Son objectif était : asseoir l'autorité");
    expect(p).toContain("Son message central était : la stratège monte sur scène");
  });

  it("finit toujours par un point, même si la raison n'en porte pas", () => {
    const sans = construirePreference({ campagne, raison: "pas assez de détails" });
    expect(sans).not.toBeNull();
    expect(sans!.endsWith(".")).toBe(true);
    const avec = construirePreference({ campagne, raison: "trop court." });
    expect(avec).not.toBeNull();
    expect(avec!.endsWith("court.")).toBe(true);
  });

  it("rend null sur une raison vide ou blanche — pas de préférence sans raison", () => {
    expect(construirePreference({ campagne, raison: "" })).toBeNull();
    expect(construirePreference({ campagne, raison: "   " })).toBeNull();
  });

  it("supporte une campagne aux champs manquants sans produire « undefined »", () => {
    const p = construirePreference({ campagne: { name: "", objective: "", coreMessage: null }, raison: "pas ça" });
    expect(p).not.toBeNull();
    expect(p!).not.toContain("undefined");
    expect(p!).not.toContain("null");
  });
});

describe("la salience d'un rejet", () => {
  it("vaut 0,8 — plus qu'une observation déduite (défaut 0,5)", () => {
    expect(SALIENCE_REJET).toBe(0.8);
  });
});
