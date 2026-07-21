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

import { buildStepPrompt, generateStepMessage, combineInstructions } from "./sequence-message";
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
  it("injecte les consignes de rédaction utilisateur quand fournies", () => {
    const p = buildStepPrompt({ ...base, channel: "linkedin", intention: "Invitation d'ouverture", instructions: "Jamais de tiret long. Ton direct." });
    expect(p).toContain("CONSIGNES DE RÉDACTION DE L'UTILISATEUR");
    expect(p).toContain("Jamais de tiret long. Ton direct.");
  });
  it("n'ajoute aucun bloc de consignes quand instructions est absent ou vide", () => {
    const pAbsent = buildStepPrompt({ ...base, channel: "linkedin", intention: "Invitation d'ouverture" });
    expect(pAbsent).not.toContain("CONSIGNES DE RÉDACTION DE L'UTILISATEUR");
    const pEmpty = buildStepPrompt({ ...base, channel: "linkedin", intention: "Invitation d'ouverture", instructions: "   " });
    expect(pEmpty).not.toContain("CONSIGNES DE RÉDACTION DE L'UTILISATEUR");
  });
});

describe("combineInstructions", () => {
  it("combine les deux quand global et campagne sont fournis", () => {
    expect(combineInstructions("Jamais de tiret long.", "Mentionne notre offre early-bird.")).toBe(
      "Jamais de tiret long.\nMentionne notre offre early-bird.",
    );
  });
  it("retourne uniquement le global quand la campagne est absente", () => {
    expect(combineInstructions("Jamais de tiret long.", undefined)).toBe("Jamais de tiret long.");
    expect(combineInstructions("Jamais de tiret long.", null)).toBe("Jamais de tiret long.");
    expect(combineInstructions("Jamais de tiret long.", "   ")).toBe("Jamais de tiret long.");
  });
  it("retourne uniquement la campagne quand le global est absent", () => {
    expect(combineInstructions(undefined, "Mentionne notre offre early-bird.")).toBe("Mentionne notre offre early-bird.");
    expect(combineInstructions(null, "Mentionne notre offre early-bird.")).toBe("Mentionne notre offre early-bird.");
  });
  it("retourne une chaîne vide quand ni l'un ni l'autre n'est fourni", () => {
    expect(combineInstructions(undefined, undefined)).toBe("");
    expect(combineInstructions(null, null)).toBe("");
    expect(combineInstructions("  ", "  ")).toBe("");
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
