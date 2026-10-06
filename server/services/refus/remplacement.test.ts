import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../claude", () => ({
  callClaudeWithContext: vi.fn(),
  CLAUDE_MODELS: { fast: "fast-model", smart: "smart-model" },
}));
vi.mock("../garde-langue", () => ({ imposerLangueDuCompte: vi.fn(async () => 0) }));

import { callClaudeWithContext } from "../claude";
import { genererRemplacement } from "./remplacement";

const mockClaude = callClaudeWithContext as unknown as ReturnType<typeof vi.fn>;
const input = {
  userId: "u1",
  tache: { title: "Écrire un post", description: "Desc origine", estimatedDuration: 45, projectId: 7 },
  raison: "too_vague" as const,
  freeText: "il manque un angle précis",
  refusRecents: ["- A (/, source: ai) — refused, reason: other"],
};

beforeEach(() => { mockClaude.mockClear(); });

describe("genererRemplacement", () => {
  it("réponse JSON valide (avec clôtures) → Remplacement", async () => {
    mockClaude.mockResolvedValue('```json\n{"title":"Nouveau","description":"Desc","type":"content","category":"marketing","estimatedDuration":30}\n```');
    const r = await genererRemplacement(input);
    expect(r).toMatchObject({ title: "Nouveau", description: "Desc", estimatedDuration: 30 });
    const opts = mockClaude.mock.calls[0][0];
    expect(opts.projectId).toBe(7);
    expect(opts.model).toBe("fast-model");
  });
  it("réponse non-JSON → null", async () => {
    mockClaude.mockResolvedValue("désolé, pas de JSON");
    expect(await genererRemplacement(input)).toBeNull();
  });
  it("levée → null", async () => {
    mockClaude.mockRejectedValueOnce(new Error("boom"));
    expect(await genererRemplacement(input)).toBeNull();
  });
  it("le prompt contient raison lisible et explication", async () => {
    mockClaude.mockResolvedValue('{"title":"N","description":"D"}');
    await genererRemplacement(input);
    const msg = mockClaude.mock.calls[0][0].userMessage as string;
    expect(msg).toContain("trop vague");
    expect(msg).toContain("il manque un angle précis");
    expect(msg).toContain("Écrire un post");
  });
  it("« Task 2 » dans la description est remplacé", async () => {
    mockClaude.mockResolvedValue('{"title":"N","description":"Voir Task 2 pour la suite","activationPrompt":"Fais Task 2"}');
    const r = await genererRemplacement(input);
    expect(r!.description).not.toMatch(/Task 2/);
    expect(r!.activationPrompt).not.toMatch(/Task 2/);
  });
});
