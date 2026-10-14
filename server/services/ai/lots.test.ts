import { describe, it, expect, vi } from "vitest";
vi.mock("./providers/anthropic", () => ({ anthropic: {} }));
vi.mock("../usage", () => ({ estimateClaudeCostEur: (_m: string, i: number, o: number) => (i + o) / 1000 }));
const { soumettreLot, lireLot } = await import("./lots");

describe("API Batch", () => {
  it("soumet une requête par élément, avec le schéma", async () => {
    const create = vi.fn(async () => ({ id: "lot_1" }));
    const id = await soumettreLot([{ customId: "t1", system: "s", prompt: "p", model: "m", maxTokens: 500, schema: { type: "object" } }], { messages: { batches: { create } } } as any);
    expect(id).toBe("lot_1");
    const req = (create.mock.calls[0] as any)[0].requests[0];
    expect(req.custom_id).toBe("t1");
    expect(req.params.output_config).toEqual({ format: { type: "json_schema", schema: { type: "object" } } });
  });
  it("null tant que le lot n'est pas terminé ; ensuite textes, erreurs et coût à 50 %", async () => {
    const enCours = { messages: { batches: { retrieve: vi.fn(async () => ({ processing_status: "in_progress" })) } } } as any;
    expect(await lireLot("lot_1", enCours)).toBeNull();
    async function* res() {
      yield { custom_id: "t1", result: { type: "succeeded", message: { model: "m", content: [{ type: "text", text: '{"a":1}' }], usage: { input_tokens: 600, output_tokens: 400 } } } };
      yield { custom_id: "t2", result: { type: "errored", error: { error: { message: "boom" } } } };
      yield { custom_id: "t3", result: { type: "expired" } };
    }
    const fini = { messages: { batches: { retrieve: vi.fn(async () => ({ processing_status: "ended" })), results: vi.fn(async () => res()) } } } as any;
    expect(await lireLot("lot_1", fini)).toEqual([
      { customId: "t1", texte: '{"a":1}', coutEur: 0.5 },
      { customId: "t2", erreur: "boom" },
      { customId: "t3", erreur: "expired" },
    ]);
  });
});
