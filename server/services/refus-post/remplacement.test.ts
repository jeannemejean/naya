import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../claude", () => ({
  callClaudeWithContext: vi.fn(),
  CLAUDE_MODELS: { fast: "fast-model", smart: "smart-model" },
}));
const imposer = vi.fn(async (_t: any[], _u: string) => 0);
vi.mock("../garde-langue", () => ({ imposerLangueDuCompte: (t: any[], u: string) => imposer(t, u) }));
vi.mock("../campaign-reject/preferences", () => ({
  preferencesDeLaMarque: vi.fn(async () => []),
  formaterPreferences: vi.fn((ps: any[]) => (ps.length ? "PREFS: " + ps.map((p) => p.content).join("|") : "")),
}));

import { callClaudeWithContext } from "../claude";
import { preferencesDeLaMarque } from "../campaign-reject/preferences";
import { genererPostRemplacement } from "./remplacement";

const mockClaude = callClaudeWithContext as unknown as ReturnType<typeof vi.fn>;
const mockPrefs = preferencesDeLaMarque as unknown as ReturnType<typeof vi.fn>;
const input = {
  userId: "u1",
  post: { projectId: 7, platform: "linkedin", contentType: "text", pillar: "trust", goal: "awareness", title: "Titre origine", body: "Corps origine" },
  raison: "wrong_tone" as const,
  explication: "trop institutionnel",
};

beforeEach(() => {
  mockClaude.mockReset();
  mockPrefs.mockReset();
  mockPrefs.mockResolvedValue([]);
  imposer.mockClear();
});

describe("genererPostRemplacement", () => {
  it("JSON valide avec clôtures → post", async () => {
    mockClaude.mockResolvedValue('```json\n{"title":"Nouveau","body":"Texte prêt"}\n```');
    const r = await genererPostRemplacement(input);
    expect(r).toEqual({ title: "Nouveau", body: "Texte prêt" });
    const o = mockClaude.mock.calls[0][0];
    expect(o.projectId).toBe(7);
    expect(o.model).toBe("fast-model");
    expect(o.max_tokens).toBe(1500);
  });
  it("non-JSON → null", async () => {
    mockClaude.mockResolvedValue("désolé");
    expect(await genererPostRemplacement(input)).toBeNull();
  });
  it("JSON invalide → null", async () => {
    mockClaude.mockResolvedValue('{"title":"","body":"x"}');
    expect(await genererPostRemplacement(input)).toBeNull();
  });
  it("levée du modèle → null", async () => {
    mockClaude.mockRejectedValueOnce(new Error("boom"));
    expect(await genererPostRemplacement(input)).toBeNull();
  });
  it("levée des préférences → génération quand même", async () => {
    mockPrefs.mockRejectedValueOnce(new Error("db"));
    mockClaude.mockResolvedValue('{"title":"N","body":"B"}');
    expect(await genererPostRemplacement(input)).toEqual({ title: "N", body: "B" });
  });
  it("le prompt contient raison, explication, post, réseau et préférences", async () => {
    mockPrefs.mockResolvedValue([{ id: 1, content: "pas de jargon", salience: 0.8, createdAt: null }]);
    mockClaude.mockResolvedValue('{"title":"N","body":"B"}');
    await genererPostRemplacement(input);
    const msg = mockClaude.mock.calls[0][0].userMessage as string;
    expect(msg).toContain("pas le bon ton");
    expect(msg).toContain("trop institutionnel");
    expect(msg).toContain("Titre origine");
    expect(msg).toContain("Corps origine");
    expect(msg).toContain("linkedin");
    expect(msg).toContain("PREFS: pas de jargon");
    expect(mockPrefs).toHaveBeenCalledWith("u1", 7);
  });
  it("sans projectId : aucune préférence demandée", async () => {
    mockClaude.mockResolvedValue('{"title":"N","body":"B"}');
    await genererPostRemplacement({ ...input, post: { ...input.post, projectId: null } });
    expect(mockPrefs).not.toHaveBeenCalled();
    expect(mockClaude.mock.calls[0][0].projectId).toBeNull();
  });
  it("extrait du corps limité à 1200 caractères", async () => {
    mockClaude.mockResolvedValue('{"title":"N","body":"B"}');
    await genererPostRemplacement({ ...input, post: { ...input.post, body: "x".repeat(3000) } });
    const msg = mockClaude.mock.calls[0][0].userMessage as string;
    expect(msg).toContain("x".repeat(1200));
    expect(msg).not.toContain("x".repeat(1201));
  });
  it("garde de langue appliquée puis recopiée", async () => {
    mockClaude.mockResolvedValue('{"title":"Title","body":"Body"}');
    let recu: any;
    imposer.mockImplementationOnce(async (t: any[]) => { recu = { ...t[0] }; t[0].title = "Titre"; t[0].description = "Corps"; return 1; });
    const r = await genererPostRemplacement(input);
    expect(recu).toEqual({ title: "Title", description: "Body" });
    expect(r).toEqual({ title: "Titre", body: "Corps" });
  });
});
