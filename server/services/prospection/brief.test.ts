import { describe, it, expect } from "vitest";
import { parseBrief, angleDeTouche, briefActionnable, lireBrief, appliquerEditionBrief } from "./brief";

const BON = JSON.stringify({
  declencheur: { fait: "Marc Jacobs lance Daisy Wild en mars", source: "actualite", url: "https://presse.fr/daisy", date: "2026-09-30" },
  preuveId: 4,
  raison: "Lancement en cours, et JMD a fait une série courte pour une maison comparable.",
  proposition: { type: "preuve", contenu: "Le cas Maison Lancaster" },
  angles: ["le lancement Daisy Wild", "une idée de série courte", "le cas Lancaster", "le lancement Daisy Wild"],
  langue: "fr", registre: "vous",
});

describe("parseBrief", () => {
  it("lit un brief complet", () => {
    const b = parseBrief(BON, [4, 5], 4);
    expect(b.declencheur?.fait).toContain("Daisy Wild");
    expect(b.preuveId).toBe(4);
    expect(b.registre).toBe("vous");
    expect(b.edite).toBe(false);
  });

  it("une preuve qui n'est pas validée dans ce projet est ignorée", () => {
    expect(parseBrief(BON, [5], 4).preuveId).toBeNull();
  });

  it("dédoublonne les angles et en fournit un par touche", () => {
    const b = parseBrief(BON, [4], 5);
    expect(new Set(b.angles).size).toBe(b.angles.length);
    expect(b.angles.length).toBeGreaterThanOrEqual(3);
  });

  it("un JSON illisible donne un brief sans déclencheur, donc non actionnable", () => {
    const b = parseBrief("pas du json", [], 4);
    expect(b.declencheur).toBeNull();
    expect(briefActionnable(b)).toBe(false);
  });

  it("un déclencheur vide est un déclencheur absent", () => {
    const raw = JSON.stringify({ declencheur: { fait: "  ", source: "x" }, angles: ["a"] });
    expect(parseBrief(raw, [], 3).declencheur).toBeNull();
  });

  it("registre inconnu → vous ; type de proposition inconnu → échange", () => {
    const raw = JSON.stringify({ declencheur: { fait: "x", source: "y" }, registre: "toi", proposition: { type: "cadeau", contenu: "z" } });
    const b = parseBrief(raw, [], 3);
    expect(b.registre).toBe("vous");
    expect(b.proposition.type).toBe("echange");
  });
});

describe("angleDeTouche", () => {
  it("renvoie l'angle de la touche, ou le dernier au-delà", () => {
    const b = parseBrief(BON, [4], 4);
    expect(angleDeTouche(b, 0)).toBe(b.angles[0]);
    expect(angleDeTouche(b, 40)).toBe(b.angles[b.angles.length - 1]);
  });
});

describe("briefActionnable / lireBrief", () => {
  it("null n'est pas actionnable", () => {
    expect(briefActionnable(null)).toBe(false);
  });
  it("lit un brief stocké en jsonb ou en chaîne, et ignore le reste", () => {
    const b = parseBrief(BON, [4], 4);
    expect(lireBrief(b)?.raison).toBe(b.raison);
    expect(lireBrief(JSON.stringify(b))?.raison).toBe(b.raison);
    expect(lireBrief(42)).toBeNull();
  });
});

describe("appliquerEditionBrief", () => {
  it("applique les champs modifiables et marque le brief comme édité", () => {
    const b = parseBrief(BON, [4], 4);
    const r = appliquerEditionBrief(b, { raison: "Nouvelle raison", angles: ["un", "deux"], declencheur: { fait: "Vu au salon Cosmetic 360", source: "note" } }, [4]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.brief.raison).toBe("Nouvelle raison");
      expect(r.brief.declencheur?.source).toBe("note");
      expect(r.brief.edite).toBe(true);
    }
  });
  it("refuse une preuve qui n'est pas validée dans le projet", () => {
    const b = parseBrief(BON, [4], 4);
    expect(appliquerEditionBrief(b, { preuveId: 99 }, [4]).ok).toBe(false);
  });
  it("crée un brief à partir de rien quand l'utilisatrice saisit un déclencheur", () => {
    const r = appliquerEditionBrief(null, { declencheur: { fait: "Recommandée par Claire", source: "note" } }, []);
    expect(r.ok && briefActionnable(r.brief)).toBe(true);
  });
});
