import { describe, it, expect, vi, beforeEach } from "vitest";

// `retrieve` est une fonction simple (pas un vi.fn) : vitest signale comme échec de test une
// exception levée par un vi.fn, même quand le code testé l'attrape.
const h = vi.hoisted(() => {
  const state: { impl: (...a: any[]) => any; calls: any[][] } = { impl: async () => ({ savoir: [] }), calls: [] };
  return { state, retrieve: (...a: any[]) => { state.calls.push(a); return state.impl(...a); }, callClaudeDetailed: vi.fn() };
});
vi.mock("./retrieve", () => ({ retrieveMemories: h.retrieve }));
vi.mock("../claude", async (orig) => ({ ...(await orig<any>()), callClaudeDetailed: h.callClaudeDetailed }));

const { savoirPourCampagne, formaterSavoirCampagne, TITRE_SAVOIR } = await import("./savoir-campagne");
const { generateCampaignStrategy, generateCampaignContent } = await import("../openai");

describe("savoirPourCampagne", () => {
  beforeEach(() => { h.state.calls = []; });

  it("formate le savoir en puces et passe objectif + nom comme focus", async () => {
    h.state.impl = async () => ({ savoir: [{ content: "A" }, { content: "B" }] });
    const r = await savoirPourCampagne("u", 3, { objective: "Vendre", name: "Camp" });
    expect(r).toBe("- A\n- B");
    expect(h.state.calls).toEqual([["u", 3, "Vendre — Camp"]]);
  });
  it("sans savoir → undefined", async () => {
    h.state.impl = async () => ({ savoir: [] });
    expect(await savoirPourCampagne("u", null, { objective: "x" })).toBeUndefined();
    expect(formaterSavoirCampagne([])).toBeUndefined();
  });
  it("échec de récupération → undefined, sans erreur", async () => {
    h.state.impl = async () => { throw new Error("boom"); };
    await expect(savoirPourCampagne("u", 1, { objective: "x" })).resolves.toBeUndefined();
  });
});

describe("prompts de campagne", () => {
  const strategy: any = { name: "N", campaignType: "visibility", coreMessage: "m", targetAudience: "a", audienceSegment: "s", phases: [], channels: [] };
  const req = (savoir?: string): any => ({ userId: "u", objective: "Vendre", duration: "1_month", ...(savoir ? { savoir } : {}) });
  const prompt = () => h.callClaudeDetailed.mock.calls[0][0].messages[0].content as string;
  beforeEach(() => {
    h.callClaudeDetailed.mockReset();
    h.callClaudeDetailed.mockResolvedValue({ text: "{}", stopReason: "end_turn" });
  });

  it("stratégie : la section figure quand du savoir est fourni", async () => {
    await generateCampaignStrategy(req("- fait appris"));
    expect(prompt()).toContain(TITRE_SAVOIR);
    expect(prompt()).toContain("CE QU'ON T'A APPRIS (recherche déposée)");
    expect(prompt()).toContain("- fait appris");
  });
  it("stratégie : absente sinon", async () => {
    await generateCampaignStrategy(req());
    expect(prompt()).not.toContain("CE QU'ON T'A APPRIS");
  });
  it("contenu : présente avec savoir, absente sans", async () => {
    h.callClaudeDetailed.mockResolvedValue({ text: "[]", stopReason: "end_turn" });
    await generateCampaignContent(req("- fait appris"), strategy);
    expect(prompt()).toContain("CE QU'ON T'A APPRIS (recherche déposée)");
    h.callClaudeDetailed.mockClear();
    await generateCampaignContent(req(), strategy);
    expect(prompt()).not.toContain("CE QU'ON T'A APPRIS");
  });
});
