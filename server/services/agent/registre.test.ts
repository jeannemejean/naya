// Tests du registre des outils de l'agent : la table unique qui classe chaque outil
// (lecture / direct / à valider). `./recherche` est mocké : aucun accès à la base.
import { describe, it, expect, vi } from "vitest";

vi.mock("./recherche", () => ({
  SOURCES: ["tache_reponse", "livrable", "note", "memoire", "conversation", "contenu", "tache", "reponse_prospect"],
  chercher: vi.fn(async () => []),
  lire: vi.fn(async () => null),
}));

const { REGISTRE, outil, DIRECTS_AUTORISES, validerArgs } = await import("./registre");

// Toutes les clés `properties` d'un schéma JSON, à toute profondeur.
function proprietes(schema: any): string[] {
  if (!schema || typeof schema !== "object") return [];
  const ici = schema.properties ? Object.keys(schema.properties) : [];
  const dessous = [
    ...Object.values(schema.properties ?? {}).flatMap(proprietes),
    ...(schema.items ? proprietes(schema.items) : []),
  ];
  return [...ici, ...dessous];
}

describe("registre des outils", () => {
  it("chaque outil a une classe connue, un nom unique et une description", () => {
    const noms = REGISTRE.map((o) => o.nom);
    expect(new Set(noms).size).toBe(noms.length);
    for (const o of REGISTRE) {
      expect(["lecture", "direct", "a_valider"]).toContain(o.classe);
      expect(o.description.length).toBeGreaterThan(10);
    }
  });

  it("les outils directs valent exactement la table de vérité (spec §5)", () => {
    const directs = REGISTRE.filter((o) => o.classe === "direct").map((o) => o.nom);
    expect(new Set(directs)).toEqual(new Set(DIRECTS_AUTORISES));
    expect(directs).toHaveLength(DIRECTS_AUTORISES.size);
  });

  it("aucun schéma d'outil n'a de propriété userId", () => {
    for (const o of REGISTRE) {
      expect(proprietes(o.schema).map((p) => p.toLowerCase())).not.toContain("userid");
    }
  });

  it("chercher et lire sont présents, en lecture", () => {
    expect(outil("chercher")?.classe).toBe("lecture");
    expect(outil("lire")?.classe).toBe("lecture");
    expect(outil("inconnu")).toBeUndefined();
  });
});

describe("validerArgs", () => {
  const schema = outil("chercher")!.schema;
  it("accepte des arguments conformes", () => {
    expect(validerArgs(schema, { requete: "devis", projetId: 3, sources: ["note"] })).toBeNull();
  });
  it("refuse un champ requis manquant, un mauvais type, une valeur hors liste", () => {
    expect(validerArgs(schema, {})).toMatch(/requete/);
    expect(validerArgs(schema, { requete: 12 })).toMatch(/requete/);
    expect(validerArgs(schema, { requete: "x", projetId: "trois" })).toMatch(/projetId/);
    expect(validerArgs(schema, { requete: "x", sources: ["inventée"] })).toMatch(/sources/);
    expect(validerArgs(schema, null)).not.toBeNull();
  });
});
