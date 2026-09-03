import { describe, it, expect, vi, beforeEach } from "vitest";

// On mocke le storage (accès DB) : seule la logique d'ingestion elle-même doit être
// exercée par ces tests, jamais une vraie base.
vi.mock("../../storage", () => ({
  storage: {
    getContentById: vi.fn(),
    upsertContentReception: vi.fn(),
    getConversionCreditSumForContent: vi.fn(),
  },
}));

// L'insertion mémoire directe (memory_entries) passe par `db.insert(...).values(...)`.
const memoryInsertValues = vi.fn().mockResolvedValue(undefined);
vi.mock("../../db", () => ({
  db: { insert: vi.fn(() => ({ values: memoryInsertValues })) },
}));

/**
 * Faux `content_reception` fidèle à la contrainte d'unicité réelle
 * `(content_id, platform, measured_at)` : rejouer la même mesure ÉCRASE la ligne et
 * signale `inserted: false`. Sert au test d'idempotence : on veut compter des LIGNES
 * (mesure ET mémoire), pas des appels de mock.
 */
function fakeReceptionTable() {
  const rows = new Map<string, Record<string, unknown>>();
  const upsert = vi.fn(async (row: any) => {
    const key = `${row.contentId}|${row.platform}|${new Date(row.measuredAt).toISOString()}`;
    const inserted = !rows.has(key);
    rows.set(key, row);
    return { inserted };
  });
  return { rows, upsert };
}

// L'embedding ne doit jamais partir en réseau depuis un test.
vi.mock("../memory/embed", () => ({
  embedText: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
}));

import { storage } from "../../storage";
import { db } from "../../db";
import { embedText } from "../memory/embed";
import { ingestSignals, formatReceptionMemoryPhrase } from "./ingest";
import { receivedVsIntentScore } from "./score";
import type { ReceptionSignal } from "./types";

function signal(overrides: Partial<ReceptionSignal> = {}): ReceptionSignal {
  return {
    contentId: 1,
    platform: "instagram",
    saves: 20,
    shares: 5,
    comments: 3,
    reach: 1000,
    sentimentScore: null,
    measuredAt: new Date("2026-08-15T00:00:00.000Z"),
    source: "manual",
    ...overrides,
  };
}

function contentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    userId: "u1",
    projectId: 7,
    title: "Post de lancement",
    intent: "conversion",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  memoryInsertValues.mockClear().mockResolvedValue(undefined);
  (embedText as any).mockResolvedValue([0.1, 0.2, 0.3]);
  // Par défaut la mesure est une PREMIÈRE écriture : l'entrée mémoire l'accompagne.
  (storage.upsertContentReception as any).mockResolvedValue({ inserted: true });
  // Par défaut, AUCUNE ligne d'attribution pour ce contenu : le storage renvoie `null`
  // (non mesuré), jamais `0` — voir services/attribution/credit-sum.ts.
  (storage.getConversionCreditSumForContent as any).mockResolvedValue(null);
});

describe("formatReceptionMemoryPhrase (pure)", () => {
  it("mentionne le score en pourcentage quand il est connu", () => {
    const phrase = formatReceptionMemoryPhrase({
      contentTitle: "Post de lancement",
      platform: "instagram",
      score: 0.73,
      intent: "conversion",
      rationale: "Bonne réception.",
    });
    expect(phrase).toContain("Post de lancement");
    expect(phrase).toContain("instagram");
    expect(phrase).toContain("score 73/100");
    expect(phrase).toContain("intention conversion");
    expect(phrase).toContain("Bonne réception.");
  });

  it("dit le score indisponible plutôt que d'afficher 0 ou null quand le score est null", () => {
    const phrase = formatReceptionMemoryPhrase({
      contentTitle: "Post",
      platform: "tiktok",
      score: null,
      intent: "awareness",
      rationale: "Portée inconnue.",
    });
    expect(phrase).toContain("score indisponible");
    expect(phrase).not.toContain("null");
  });

  it("dit l'intention non déclarée plutôt que d'afficher null", () => {
    const phrase = formatReceptionMemoryPhrase({
      contentTitle: "Post",
      platform: "tiktok",
      score: null,
      intent: null,
      rationale: "Pas d'intention.",
    });
    expect(phrase).toContain("intention non déclarée");
  });
});

