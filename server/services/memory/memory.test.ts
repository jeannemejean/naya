import { describe, it, expect } from "vitest";
import { scoreCandidates, recencyScore, type Fil } from "./retrieve";
import { runUpdateEngine, parseEntries, type MemoryRepo, type MemoryCandidate } from "./extract";

// ── Scoring : SOMME PONDÉRÉE NORMALISÉE (pas un produit) ────────────────────────
describe("scoreCandidates — somme pondérée normalisée", () => {
  const cand = (id: number, distance: number | null, salience: number, ageDays: number) =>
    ({ id, content: "c" + id, entryType: "fait", salience, ageDays, distance });

  it("est ADDITIVE, pas un produit : une entrée à relevance=0 mais salience+recency forts garde un score élevé", () => {
    // A : très pertinente (distance 0 → relevance 1), mais salience faible et très ancienne.
    // B : non pertinente (distance 1 → relevance 0 après min-max), mais saliente et récente.
    const A = cand(1, 0.0, 0.1, 3650);  // 10 ans
    const B = cand(2, 1.0, 0.9, 0);     // aujourd'hui
    const ranked = scoreCandidates([A, B], "founder");
    // Avec un PRODUIT, B serait ~0 (relevance 0) ; avec la somme, B domine.
    expect(ranked[0].id).toBe(2);
    expect(ranked[0].score).toBeGreaterThan(1); // un produit donnerait 0
    expect(ranked[1].score).toBeGreaterThan(0); // A aussi > 0 (un produit le mettrait à 0)
  });

  it("à pertinence égale, l'entrée plus récente d'un fil court (reception) remonte", () => {
    const recent = cand(1, 0.2, 0.5, 1);
    const old = cand(2, 0.2, 0.5, 30);
    const ranked = scoreCandidates([recent, old], "reception");
    expect(ranked[0].id).toBe(1);
  });

  it("un point cap ANCIEN n'est pas noyé : demi-vie 180 j garde une recency notable à 90 j", () => {
    expect(recencyScore(90, "cap")).toBeCloseTo(Math.pow(0.5, 0.5), 5); // ~0.707
    // alors qu'en reception (demi-vie 10 j), 90 j est quasi éteint
    expect(recencyScore(90, "reception")).toBeLessThan(0.01);
  });

  it("recency = demi-vie exacte par fil (180 / 45 / 10) → 0.5 à l'âge = demi-vie", () => {
    expect(recencyScore(180, "cap")).toBeCloseTo(0.5, 6);
    expect(recencyScore(45, "founder")).toBeCloseTo(0.5, 6);
    expect(recencyScore(10, "reception")).toBeCloseTo(0.5, 6);
  });

  it("respecte le Top-K par fil (cap 3 / founder 4 / reception 5)", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => cand(i + 1, 0.1 * (i % 3), 0.5, i));
    expect(scoreCandidates(many(10), "cap").length).toBe(3);
    expect(scoreCandidates(many(10), "founder").length).toBe(4);
    expect(scoreCandidates(many(10), "reception").length).toBe(5);
  });

  it("fallback sans focus (distance null) : ne plante pas, classe par importance+recency", () => {
    const ranked = scoreCandidates([cand(1, null, 0.9, 0), cand(2, null, 0.2, 0)], "cap");
    expect(ranked[0].id).toBe(1); // plus saliente
    expect(ranked.every((r) => Number.isFinite(r.score))).toBe(true);
  });
});

// ── Moteur anti-doublons (Mem0, Décision 4) ─────────────────────────────────────
function makeRepo(nearest: { id: number; content: string; similarity: number } | null) {
  const inserted: MemoryCandidate[] = [];
  const superseded: number[] = [];
  const repo: MemoryRepo = {
    async findNearest() { return nearest; },
    async insert(c) { inserted.push(c); return 1000 + inserted.length; },
    async supersede(id) { superseded.push(id); },
  };
  return { repo, inserted, superseded };
}
const entry = (content: string): MemoryCandidate => ({
  userId: "u1", projectId: 1, fil: "cap" as Fil, entryType: "fait",
  content, salience: 0.8, embedding: new Array(1536).fill(0.01),
});

describe("runUpdateEngine — ADD / NOOP / UPDATE", () => {
  it("ADD quand aucune entrée proche", async () => {
    const { repo, inserted, superseded } = makeRepo(null);
    const action = await runUpdateEngine(entry("La marque vise le haut de gamme"), { repo });
    expect(action).toBe("ADD");
    expect(inserted.length).toBe(1);
    expect(superseded.length).toBe(0);
  });

  it("ADD quand la plus proche est sous le seuil (sim < 0.85)", async () => {
    const { repo, inserted } = makeRepo({ id: 5, content: "autre sujet", similarity: 0.5 });
    const action = await runUpdateEngine(entry("Offre à 2000€"), { repo });
    expect(action).toBe("ADD");
    expect(inserted.length).toBe(1);
  });

  it("NOOP : ré-extraire un fait QUASI IDENTIQUE ne crée AUCUNE nouvelle ligne", async () => {
    const { repo, inserted, superseded } = makeRepo({ id: 7, content: "La marque vise le haut de gamme", similarity: 0.97 });
    const arbitrate = async () => "NOOP" as const;
    const action = await runUpdateEngine(entry("La marque vise le haut de gamme."), { repo, arbitrate });
    expect(action).toBe("NOOP");
    expect(inserted.length).toBe(0);   // aucune insertion
    expect(superseded.length).toBe(0); // aucune invalidation
  });

  it("UPDATE : un fait qui CONTREDIT l'ancien → l'ancien est supersédé ET le nouveau inséré (bi-temporel)", async () => {
    const { repo, inserted, superseded } = makeRepo({ id: 9, content: "Offre à 2000€", similarity: 0.93 });
    const arbitrate = async () => "UPDATE" as const;
    const action = await runUpdateEngine(entry("Offre à 3000€"), { repo, arbitrate });
    expect(action).toBe("UPDATE");
    expect(superseded).toEqual([9]);          // l'ancienne (id 9) passe en supersededAt
    expect(inserted.length).toBe(1);          // la nouvelle est insérée
    expect(inserted[0].content).toBe("Offre à 3000€");
  });
});

// ── Extraction : n'invente rien ─────────────────────────────────────────────────
describe("parseEntries — pas d'hallucination", () => {
  it("texte sans info durable / sortie vide → []", () => {
    expect(parseEntries("[]")).toEqual([]);
    expect(parseEntries("ok merci")).toEqual([]);
    expect(parseEntries("")).toEqual([]);
  });

  it("JSON valide → entrées atomiques typées et routées", () => {
    const out = parseEntries('Voici: [{"fil":"cap","entryType":"décision","content":"Offre à 2000€","importance":9}]');
    expect(out.length).toBe(1);
    expect(out[0].fil).toBe("cap");
    expect(out[0].content).toBe("Offre à 2000€");
    expect(out[0].importance).toBe(9);
  });

  it("ignore les entrées au fil invalide (pas de fabrication)", () => {
    const out = parseEntries('[{"fil":"inconnu","content":"x"},{"fil":"founder","entryType":"préférence","content":"Décide vite","importance":6}]');
    expect(out.length).toBe(1);
    expect(out[0].fil).toBe("founder");
  });
});
