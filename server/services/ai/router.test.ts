import { describe, it, expect } from "vitest";
import { route } from "./router";
import { registry } from "./registry";

describe("ai/router", () => {
  it("route le raisonnement stratégique vers le modèle smart (Sonnet)", () => {
    const r = route("strategic_reasoning");
    expect(r.provider).toBe("anthropic");
    expect(r.model).toBe("claude-sonnet-4-6");
  });

  it("route l'extraction (et fast/classification) vers le modèle fast (Haiku)", () => {
    expect(route("extraction").model).toBe("claude-haiku-4-5-20251001");
    expect(route("fast_generation").model).toBe("claude-haiku-4-5-20251001");
    expect(route("classification").model).toBe("claude-haiku-4-5-20251001");
  });

  it("route l'embedding vers OpenAI text-embedding-3-small (1536 dim)", () => {
    const r = route("embedding");
    expect(r.provider).toBe("openai");
    expect(r.model).toBe("text-embedding-3-small");
  });
});

describe("ai/registry", () => {
  it("expose le provider anthropic", () => {
    const p = registry.get("anthropic");
    expect(p.name).toBe("anthropic");
    expect(typeof p.generate).toBe("function");
  });

  it("lève une erreur explicite pour un provider inconnu", () => {
    expect(() => registry.get("inconnu")).toThrowError(/inconnu/i);
  });
});
