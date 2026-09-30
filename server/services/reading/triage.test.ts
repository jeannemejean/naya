import { describe, it, expect } from "vitest";
import { etage1, FRAICHEUR_JOURS, parseNotes, selectionFinale, SEUIL_RETENTION, MAX_FICHES, MAX_PAR_PROJET } from "./triage";
import { hashUrl, canonicalizeUrl } from "./url";

const TODAY = new Date("2026-10-01T06:00:00Z");
const ilYA = (jours: number) => new Date(TODAY.getTime() - jours * 24 * 3600 * 1000);
const brut = (o: Partial<Parameters<typeof etage1>[0][number]> = {}) => ({
  url: "https://media.fr/article-a",
  title: "Le packaging durable change de régime",
  source: "Média",
  publishedAt: ilYA(1),
  projectId: 1,
  ...o,
});

describe("etage1 — le tri déterministe, avant tout appel modèle", () => {
  it("laisse passer un article frais et inconnu", () => {
    const out = etage1([brut()], { today: TODAY, urlHashDejaVus: new Set() });
    expect(out).toHaveLength(1);
    expect(out[0].urlHash).toBe(hashUrl(canonicalizeUrl("https://media.fr/article-a")!));
  });

  it(`écarte ce qui est plus vieux que ${FRAICHEUR_JOURS} jours`, () => {
    const out = etage1([brut({ publishedAt: ilYA(FRAICHEUR_JOURS + 1) })], { today: TODAY, urlHashDejaVus: new Set() });
    expect(out).toEqual([]);
  });

  it("écarte un candidat SANS date : une date inconnue n'est pas une date fraîche", () => {
    const out = etage1([brut({ publishedAt: null })], { today: TODAY, urlHashDejaVus: new Set() });
    expect(out).toEqual([]);
  });

  it("écarte une URL déjà vue, même sous une forme avec paramètres de suivi", () => {
    const dejaVus = new Set([hashUrl(canonicalizeUrl("https://media.fr/article-a")!)]);
    const out = etage1([brut({ url: "https://media.fr/article-a?utm_source=x" })], { today: TODAY, urlHashDejaVus: dejaVus });
    expect(out).toEqual([]);
  });

  it("écarte les domaines exclus", () => {
    const out = etage1([brut({ url: "https://news.google.com/articles/xyz" })], { today: TODAY, urlHashDejaVus: new Set() });
    expect(out).toEqual([]);
  });

  it("dédoublonne par titre normalisé, même quand les URLs diffèrent", () => {
    const out = etage1(
      [
        brut({ url: "https://media-a.fr/x", title: "Le packaging durable change de régime" }),
        brut({ url: "https://media-b.fr/y", title: "LE PACKAGING DURABLE CHANGE DE RÉGIME !" }),
      ],
      { today: TODAY, urlHashDejaVus: new Set() },
    );
    expect(out).toHaveLength(1);
    expect(out[0].url).toContain("media-a.fr");  // le premier arrivé gagne
  });

  it("dédoublonne deux URLs identiques au suivi près à l'intérieur du même lot", () => {
    const out = etage1(
      [brut({ url: "https://media.fr/x?utm_source=a" }), brut({ url: "https://media.fr/x?utm_source=b" })],
      { today: TODAY, urlHashDejaVus: new Set() },
    );
    expect(out).toHaveLength(1);
  });

  it("écarte une URL inexploitable sans jeter", () => {
    expect(etage1([brut({ url: "pas une url" })], { today: TODAY, urlHashDejaVus: new Set() })).toEqual([]);
  });

  it("écarte un titre qui se normalise en chaîne vide", () => {
    const out = etage1([brut({ title: "!!! --" })], { today: TODAY, urlHashDejaVus: new Set() });
    expect(out).toEqual([]);
  });

  it(`conserve un candidat publié il y a exactement ${FRAICHEUR_JOURS} jours`, () => {
    const out = etage1([brut({ publishedAt: ilYA(FRAICHEUR_JOURS) })], { today: TODAY, urlHashDejaVus: new Set() });
    expect(out).toHaveLength(1);
  });

  it("ne fait aucun appel réseau ni modèle : la fonction est pure et synchrone", () => {
    expect(etage1([], { today: TODAY, urlHashDejaVus: new Set() })).toEqual([]);
  });

  it("écarte une Invalid Date comme une absence de date, pas comme une date fraîche", () => {
    // Une Invalid Date est un objet TRUTHY (`!d` est false) dont getTime() vaut NaN
    // (`NaN < limite` est aussi false) : sans garde explicite, elle passerait le filtre.
    const out = etage1([brut({ publishedAt: new Date(NaN) })], { today: TODAY, urlHashDejaVus: new Set() });
    expect(out).toEqual([]);
  });
});

const cand = (url: string, projectId = 1) => ({
  url, urlHash: `h-${url}`, title: `titre ${url}`, source: null,
  publishedAt: new Date("2026-09-30T08:00:00Z"), projectId,
});

