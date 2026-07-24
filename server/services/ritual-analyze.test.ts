import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./claude", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, callClaudeDetailed: vi.fn() };
});

import * as claude from "./claude";
import { analyzeStatusNote } from "./ritual-analyze";

const ARGS = { userId: "u1", projectId: 3, projectName: "Agence JMD", note: "peu importe" };

beforeEach(() => vi.clearAllMocks());

describe("analyzeStatusNote", () => {
  it("extrait un rituel récurrent d'un message en langage naturel", async () => {
    (claude.callClaudeDetailed as any).mockResolvedValue({
      text: JSON.stringify({
        understood: "Un rituel matinal de 20 minutes pour l'agence JMD.",
        proposals: [{
          kind: "create_ritual",
          title: "Brief news + posts JMD",
          days: "mon,tue,wed,thu,fri",
          startTime: "09:00",
          durationMinutes: 20,
        }],
      }),
      stopReason: "end_turn",
    });

    const result = await analyzeStatusNote(ARGS);

    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]).toMatchObject({
      kind: "create_ritual", title: "Brief news + posts JMD", durationMinutes: 20,
    });
  });

  it("ne propose rien pour un message sans rituel", async () => {
    (claude.callClaudeDetailed as any).mockResolvedValue({
      text: JSON.stringify({ understood: "Noté. Rien à changer dans ton planning.", proposals: [] }),
      stopReason: "end_turn",
    });

    const result = await analyzeStatusNote(ARGS);

    expect(result.proposals).toEqual([]);
    expect(result.understood).toContain("Noté");
  });

  it("tolère un JSON entouré de texte", async () => {
    (claude.callClaudeDetailed as any).mockResolvedValue({
      text: 'Voici :\n```json\n{"understood":"ok","proposals":[]}\n```',
      stopReason: "end_turn",
    });

    const result = await analyzeStatusNote(ARGS);
    expect(result.proposals).toEqual([]);
  });

  it("rejette une réponse tronquée AVANT de parser", async () => {
    (claude.callClaudeDetailed as any).mockResolvedValue({
      text: '{"understood":"ok","proposals":[{"kind":"create_ritu',
      stopReason: "max_tokens",
    });

    await expect(analyzeStatusNote(ARGS)).rejects.toThrow(/TRUNCATED/);
  });

  it("écarte une proposition mal formée plutôt que de la laisser passer", async () => {
    (claude.callClaudeDetailed as any).mockResolvedValue({
      text: JSON.stringify({
        understood: "ok",
        proposals: [
          { kind: "create_ritual", title: "Sans heure", days: "mon", startTime: "nawak", durationMinutes: 20 },
          { kind: "create_ritual", title: "Valide", days: "mon", startTime: "09:00", durationMinutes: 20 },
        ],
      }),
      stopReason: "end_turn",
    });

    const result = await analyzeStatusNote(ARGS);

    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].title).toBe("Valide");
  });

  it("écarte une heure au format correct mais hors plage (99:99)", async () => {
    // Ce cas doit échouer AVANT le correctif de isValidProposal (regex seule laisse passer 99:99)
    // et réussir APRÈS (bornes 0-23 / 0-59 vérifiées).
    (claude.callClaudeDetailed as any).mockResolvedValue({
      text: JSON.stringify({
        understood: "ok",
        proposals: [
          { kind: "create_ritual", title: "Heure impossible", days: "mon", startTime: "99:99", durationMinutes: 20 },
        ],
      }),
      stopReason: "end_turn",
    });

    const result = await analyzeStatusNote(ARGS);

    expect(result.proposals).toEqual([]);
  });

  it("écarte une heure hors plage même avec des minutes valides (25:00)", async () => {
    (claude.callClaudeDetailed as any).mockResolvedValue({
      text: JSON.stringify({
        understood: "ok",
        proposals: [
          { kind: "create_ritual", title: "Heure impossible", days: "mon", startTime: "25:00", durationMinutes: 20 },
        ],
      }),
      stopReason: "end_turn",
    });

    const result = await analyzeStatusNote(ARGS);

    expect(result.proposals).toEqual([]);
  });

  it("écarte une durée nulle", async () => {
    (claude.callClaudeDetailed as any).mockResolvedValue({
      text: JSON.stringify({
        understood: "ok",
        proposals: [
          { kind: "create_ritual", title: "Durée nulle", days: "mon", startTime: "09:00", durationMinutes: 0 },
        ],
      }),
      stopReason: "end_turn",
    });

    const result = await analyzeStatusNote(ARGS);

    expect(result.proposals).toEqual([]);
  });

  it("écarte une durée négative", async () => {
    (claude.callClaudeDetailed as any).mockResolvedValue({
      text: JSON.stringify({
        understood: "ok",
        proposals: [
          { kind: "create_ritual", title: "Durée négative", days: "mon", startTime: "09:00", durationMinutes: -10 },
        ],
      }),
      stopReason: "end_turn",
    });

    const result = await analyzeStatusNote(ARGS);

    expect(result.proposals).toEqual([]);
  });

  it("écarte un jour écrit en toutes lettres au lieu du code à 3 lettres", async () => {
    (claude.callClaudeDetailed as any).mockResolvedValue({
      text: JSON.stringify({
        understood: "ok",
        proposals: [
          { kind: "create_ritual", title: "Jour invalide", days: "lundi", startTime: "09:00", durationMinutes: 20 },
        ],
      }),
      stopReason: "end_turn",
    });

    const result = await analyzeStatusNote(ARGS);

    expect(result.proposals).toEqual([]);
  });

  it("renvoie proposals: [] sans planter quand le champ proposals est absent du JSON", async () => {
    (claude.callClaudeDetailed as any).mockResolvedValue({
      text: JSON.stringify({ understood: "ok" }),
      stopReason: "end_turn",
    });

    const result = await analyzeStatusNote(ARGS);

    expect(result.proposals).toEqual([]);
  });

  it("impute le coût IA à l'utilisateur", async () => {
    (claude.callClaudeDetailed as any).mockResolvedValue({
      text: JSON.stringify({ understood: "ok", proposals: [] }), stopReason: "end_turn",
    });

    await analyzeStatusNote(ARGS);

    expect((claude.callClaudeDetailed as any).mock.calls[0][0]).toMatchObject({
      userId: "u1", projectId: 3,
    });
  });
});
