import { describe, it, expect, vi, afterEach } from "vitest";

// Mocké au niveau module : les tests du chemin heureux (plus bas) doivent vérifier ce que
// reçoit `callClaudeWithContext` — notamment le `projectId`, qui injecte la voix de Naya et
// le contexte de marque — sans jamais appeler le vrai modèle.
vi.mock("../claude", () => ({ callClaudeWithContext: vi.fn() }));

import { parseFiche, redigerFiche } from "./card";
import { callClaudeWithContext } from "../claude";

afterEach(() => {
  vi.clearAllMocks();
});

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

  it("rend null sur un JSON syntaxiquement invalide bien que des accolades soient présentes : exerce le JSON.parse en échec, pas seulement l'absence d'accolades", () => {
    // Simule une réponse coupée par la limite de jetons du modèle, en plein milieu du
    // champ "angle" : la chaîne contient bien un '{' et un '}', mais ce qu'il y a entre
    // les deux n'est pas un JSON valide (guillemet de fermeture jamais atteint).
    const tronque = '{"fait":"a","pourquoi":"b","angle":"une prise qui ne se referme jamais}';
    expect(parseFiche(tronque)).toBeNull();
  });

  it("rend null si un champ n'est pas une chaîne (nombre, objet, tableau, null) : champ() ne doit accepter que du texte", () => {
    const f = parseFiche(JSON.stringify({ fait: 42, pourquoi: { x: 1 }, angle: ["a", "b"], question: null }));
    expect(f).toBeNull();
  });
});

describe("redigerFiche — le scrape est obligatoire", () => {
  it("scrape en échec → AUCUNE fiche : juger un titre produit une fiche creuse", async () => {
    const scrape = vi.fn().mockResolvedValue(null);
    const f = await redigerFiche({ userId: "u1", candidat, scrape });
    expect(f).toBeNull();
    expect(scrape).toHaveBeenCalledWith(candidat.url, expect.any(Number));
    // Ce n'est pas seulement la fiche finale qui doit être nulle : le modèle ne doit JAMAIS
    // être sollicité sans contenu scrapé. Sans cette assertion, un test de mutation qui
    // retire le garde `if (!page || ...) return null;` resterait vert par accident (le
    // TypeError sur `page.content` serait capté par le catch externe, pas par la logique
    // voulue).
    expect(callClaudeWithContext).not.toHaveBeenCalled();
  });

  it("contenu scrapé vide → AUCUNE fiche", async () => {
    const scrape = vi.fn().mockResolvedValue({ url: candidat.url, content: "   " });
    expect(await redigerFiche({ userId: "u1", candidat, scrape })).toBeNull();
    expect(callClaudeWithContext).not.toHaveBeenCalled();
  });
});

describe("redigerFiche — chemin heureux", () => {
  it("scrape ok + sortie modèle valide → une Fiche complète", async () => {
    const scrape = vi.fn().mockResolvedValue({ url: candidat.url, content: "Contenu réel de l'article, lu pour de vrai." });
    vi.mocked(callClaudeWithContext).mockResolvedValue(
      '{"fait":"a","pourquoi":"b","angle":"c","question":"d"}',
    );
    const f = await redigerFiche({ userId: "u1", candidat, scrape });
    expect(f).toEqual({ factSummary: "a", whyThisBrand: "b", angle: "c", question: "d" });
  });

  it("transmet le projectId du candidat à callClaudeWithContext : c'est lui qui injecte la voix de Naya et le contexte de la marque", async () => {
    const scrape = vi.fn().mockResolvedValue({ url: candidat.url, content: "Contenu réel de l'article, lu pour de vrai." });
    vi.mocked(callClaudeWithContext).mockResolvedValue(
      '{"fait":"a","pourquoi":"b","angle":"c","question":"d"}',
    );
    await redigerFiche({ userId: "u1", candidat, scrape });
    expect(callClaudeWithContext).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: candidat.projectId, userId: "u1" }),
    );
  });
});