describe("parseNotes — lire la sortie du modèle sans lui faire confiance", () => {
  it("lit un tableau JSON propre", () => {
    const out = parseNotes('[{"url":"https://a.fr/x","score":0.82,"rationale":"parce que"}]');
    expect(out).toEqual([{ url: "https://a.fr/x", score: 0.82, rationale: "parce que" }]);
  });

  it("lit un JSON entouré de texte ou de balises markdown", () => {
    const out = parseNotes('Voici :\n```json\n[{"url":"https://a.fr/x","score":0.9,"rationale":"r"}]\n```\nVoilà.');
    expect(out).toHaveLength(1);
  });

  it("rend une liste vide sur une sortie illisible, sans jeter", () => {
    expect(parseNotes("je n'ai pas compris")).toEqual([]);
    expect(parseNotes("")).toEqual([]);
  });

  it("écarte les entrées incomplètes ou au score hors bornes", () => {
    const out = parseNotes('[{"url":"https://a.fr/x","score":1.7,"rationale":"r"},{"score":0.9},{"url":"https://b.fr/y","score":0.8,"rationale":"r"}]');
    expect(out.map((n) => n.url)).toEqual(["https://b.fr/y"]);
  });
});

describe("selectionFinale — le seuil et les plafonds, hors de portée du modèle", () => {
  it("quand rien n'atteint le seuil : ZÉRO fiche, et surtout pas la moins mauvaise", () => {
    const candidats = [cand("https://a.fr/1"), cand("https://a.fr/2")];
    const notes = [
      { url: "https://a.fr/1", score: SEUIL_RETENTION - 0.01, rationale: "presque" },
      { url: "https://a.fr/2", score: 0.2, rationale: "non" },
    ];
    expect(selectionFinale(candidats, notes)).toEqual([]);
  });

  it("retient exactement ce qui passe le seuil, pas un de plus", () => {
    const candidats = [cand("https://a.fr/1"), cand("https://a.fr/2")];
    const notes = [
      { url: "https://a.fr/1", score: 0.95, rationale: "oui" },
      { url: "https://a.fr/2", score: 0.4, rationale: "non" },
    ];
    const out = selectionFinale(candidats, notes);
    expect(out).toHaveLength(1);
    expect(out[0].url).toBe("https://a.fr/1");
    expect(out[0].score).toBe(0.95);
  });

  it(`plafonne à ${MAX_FICHES} fiches, les mieux notées d'abord`, () => {
    const candidats = [1, 2, 3, 4, 5].map((i) => cand(`https://a.fr/${i}`, i));
    // Scores écrits en littéraux, jamais calculés : 0.71 + 2 * 0.05 vaut 0.8099999999999999
    // en binaire, et le test échouerait sur une égalité stricte.
    const scores = [0.72, 0.78, 0.84, 0.9, 0.96];
    const notes = candidats.map((c, i) => ({ url: c.url, score: scores[i], rationale: "r" }));
    const out = selectionFinale(candidats, notes);
    expect(out).toHaveLength(MAX_FICHES);
    expect(out.map((o) => o.score)).toEqual([0.96, 0.9, 0.84]);
  });

  it(`ne donne jamais plus de ${MAX_PAR_PROJET} fiches au même projet`, () => {
    const candidats = [cand("https://a.fr/1", 7), cand("https://a.fr/2", 7), cand("https://a.fr/3", 7), cand("https://b.fr/1", 8)];
    const notes = [
      { url: "https://a.fr/1", score: 0.99, rationale: "r" },
      { url: "https://a.fr/2", score: 0.98, rationale: "r" },
      { url: "https://a.fr/3", score: 0.97, rationale: "r" },
      { url: "https://b.fr/1", score: 0.75, rationale: "r" },
    ];
    const out = selectionFinale(candidats, notes);
    expect(out.filter((o) => o.projectId === 7)).toHaveLength(MAX_PAR_PROJET);
    expect(out.map((o) => o.url)).toContain("https://b.fr/1");
  });

  it("une note qui ne correspond à aucun candidat est ignorée (le modèle a inventé une URL)", () => {
    const out = selectionFinale([cand("https://a.fr/1")], [{ url: "https://invente.fr", score: 0.99, rationale: "r" }]);
    expect(out).toEqual([]);
  });

  it("un candidat non noté n'est pas retenu par défaut", () => {
    expect(selectionFinale([cand("https://a.fr/1")], [])).toEqual([]);
  });

  it("deux notes sur la même URL ne donnent qu'une seule fiche, avec le score le plus élevé", () => {
    const out = selectionFinale(
      [cand("https://a.fr/1")],
      [
        { url: "https://a.fr/1", score: 0.9, rationale: "haute" },
        { url: "https://a.fr/1", score: 0.75, rationale: "basse" },
      ],
    );
    expect(out).toHaveLength(1);
    expect(out[0].score).toBe(0.9);
  });
});
