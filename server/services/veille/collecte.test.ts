import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("../usage", () => ({ recordSpend: vi.fn(async () => {}), SCRAPE_COST_EUR: 0.001, GEO_COST_EUR: 0.03 }));
vi.mock("./moteurs-ia", () => ({ interrogerMoteur: vi.fn() }));
import { recordSpend } from "../usage";
import { interrogerMoteur } from "./moteurs-ia";
import { interroger } from "./collecte";

beforeEach(() => vi.clearAllMocks());

describe("interroger (GEO)", () => {
  it("impute le coût d'une réponse obtenue", async () => {
    (interrogerMoteur as any).mockResolvedValue({ texte: "x", citations: [] });
    await interroger("u1", "openai", "Q");
    expect(recordSpend).toHaveBeenCalledWith("u1", 0.03);
  });
  it("n'impute rien quand l'appel échoue (clé refusée, réseau)", async () => {
    (interrogerMoteur as any).mockRejectedValue(new Error("OpenAI : HTTP 401"));
    await expect(interroger("u1", "openai", "Q")).rejects.toThrow();
    expect(recordSpend).not.toHaveBeenCalled();
  });
});
