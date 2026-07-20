import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocks pour le test de garde de generateStepMessage : DB + Claude. On garde
// buildStepPrompt réel (testé en pur juste en dessous).
vi.mock("../storage", () => ({
  storage: {
    getLeadStepMessage: vi.fn(),
    upsertLeadStepMessage: vi.fn(),
  },
}));
vi.mock("./claude", async (io) => {
  const actual = await io<any>();
  return { ...actual, callClaude: vi.fn() };
});

import { buildStepPrompt, generateStepMessage } from "./sequence-message";
import { storage } from "../storage";
import * as claude from "./claude";

describe("buildStepPrompt", () => {
  const base = {
    founderName: "Jeanne", projectName: "Agence JMD",
    lead: { name: "Fred Renaud", role: "Cofondateur", company: "Petit Bivouac" },
    audit: { angle: "le nom crée une pause", observations: "marque outdoor grenobloise" },
  };
  it("LinkedIn : impose ≤200 caractères et la signature du prénom", () => {
    const p = buildStepPrompt({ ...base, channel: "linkedin", intention: "Invitation d'ouverture" });
    expect(p).toContain("200");
    expect(p).toContain("Jeanne");
    expect(p).toContain("Fred Renaud");
    expect(p).toContain("Invitation d'ouverture");
  });
  it("Email : demande un objet + un corps et rappelle l'intention", () => {
    const p = buildStepPrompt({ ...base, channel: "email", intention: "Email de valeur" });
    expect(p.toLowerCase()).toContain("objet");
    expect(p).toContain("Email de valeur");
  });
});

describe("generateStepMessage — garde anti-cache-vide", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lève une erreur et ne met JAMAIS en cache un corps vide quand la réponse IA n'est pas parsable", async () => {
    (storage.getLeadStepMessage as any).mockResolvedValue(undefined); // cache miss
    (claude.callClaude as any).mockResolvedValue("désolé je n'ai pas compris");

    const lead = { id: 42, name: "Fred Renaud", role: "Cofondateur", company: "Petit Bivouac" };
    const campaign = { name: "Agence JMD", founderName: "Jeanne" };
    const step = { id: 7, channel: "linkedin", intention: "Invitation d'ouverture" };

    await expect(
      generateStepMessage("u1", { lead, campaign, step }),
    ).rejects.toThrow(/corps vide/);

    expect(storage.upsertLeadStepMessage).not.toHaveBeenCalled();
  });
});