describe("ingestSignals", () => {
  it("écrit la mesure et l'entrée mémoire pour un signal valide", async () => {
    (storage.getContentById as any).mockResolvedValue(contentRow());

    const result = await ingestSignals("u1", [signal()]);

    expect(result.written).toBe(1);
    expect(result.errors).toEqual([]);
    expect(storage.upsertContentReception).toHaveBeenCalledTimes(1);
    const row = (storage.upsertContentReception as any).mock.calls[0][0];
    expect(row).toMatchObject({ contentId: 1, projectId: 7, platform: "instagram" });
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(memoryInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1", projectId: 7, fil: "reception", entryType: "signal_reception" }),
    );
  });

  /**
   * LOT 3B a fermé la boucle : `conversionsInWindow` vient désormais de
   * `storage.getConversionCreditSumForContent`, jamais d'un `null` câblé en dur. Ce test
   * fait varier la valeur renvoyée par le storage et vérifie qu'elle atteint bien le score
   * — si quelqu'un revenait à `conversionsInWindow: null` dans ingest.ts, la valeur du
   * storage ne changerait plus rien et ce test échouerait.
   */
  it("passe la somme réelle des crédits d'attribution renvoyée par le storage", async () => {
    (storage.getContentById as any).mockResolvedValue(contentRow({ intent: "conversion" }));
    (storage.getConversionCreditSumForContent as any).mockResolvedValue(0.6);

    await ingestSignals("u1", [signal()]);

    expect(storage.getConversionCreditSumForContent).toHaveBeenCalledWith(1);
    const row = (storage.upsertContentReception as any).mock.calls[0][0];
    const s = signal();

    const avecCredit = receivedVsIntentScore({
      intent: "conversion", saves: s.saves, shares: s.shares, comments: s.comments,
      reach: s.reach, sentimentScore: s.sentimentScore, conversionsInWindow: 0.6,
    });

    expect(row.receivedVsIntentScore).toBe(avecCredit.score);
    expect(row.confidence).toBe(avecCredit.confidence);
  });

  /**
   * Zéro crédit est une VRAIE MESURE (le contenu est passé par des fenêtres d'attribution,
   * il n'a simplement rien capté), pas une absence : il doit produire le même verdict que
   * `conversionsInWindow: 0` explicite, PAS celui de `null` (qui exclurait le signal du
   * calcul et gonflerait artificiellement la confiance). Test dédié : un simple
   * `not.toBeNull()` resterait vert même si ingest.ts régressait vers `null`.
   */
  it("zéro crédit produit le verdict du zéro mesuré, jamais celui du non-mesuré", async () => {
    (storage.getContentById as any).mockResolvedValue(contentRow({ intent: "conversion" }));
    (storage.getConversionCreditSumForContent as any).mockResolvedValue(0);

    await ingestSignals("u1", [signal()]);

    const row = (storage.upsertContentReception as any).mock.calls[0][0];
    const s = signal();

    const avecZeroMesure = receivedVsIntentScore({
      intent: "conversion", saves: s.saves, shares: s.shares, comments: s.comments,
      reach: s.reach, sentimentScore: s.sentimentScore, conversionsInWindow: 0,
    });
    const avecNonMesure = receivedVsIntentScore({
      intent: "conversion", saves: s.saves, shares: s.shares, comments: s.comments,
      reach: s.reach, sentimentScore: s.sentimentScore, conversionsInWindow: null,
    });

    expect(row.receivedVsIntentScore).toBe(avecZeroMesure.score);
    expect(row.confidence).toBe(avecZeroMesure.confidence);
    expect(row.receivedVsIntentScore).not.toBe(avecNonMesure.score);
    expect(row.confidence).not.toBe(avecNonMesure.confidence);
  });

  /**
   * C1 (revue finale) — l'autre face du test ci-dessus. `null` (aucune ligne
   * d'attribution) doit traverser l'ingestion TEL QUEL : le contenu n'est jamais passé par
   * une fenêtre de conversion, ce n'est donc pas un échec mesuré. Un `?? 0` réintroduit ici
   * ferait replonger tout contenu d'intention conversion d'une marque sans conversion
   * déclarée à ≤ 0,30/1 avec une confiance ~0,9 — ce test l'interdit.
   */
  it("aucune ligne d'attribution (null) produit le verdict NON MESURÉ, jamais celui du zéro mesuré", async () => {
    (storage.getContentById as any).mockResolvedValue(contentRow({ intent: "conversion" }));
    (storage.getConversionCreditSumForContent as any).mockResolvedValue(null);

    await ingestSignals("u1", [signal()]);

    const row = (storage.upsertContentReception as any).mock.calls[0][0];
    const s = signal();

    const nonMesure = receivedVsIntentScore({
      intent: "conversion", saves: s.saves, shares: s.shares, comments: s.comments,
      reach: s.reach, sentimentScore: s.sentimentScore, conversionsInWindow: null,
    });
    const zeroMesure = receivedVsIntentScore({
      intent: "conversion", saves: s.saves, shares: s.shares, comments: s.comments,
      reach: s.reach, sentimentScore: s.sentimentScore, conversionsInWindow: 0,
    });

    expect(row.receivedVsIntentScore).toBe(nonMesure.score);
    expect(row.confidence).toBe(nonMesure.confidence);
    expect(row.receivedVsIntentScore).not.toBe(zeroMesure.score);
    expect(row.confidence).not.toBe(zeroMesure.confidence);
  });

  it("reporte une erreur sur le signal si le contenu est introuvable, sans casser les autres", async () => {
    (storage.getContentById as any)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(contentRow({ id: 2 }));

    const result = await ingestSignals("u1", [
      signal({ contentId: 1 }),
      signal({ contentId: 2 }),
    ]);

    expect(result.written).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ contentId: 1, platform: "instagram" });
    expect(storage.upsertContentReception).toHaveBeenCalledTimes(1);
  });

  it("reporte une erreur si le contenu n'appartient pas à l'utilisateur (ownership silencieux jamais un succès)", async () => {
    // getContentById filtre déjà l'ownership : un contenu d'un autre user renvoie undefined.
    (storage.getContentById as any).mockResolvedValue(undefined);

    const result = await ingestSignals("u1", [signal()]);

    expect(result.written).toBe(0);
    expect(result.errors).toHaveLength(1);
  });

  it("refuse un contenu sans marque (projectId null) — jamais de fallback inventé", async () => {
    (storage.getContentById as any).mockResolvedValue(contentRow({ projectId: null }));

    const result = await ingestSignals("u1", [signal()]);

    expect(result.written).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message.toLowerCase()).toContain("marque");
    expect(storage.upsertContentReception).not.toHaveBeenCalled();
  });

  it("sauvegarde quand même la mesure si l'écriture mémoire échoue (best-effort)", async () => {
    (storage.getContentById as any).mockResolvedValue(contentRow());
    memoryInsertValues.mockRejectedValueOnce(new Error("boom mémoire"));

    const result = await ingestSignals("u1", [signal()]);

    expect(result.written).toBe(1);
    expect(result.errors).toEqual([]);
    expect(storage.upsertContentReception).toHaveBeenCalledTimes(1);
  });

  it("sauvegarde quand même la mesure si embedText échoue", async () => {
    (storage.getContentById as any).mockResolvedValue(contentRow());
    (embedText as any).mockRejectedValueOnce(new Error("timeout embedding"));

    const result = await ingestSignals("u1", [signal()]);

    expect(result.written).toBe(1);
    expect(result.errors).toEqual([]);
  });

  it("reporte une erreur sur le signal si l'upsert échoue, sans casser les autres signaux", async () => {
    (storage.getContentById as any).mockResolvedValue(contentRow());
    (storage.upsertContentReception as any)
      .mockRejectedValueOnce(new Error("contrainte violée"))
      .mockResolvedValueOnce({ inserted: true });

    const result = await ingestSignals("u1", [
      signal({ contentId: 1 }),
      signal({ contentId: 2 }),
    ]);

    expect(result.written).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].contentId).toBe(1);
  });

  it("ne lève jamais, même si getContentById explose", async () => {
    (storage.getContentById as any).mockRejectedValue(new Error("connexion DB perdue"));

    await expect(ingestSignals("u1", [signal()])).resolves.toMatchObject({
      written: 0,
      errors: [expect.objectContaining({ contentId: 1 })],
    });
  });

  it("renvoie written: 0 et errors: [] pour une liste de signaux vide", async () => {
    const result = await ingestSignals("u1", []);
    expect(result).toEqual({ written: 0, skipped: 0, errors: [] });
  });
});

