import { describe, it, expect, vi } from "vitest";
import { z } from "zod/v4";

const appel = vi.hoisted(() => ({ callClaudeDetailed: vi.fn() }));
vi.mock("../claude", () => ({
  callClaudeDetailed: appel.callClaudeDetailed,
  assertNotTruncated: (stop: string | undefined, etape: string) => { if (stop === "max_tokens") throw new Error(`tronqué : ${etape}`); },
}));
const { schemaJson, lireStructure, genererStructure } = await import("./structure");

const S = z.object({ choix: z.enum(["a", "b"]), note: z.number() });

describe("sorties structurées", () => {
  it("schemaJson : objet JSON Schema fermé (additionalProperties false)", () => {
    const j: any = schemaJson(S);
    expect(j.type).toBe("object");
    expect(j.additionalProperties).toBe(false);
    expect(j.required.sort()).toEqual(["choix", "note"]);
  });
  it("lireStructure valide, sinon lève", () => {
    expect(lireStructure(S, '{"choix":"a","note":2}')).toEqual({ choix: "a", note: 2 });
    expect(() => lireStructure(S, '{"choix":"c","note":2}')).toThrow(/structure_invalide/);
    expect(() => lireStructure(S, "pas du json")).toThrow(/structure_invalide/);
  });
  it("genererStructure passe le schéma, refuse une réponse tronquée, renvoie le coût", async () => {
    appel.callClaudeDetailed.mockResolvedValueOnce({ text: '{"choix":"b","note":1}', stopReason: "end_turn", coutEur: 0.002 });
    const r = await genererStructure({ schema: S, system: "s", prompt: "p", model: "m", maxTokens: 100, taskKind: "classification", etape: "test" });
    expect(r).toEqual({ valeur: { choix: "b", note: 1 }, coutEur: 0.002 });
    expect(appel.callClaudeDetailed.mock.calls[0][0].schema.type).toBe("object");
    appel.callClaudeDetailed.mockResolvedValueOnce({ text: '{"choix":', stopReason: "max_tokens", coutEur: 0.001 });
    await expect(genererStructure({ schema: S, system: "s", prompt: "p", model: "m", maxTokens: 10, taskKind: "classification", etape: "test" })).rejects.toThrow(/test/);
  });
});
