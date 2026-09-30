import { describe, it, expect, vi } from "vitest";
import { parseFiche, redigerFiche } from "./card";

const candidat = {
  url: "https://media.fr/a", urlHash: "h", title: "Un titre", source: "Média",
  publishedAt: new Date("2026-09-30T08:00:00Z"), projectId: 1, score: 0.9, rationale: "r",
};

describe("parseFiche", () => {
  it("lit les quatre champs", () => {
    const f = parseFiche('{"fait":"Il s\'est passé X.","pourquoi":"Ça touche la marque.","angle":"Un terrain.","question":"Et toi ?"}');
    expect(f).toEqual({ factSummary: "Il s'est passé X.", whyThisBrand: "Ça touche la marque.", angle: "Un terrain.", question: "Et toi ?" });
  });

  it("tolère le bavardage et les balises autour du JSON", () => {
    expect(parseFiche('```json\n{"fait":"a","pourquoi":"b","angle":"c","question":"d"}\n```')).not.toBeNull();
  });

  it("rend null si un champ manque : une fiche incomplète ne s'affiche pas", () => {
    expect(parseFiche('{"fait":"a","pourquoi":"b","angle":"c"}')).toBeNull();
  });

  it("rend null si la question est vide : c'est le champ qui fait la fiche", () => {
    expect(parseFiche('{"fait":"a","pourquoi":"b","angle":"c","question":"   "}')).toBeNull();
  });

  it("rend null sur une sortie illisible, sans jeter", () => {
    expect(parseFiche("désolé, je n'ai pas pu")).toBeNull();
  });
});

describe("redigerFiche — le scrape est obligatoire", () => {
  it("scrape en échec → AUCUNE fiche : juger un titre produit une fiche creuse", async () => {
    const scrape = vi.fn().mockResolvedValue(null);
    const f = await redigerFiche({ userId: "u1", candidat, scrape });
    expect(f).toBeNull();
    expect(scrape).toHaveBeenCalledWith(candidat.url, expect.any(Number));
  });

  it("contenu scrapé vide → AUCUNE fiche", async () => {
    const scrape = vi.fn().mockResolvedValue({ url: candidat.url, content: "   " });
    expect(await redigerFiche({ userId: "u1", candidat, scrape })).toBeNull();
  });
});
