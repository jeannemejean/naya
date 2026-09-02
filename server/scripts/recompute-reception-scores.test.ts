import { describe, it, expect, vi, beforeEach } from "vitest";

// L'embedding ne doit jamais partir en réseau depuis un test.
vi.mock("../services/memory/embed", () => ({
  embedText: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
}));

import { recomputeReceptionScores, type RecomputeRepo, type ReceptionRow } from "./recompute-reception-scores";
import { receivedVsIntentScore } from "../services/reception/score";

/**
 * Faux store EN MÉMOIRE — pas des mocks vitest sur des appels : le test d'idempotence
 * doit compter des LIGNES réellement changées dans un store, pas des invocations de mock
 * (une fonction peut être appelée deux fois et n'avoir rien changé la seconde fois).
 */
function fakeRepo(initial: {
  reception: ReceptionRow[];
  creditSums?: Record<number, number>;
  memory?: Array<{ id: number; userId: string; fil: string; entryType: string; content: string; supersededAt: Date | null }>;
}): RecomputeRepo & {
  receptionRows: ReceptionRow[];
  memoryRows: Array<{ id: number; userId: string; fil: string; entryType: string; content: string; supersededAt: Date | null }>;
  insertedMemory: unknown[];
} {
  const receptionRows = initial.reception.map((r) => ({ ...r }));
  const creditSums = initial.creditSums ?? {};
  const memoryRows = (initial.memory ?? []).map((m) => ({ ...m }));
  const insertedMemory: unknown[] = [];
  let nextMemoryId = memoryRows.reduce((max, m) => Math.max(max, m.id), 0) + 1;

  return {
    receptionRows,
    memoryRows,
    insertedMemory,
    async listReceptionRows() {
      // Copie défensive : simule un aller-retour DB, jamais la même référence.
      return receptionRows.map((r) => ({ ...r }));
    },
    async getConversionCreditSum(contentId: number) {
      return creditSums[contentId] ?? 0;
    },
    async updateReceptionScore(id, patch) {
      const row = receptionRows.find((r) => r.id === id);
      if (!row) throw new Error(`ligne ${id} introuvable`);
      row.receivedVsIntentScore = patch.receivedVsIntentScore;
      row.confidence = patch.confidence;
      row.rationale = patch.rationale;
    },
    async findActiveMemoryEntry({ userId, fil, entryType, content }) {
      const found = memoryRows.find(
        (m) => m.userId === userId && m.fil === fil && m.entryType === entryType &&
          m.content === content && m.supersededAt === null,
      );
      return found ? { id: found.id } : null;
    },
    async supersedeMemoryEntry(id: number) {
      const row = memoryRows.find((m) => m.id === id);
      if (row) row.supersededAt = new Date();
    },
    async insertMemoryEntry(entry) {
      insertedMemory.push(entry);
      memoryRows.push({
        id: nextMemoryId++,
        userId: entry.userId,
        fil: entry.fil,
        entryType: entry.entryType,
        content: entry.content,
        supersededAt: null,
      });
    },
  };
}

function row(overrides: Partial<ReceptionRow> = {}): ReceptionRow {
  return {
    id: 1,
    contentId: 1,
    projectId: 7,
    platform: "instagram",
    saves: 20,
    shares: 5,
    comments: 3,
    reach: 1000,
    sentimentScore: null,
    receivedVsIntentScore: null,
    confidence: 0,
    rationale: "Portée inconnue.",
    contentTitle: "Post de lancement",
    contentIntent: "conversion",
    contentUserId: "u1",
    ...overrides,
  };
}

