// appelerClaudeAvecOutils : cache des consignes et journal d'un appel en échec. Le client
// Anthropic, l'usage, le journal et le contexte sont mockés : aucun réseau, aucune base.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  create: vi.fn(),
  logInvocation: vi.fn(),
  recordSpend: vi.fn(async () => {}),
}));
vi.mock("./ai/providers/anthropic", () => ({ anthropic: { messages: { create: h.create } } }));
vi.mock("./ai/invocation-log", () => ({ logInvocation: h.logInvocation }));
vi.mock("./usage", () => ({ recordSpend: h.recordSpend, estimateClaudeCostEur: () => 0.01 }));
vi.mock("./ai/registry", () => ({ registry: {} }));
vi.mock("./naya-context", () => ({ buildNayaContext: vi.fn(async () => "") }));

const { appelerClaudeAvecOutils } = await import("./claude");

const opts = {
  userId: "u1",
  projectId: 3,
  system: "Tu es Naya.\n\nCONSIGNES",
  messages: [{ role: "user" as const, content: "Salut" }],
  tools: [{ name: "chercher", description: "d", input_schema: { type: "object" as const, properties: {} } }],
};

beforeEach(() => vi.clearAllMocks());

describe("appelerClaudeAvecOutils", () => {
  it("envoie les consignes en un bloc texte marqué cache_control ephemeral (réutilisé par les appels de la boucle)", async () => {
    h.create.mockResolvedValueOnce({ content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 2 } });
    await appelerClaudeAvecOutils(opts);
    const req = h.create.mock.calls[0][0];
    expect(req.system).toEqual([{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }]);
    expect(req.tools).toEqual(opts.tools);
    // Le journal garde le texte des consignes, pas le tableau.
    expect(h.logInvocation.mock.calls[0][0].systemPrompt).toBe(opts.system);
  });

  it("un appel en échec est journalisé (sortie [erreur] …, zéro token) puis l'erreur remonte", async () => {
    h.create.mockRejectedValueOnce(new Error("overloaded_error"));
    await expect(appelerClaudeAvecOutils(opts)).rejects.toThrow("overloaded_error");
    expect(h.logInvocation).toHaveBeenCalledTimes(1);
    const log = h.logInvocation.mock.calls[0][0];
    expect(log).toMatchObject({ userId: "u1", projectId: 3, taskKind: "strategic_reasoning", inputTokens: 0, outputTokens: 0, costEur: 0 });
    expect(log.output).toMatch(/^\[erreur\] .*overloaded_error/);
    expect(h.recordSpend).not.toHaveBeenCalled();
  });
});
