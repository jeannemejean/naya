import { describe, it, expect, vi, beforeEach } from "vitest";

// On mocke le storage (accès DB) : seule la logique d'ingestion elle-même doit être
// exercée par ces tests, jamais une vraie base.
vi.mock("../../storage", () => ({
  storage: {
    getContentById: vi.fn(),
    upsertContentReception: vi.fn(),
  },
}));

// L'insertion mémoire directe (memory_entries) passe par `db.insert(...).values(...)`.
const memoryInsertValues = vi.fn().mockResolvedValue(undefined);
vi.mock("../../db", () => ({
  db: { insert: vi.fn(() => ({ values: memoryInsertValues })) },
}));

// L'embedding ne doit jamais partir en réseau depuis un test.
vi.mock("../memory/embed", () => ({
  embedText: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
}));

import { storage } from "../../storage";
import { db } from "../../db";
import { embedText } from "../memory/embed";
import { ingestSignals, formatReceptionMemoryPhrase } from "./ingest";
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
  (storage.upsertContentReception as any).mockResolvedValue(undefined);
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

  it("passe conversionsInWindow: 0 au scoring — LOT 3B le remplira", async () => {
    (storage.getContentById as any).mockResolvedValue(contentRow());

    await ingestSignals("u1", [signal()]);

    const row = (storage.upsertContentReception as any).mock.calls[0][0];
    // Le score conversion (intent conversion, sans conversion mesurée) doit être calculé
    // en excluant le poids conversion — donc rester non-null malgré 0 conversion connue.
    expect(row.receivedVsIntentScore).not.toBeNull();
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
      .mockResolvedValueOnce(undefined);

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