describe("recomputeReceptionScores", () => {
  it("un contenu crédité voit son score bouger par rapport au même contenu sans crédit", async () => {
    // Deux contenus IDENTIQUES en signaux, un seul crédité. Si conversionsInWindow n'était
    // pas réellement câblé sur la somme des crédits, les deux scores resteraient égaux et
    // ce test ne pourrait jamais échouer.
    const repo = fakeRepo({
      reception: [
        row({ id: 1, contentId: 1 }),
        row({ id: 2, contentId: 2 }),
      ],
      creditSums: { 1: 0.6, 2: 0 },
    });

    await recomputeReceptionScores(repo);

    const credite = repo.receptionRows.find((r) => r.id === 1)!;
    const nonCredite = repo.receptionRows.find((r) => r.id === 2)!;

    expect(credite.receivedVsIntentScore).not.toBe(nonCredite.receivedVsIntentScore);

    // Et chacun correspond EXACTEMENT au calcul pur avec la bonne somme.
    const attendu1 = receivedVsIntentScore({
      intent: "conversion", saves: 20, shares: 5, comments: 3, reach: 1000,
      sentimentScore: null, conversionsInWindow: 0.6,
    });
    const attendu2 = receivedVsIntentScore({
      intent: "conversion", saves: 20, shares: 5, comments: 3, reach: 1000,
      sentimentScore: null, conversionsInWindow: 0,
    });
    expect(credite.receivedVsIntentScore).toBe(attendu1.score);
    expect(nonCredite.receivedVsIntentScore).toBe(attendu2.score);
  });

  it("est idempotent : un deuxième passage ne met à jour aucune ligne réelle", async () => {
    const repo = fakeRepo({
      reception: [row({ id: 1, contentId: 1, receivedVsIntentScore: null, confidence: 0 })],
      creditSums: { 1: 0.6 },
    });

    const premierPassage = await recomputeReceptionScores(repo);
    expect(premierPassage.updated).toBeGreaterThan(0);

    const etatApresPremierPassage = repo.receptionRows.map((r) => ({ ...r }));

    const deuxiemePassage = await recomputeReceptionScores(repo);

    expect(deuxiemePassage.updated).toBe(0);
    // Les lignes réelles du store n'ont PAS bougé — pas seulement « la fonction a été
    // appelée moins souvent ».
    expect(repo.receptionRows).toEqual(etatApresPremierPassage);
  });

  it("supersède l'entrée mémoire et en écrit une nouvelle sur un changement matériel (écart > 0,05)", async () => {
    const ancienneMesure = receivedVsIntentScore({
      intent: "conversion", saves: 20, shares: 5, comments: 3, reach: 1000,
      sentimentScore: null, conversionsInWindow: null,
    });
    // `conversionsInWindow: null` exclut le signal conversion du calcul mais saves/shares/
    // comments restent présents pour l'intention "conversion" : le score n'est PAS null ici
    // (seuls un contenu sans intention, sans portée, ou sans aucun signal mesuré le sont).
    expect(ancienneMesure.score).not.toBeNull();
    const phraseAncienne =
      `Réception mesurée du contenu « Post de lancement » (instagram) : ` +
      `score ${((ancienneMesure.score as number) * 100).toFixed(0)}/100 ` +
      `contre une intention conversion. ${ancienneMesure.rationale}`;

    const repo = fakeRepo({
      reception: [row({
        id: 1, contentId: 1,
        receivedVsIntentScore: ancienneMesure.score,
        confidence: ancienneMesure.confidence,
        rationale: ancienneMesure.rationale,
      })],
      creditSums: { 1: 0.6 },
      memory: [{ id: 100, userId: "u1", fil: "reception", entryType: "signal_reception", content: phraseAncienne, supersededAt: null }],
    });

    await recomputeReceptionScores(repo);

    const ancienne = repo.memoryRows.find((m) => m.id === 100)!;
    expect(ancienne.supersededAt).not.toBeNull();
    expect(repo.insertedMemory).toHaveLength(1);
    const nouvelle = repo.insertedMemory[0] as { content: string };
    expect(nouvelle.content).not.toBe(phraseAncienne);
    expect(nouvelle.content).toContain("Post de lancement");
  });

  it("ne touche pas la mémoire sur un changement non matériel (écart <= 0,05)", async () => {
    // L'ancien score est calé à 0,03 du score réellement recalculé : matérialise une DÉRIVE
    // (ex. arrondi historique) sans franchir le seuil de matérialité (> 0,05).
    const nouveau = receivedVsIntentScore({
      intent: "conversion", saves: 20, shares: 5, comments: 3, reach: 1000,
      sentimentScore: null, conversionsInWindow: 0,
    });
    const repo = fakeRepo({
      reception: [row({
        id: 1, contentId: 1,
        receivedVsIntentScore: (nouveau.score as number) - 0.03,
        confidence: nouveau.confidence,
        rationale: nouveau.rationale,
      })],
      creditSums: { 1: 0 },
    });

    const result = await recomputeReceptionScores(repo);

    expect(result.updated).toBeGreaterThan(0); // le score, lui, est bien rafraîchi...
    expect(repo.insertedMemory).toHaveLength(0); // ...mais aucune écriture mémoire.
  });

  it("scanne toutes les lignes fournies par le repo", async () => {
    const repo = fakeRepo({
      reception: [row({ id: 1, contentId: 1 }), row({ id: 2, contentId: 2 }), row({ id: 3, contentId: 3 })],
    });

    const result = await recomputeReceptionScores(repo);

    expect(result.scanned).toBe(3);
  });

  /**
   * Une ligne en échec ne doit jamais arrêter le recalcul des autres — sans quoi une
   * exception sur la ligne N d'un run de plusieurs centaines laisserait toutes les
   * suivantes non recalculées, invisible dans le résultat.
   */
  it("une ligne en échec est reportée dans errors sans bloquer les autres lignes", async () => {
    const repo = fakeRepo({
      reception: [row({ id: 1, contentId: 1 }), row({ id: 2, contentId: 2 })],
      creditSums: { 1: 0.6, 2: 0.6 },
    });
    const original = repo.updateReceptionScore.bind(repo);
    repo.updateReceptionScore = async (id, patch) => {
      if (id === 1) throw new Error("panne DB simulée");
      return original(id, patch);
    };

    const result = await recomputeReceptionScores(repo);

    expect(result.errors).toEqual([
      expect.objectContaining({ receptionId: 1, contentId: 1 }),
    ]);
    expect(result.updated).toBe(1); // la ligne 2 a quand même été traitée.
    expect(repo.receptionRows.find((r) => r.id === 2)!.receivedVsIntentScore).not.toBeNull();
  });
});
