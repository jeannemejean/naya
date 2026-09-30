import { describe, it, expect } from "vitest";
import { valideLien, anglesDepuisPhases, formaterArticulation } from "./links";

describe("valideLien", () => {
  it("accepte un lien entre deux marques distinctes", () => {
    expect(valideLien({ fromProjectId: 1, toProjectId: 2 })).toEqual({ ok: true });
  });

  it("refuse qu'une marque se lie à elle-même", () => {
    const r = valideLien({ fromProjectId: 3, toProjectId: 3 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.raison).toMatch(/elle-même/i);
  });
});

describe("anglesDepuisPhases — lire un jsonb écrit par le modèle", () => {
  it("extrait les angles de phases bien formées", () => {
    const phases = [
      { name: "Amorce", angle: "montrer les coulisses" },
      { name: "Preuve", angle: "chiffres clients" },
    ];
    expect(anglesDepuisPhases(phases)).toEqual(["montrer les coulisses", "chiffres clients"]);
  });

  it("tolère un objectif ou une description à la place de l'angle", () => {
    expect(anglesDepuisPhases([{ name: "P1", objective: "asseoir la crédibilité" }])).toEqual([
      "asseoir la crédibilité",
    ]);
  });

  it("rend une liste vide sur du jsonb inattendu, sans jeter", () => {
    expect(anglesDepuisPhases(null)).toEqual([]);
    expect(anglesDepuisPhases("pas un tableau")).toEqual([]);
    expect(anglesDepuisPhases([{ name: "sans angle" }])).toEqual([]);
    expect(anglesDepuisPhases([42, null])).toEqual([]);
  });

  it("écarte les angles vides ou blancs", () => {
    expect(anglesDepuisPhases([{ angle: "   " }, { angle: "vrai angle" }])).toEqual(["vrai angle"]);
  });
});

describe("formaterArticulation — ce qui entre dans le prompt, et ce qui n'y entre JAMAIS", () => {
  const a = {
    lien: {
      roleAmont: "j'incarne, c'est moi qu'on suit",
      roleAval: "l'agence vend la méthode",
      nature: "Je suis le visage de JMD ; l'agence ne parle jamais à ma place.",
    },
    sens: "estNourriePar" as const,
    campagne: {
      id: 12,
      marque: "Jeanne Méjean",
      name: "Septembre — la méthode",
      objective: "asseoir l'autorité",
      coreMessage: "on ne vend pas une méthode, on la pratique",
      angles: ["montrer les coulisses", "chiffres clients"],
    },
  };

  it("contient le nom de la marque liée, sa campagne, son message et ses angles", () => {
    const t = formaterArticulation(a);
    expect(t).toContain("Jeanne Méjean");
    expect(t).toContain("Septembre — la méthode");
    expect(t).toContain("on ne vend pas une méthode, on la pratique");
    expect(t).toContain("montrer les coulisses");
  });

  it("contient les rôles et la nature du lien, dans les mots de l'utilisatrice", () => {
    const t = formaterArticulation(a);
    expect(t).toContain("j'incarne, c'est moi qu'on suit");
    expect(t).toContain("l'agence ne parle jamais à ma place");
  });

  it("porte la consigne d'écho et l'interdiction de parler à la place de l'autre marque", () => {
    const t = formaterArticulation(a);
    expect(t).toMatch(/écho/i);
    expect(t).toMatch(/jamais.*place de/i);
  });

  it("ne contient AUCUN champ d'identité de la marque liée — c'est la garantie centrale", () => {
    // Le type CampagneLiee ne porte volontairement ni ADN, ni mémoire, ni ton de voix.
    // Ce test vérifie que formaterArticulation ne peut rien inventer à partir de ce
    // qu'on lui donne : il n'a accès qu'aux champs de campagne et aux textes du lien.
    const t = formaterArticulation(a);
    expect(t).not.toMatch(/ADN|brand ?dna|mémoire|voix de marque|ton de voix/i);
  });

  it("reste lisible quand les champs libres sont vides", () => {
    const t = formaterArticulation({
      ...a,
      lien: { roleAmont: null, roleAval: null, nature: null },
      campagne: { ...a.campagne, coreMessage: null, angles: [] },
    });
    expect(t).toContain("Jeanne Méjean");
    expect(t).not.toContain("null");
    expect(t).not.toContain("undefined");
  });
});