/**
 * IDEMPOTENCE — critère d'acceptation §3A.6 n°4 : « rejouer le même fichier ne double pas
 * les signaux ». Une entrée `signal_reception` EST un signal : la mémoire compte autant que
 * `content_reception`. Sans ce test, l'upsert idempotent de la mesure masquait une écriture
 * mémoire, elle, purement additive (3 rejeux = 3 entrées quasi identiques, qui monopolisent
 * ensuite le top-K par fil de `retrieveMemories` et évincent les autres marques).
 */
describe("ingestSignals — idempotence du rejeu", () => {
  it("rejouer le MÊME signal ne laisse qu'une mesure ET qu'une entrée mémoire", async () => {
    const table = fakeReceptionTable();
    (storage.getContentById as any).mockResolvedValue(contentRow());
    (storage.upsertContentReception as any).mockImplementation(table.upsert);

    const memoryRows: unknown[] = [];
    memoryInsertValues.mockImplementation(async (row: unknown) => { memoryRows.push(row); });

    await ingestSignals("u1", [signal()]);
    await ingestSignals("u1", [signal()]);
    await ingestSignals("u1", [signal()]);

    // La mesure : une seule ligne, trois écritures — c'est le rôle de l'upsert.
    expect(table.upsert).toHaveBeenCalledTimes(3);
    expect(table.rows.size).toBe(1);
    // La mémoire : une seule entrée. C'est LE défaut que ce test verrouille.
    expect(memoryRows).toHaveLength(1);
  });

  it("rejouer un fichier entier ne multiplie pas les entrées mémoire (1 par contenu, pas 1 par rejeu)", async () => {
    const table = fakeReceptionTable();
    (storage.getContentById as any).mockImplementation(async (id: number) => contentRow({ id }));
    (storage.upsertContentReception as any).mockImplementation(table.upsert);

    const memoryRows: unknown[] = [];
    memoryInsertValues.mockImplementation(async (row: unknown) => { memoryRows.push(row); });

    const fichier = [signal({ contentId: 1 }), signal({ contentId: 2 }), signal({ contentId: 3 })];
    await ingestSignals("u1", fichier);
    await ingestSignals("u1", fichier);

    expect(table.rows.size).toBe(3);
    expect(memoryRows).toHaveLength(3);
  });

  it("une mesure d'un AUTRE jour reste un signal neuf : elle écrit sa propre entrée mémoire", async () => {
    const table = fakeReceptionTable();
    (storage.getContentById as any).mockResolvedValue(contentRow());
    (storage.upsertContentReception as any).mockImplementation(table.upsert);

    const memoryRows: unknown[] = [];
    memoryInsertValues.mockImplementation(async (row: unknown) => { memoryRows.push(row); });

    await ingestSignals("u1", [signal({ measuredAt: new Date("2026-08-15T00:00:00.000Z") })]);
    await ingestSignals("u1", [signal({ measuredAt: new Date("2026-08-22T00:00:00.000Z") })]);

    expect(table.rows.size).toBe(2);
    expect(memoryRows).toHaveLength(2);
  });
});
