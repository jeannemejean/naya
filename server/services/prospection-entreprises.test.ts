import { describe, it, expect } from "vitest";
import {
  cleEntreprise,
  correspondAUneExclusion,
  domaineProfessionnel,
  lirePosteEtEntreprise,
  memeEntreprise,
  ressembleAUnPoste,
} from "./prospection-entreprises";

describe("ressembleAUnPoste", () => {
  it("reconnaît un poste, avec ou sans accent", () => {
    for (const t of ["Directrice marketing", "Gérant", "Fondatrice", "CEO", "Head of Brand", "Co-fondateur", "Freelance", "Indépendante"]) {
      expect(ressembleAUnPoste(t), t).toBe(true);
    }
  });
  it("laisse passer un nom d'entreprise", () => {
    for (const t of ["Encore Merci", "Cité du Vin", "Maison Basile", "Acme"]) {
      expect(ressembleAUnPoste(t), t).toBe(false);
    }
  });
});

describe("lirePosteEtEntreprise", () => {
  it("deux morceaux : poste et entreprise", () => {
    expect(lirePosteEtEntreprise("Directrice", "Acme")).toEqual({ role: "Directrice", company: "Acme" });
  });
  it("un morceau inconnu ne devient pas une entreprise s'il décrit un poste", () => {
    expect(lirePosteEtEntreprise(null, "Directrice marketing")).toEqual({ role: "Directrice marketing", company: null });
  });
  it("garde l'entreprise écrite dans le poste", () => {
    expect(lirePosteEtEntreprise(null, "Fondatrice chez Maison Basile")).toEqual({ role: "Fondatrice", company: "Maison Basile" });
  });
});

describe("cleEntreprise", () => {
  it("ignore la casse, les accents, la ponctuation et la forme juridique", () => {
    const cle = cleEntreprise("Atelier Lumière");
    expect(cle).toBe("atelier lumiere");
    expect(cleEntreprise("ATELIER LUMIERE SAS")).toBe(cle);
    expect(cleEntreprise("Atelier Lumière, S.A.R.L.")).toBe(cle);
  });
  it("une mention générique n'identifie personne", () => {
    for (const t of ["Freelance", "Indépendant", "Self-employed", "Consultant", null, "", "  "]) {
      expect(cleEntreprise(t), String(t)).toBeNull();
    }
  });
});

describe("domaineProfessionnel", () => {
  it("garde un domaine d'entreprise", () => {
    expect(domaineProfessionnel(" Marie@Acme.FR ")).toBe("acme.fr");
  });
  it("écarte les messageries grand public", () => {
    for (const e of ["a@gmail.com", "a@outlook.fr", "a@orange.fr", "a@icloud.com", "pas-une-adresse", null]) {
      expect(domaineProfessionnel(e), String(e)).toBeNull();
    }
  });
});

describe("memeEntreprise", () => {
  it("même nom ou même domaine", () => {
    expect(memeEntreprise({ company: "Acme SAS" }, { company: "ACME" })).toBe(true);
    expect(memeEntreprise({ email: "a@acme.fr", company: "Acme" }, { email: "b@acme.fr", company: "Acme France" })).toBe(true);
  });
  it("deux indépendants ou deux adresses Gmail ne sont pas collègues", () => {
    expect(memeEntreprise({ company: "Freelance" }, { company: "Freelance" })).toBe(false);
    expect(memeEntreprise({ email: "a@gmail.com" }, { email: "b@gmail.com" })).toBe(false);
  });
  it("sans information commune : non", () => {
    expect(memeEntreprise({ company: "Acme" }, { company: "Globex" })).toBe(false);
    expect(memeEntreprise({}, {})).toBe(false);
  });
});

describe("correspondAUneExclusion", () => {
  it("cherche le mot exact dans le poste et l'entreprise, sans casse ni accent", () => {
    expect(correspondAUneExclusion({ role: null, company: "Agence Lumière" }, ["agence"])).toBe(true);
    expect(correspondAUneExclusion({ role: "Graphiste Freelance", company: null }, ["FREELANCE"])).toBe(true);
    expect(correspondAUneExclusion({ role: "Gérant", company: "Café" }, ["cafe"])).toBe(true);
  });
  it("ne se déclenche pas sur un morceau de mot", () => {
    expect(correspondAUneExclusion({ role: null, company: "Studiolo" }, ["studio"])).toBe(false);
  });
  it("sans exclusion ou sans texte : rien n'est écarté", () => {
    expect(correspondAUneExclusion({ role: "Directrice", company: "Acme" }, [])).toBe(false);
    expect(correspondAUneExclusion({ role: null, company: null }, ["agence"])).toBe(false);
    expect(correspondAUneExclusion({ role: "Directrice", company: "Acme" }, ["", "  "])).toBe(false);
  });
});
