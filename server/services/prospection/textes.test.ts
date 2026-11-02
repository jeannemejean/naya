import { describe, it, expect } from "vitest";
import { parseJsonObject } from "./textes";
import { sanitizeEmailBody, sanitizeMessage } from "../prospection-audit";

describe("parseJsonObject", () => {
  it("lit un JSON aux sauts échappés", () => {
    expect(parseJsonObject('{"body":"Bonjour,\\n\\nSuite."}').body).toBe("Bonjour,\n\nSuite.");
  });
  it("tolère de vrais retours à la ligne dans une chaîne (email en paragraphes)", () => {
    const raw = 'Voici :\n{"subject":"Objet","body":"Bonjour,\n\nUn \\"mot\\".\n\nC\'est un sujet ?"}';
    const p = parseJsonObject(raw);
    expect(p.subject).toBe("Objet");
    expect(p.body).toBe('Bonjour,\n\nUn "mot".\n\nC\'est un sujet ?');
  });
  it("renvoie {} sur un texte illisible", () => {
    expect(parseJsonObject("désolé")).toEqual({});
  });
});

describe("sanitizeEmailBody", () => {
  it("garde les paragraphes et sauts simples, assainit chaque ligne", () => {
    expect(sanitizeEmailBody("Bonjour Claire,\r\n\r\n  Un mot — puis   un autre.\nSuite.\n \n\n\nC'est un sujet ?  "))
      .toBe("Bonjour Claire,\n\nUn mot, puis un autre.\nSuite.\n\nC'est un sujet ?");
  });
  it("un texte sans saut de ligne ressort comme sanitizeMessage", () => {
    const t = "Bonjour, un mot — puis  un autre ?";
    expect(sanitizeEmailBody(t)).toBe(sanitizeMessage(t));
  });
});
