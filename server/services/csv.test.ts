import { describe, it, expect } from "vitest";
import { parseCsv, mapLeadRow } from "./csv";

describe("parseCsv", () => {
  it("parse un CSV simple avec en-têtes", () => {
    const rows = parseCsv("name,email\nMarie,m@x.co\nPaul,p@x.co");
    expect(rows).toEqual([
      { name: "Marie", email: "m@x.co" },
      { name: "Paul", email: "p@x.co" },
    ]);
  });
  it("gère les champs entre guillemets contenant des virgules", () => {
    const rows = parseCsv('name,company\nMarie,"Encore Merci, SAS"');
    expect(rows[0].company).toBe("Encore Merci, SAS");
  });
  it("gère les guillemets échappés", () => {
    const rows = parseCsv('name\n"Jean ""Le Pro"""');
    expect(rows[0].name).toBe('Jean "Le Pro"');
  });
  it("gère les fins de ligne \\r\\n et les lignes vides finales", () => {
    const rows = parseCsv("a,b\r\n1,2\r\n");
    expect(rows).toEqual([{ a: "1", b: "2" }]);
  });
  it("normalise les en-têtes (espaces, casse)", () => {
    const rows = parseCsv(" Nom , E-Mail \nMarie,m@x.co");
    expect(rows[0]["nom"]).toBe("Marie");
    expect(rows[0]["e-mail"]).toBe("m@x.co");
  });
  it("renvoie [] sur entrée vide", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("   ")).toEqual([]);
  });
});

describe("mapLeadRow", () => {
  it("mappe les en-têtes FR/EN courants vers les champs lead", () => {
    const lead = mapLeadRow({ "prénom": "Marie", "nom de famille": "Dupont", "société": "Encore Merci", "poste": "CMO", "secteur": "Mode", "email": "m@x.co", "linkedin": "https://lkd.in/x" });
    expect(lead.name).toBe("Marie Dupont");
    expect(lead.company).toBe("Encore Merci");
    expect(lead.role).toBe("CMO");
    expect(lead.sector).toBe("Mode");
    expect(lead.email).toBe("m@x.co");
    expect(lead.linkedinUrl).toBe("https://lkd.in/x");
  });
  it("accepte un champ 'name'/'nom' complet", () => {
    expect(mapLeadRow({ nom: "Marie Dupont", email: "m@x.co" }).name).toBe("Marie Dupont");
  });
  it("ignore une ligne sans email ni nom", () => {
    expect(mapLeadRow({ secteur: "Mode" })).toBeNull();
  });
});
