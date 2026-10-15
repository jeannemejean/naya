// Qui parle, à qui : chaque générateur choisit sa voix et son contexte par `destinataire`.
// - `audience` : une publication de la marque, lue par son public (voix de la marque, contexte
//   réduit : ni énergie, ni objectifs, ni consignes de tâches).
// - `tiers` : un message au nom de l'utilisatrice à quelqu'un qui ne la connaît pas.
// Audit du 14 oct. 2026 : les posts partaient avec la voix de Naya qui parle à l'utilisatrice
// (« tu ») et tout son contexte privé ; un message de prospection aussi.
import { describe, it, expect, vi, beforeEach } from "vitest";

const claude = vi.hoisted(() => ({ callClaudeWithContext: vi.fn() }));
vi.mock("./claude", async (orig) => ({ ...(await orig<any>()), callClaudeWithContext: claude.callClaudeWithContext }));
vi.mock("../db", () => ({ db: {}, pool: { query: vi.fn(), on: vi.fn() } }));
vi.mock("../storage", () => ({ storage: {} }));
vi.mock("./profils-veille/tri", () => ({ tendancesPourLeContenu: vi.fn(async () => "") }));

const { generateContent, generateOutreachMessage } = await import("./openai");
const { depsRedaction } = await import("./atelier/deps");

const brandDna = { businessName: "Lune", businessType: "coaching" } as any;
const dernierAppel = () => claude.callClaudeWithContext.mock.calls.at(-1)![0] as any;

beforeEach(() => claude.callClaudeWithContext.mockReset());

describe("destinataire des générateurs", () => {
  it("generateContent (calendrier de contenu) : publication de la marque → audience", async () => {
    claude.callClaudeWithContext.mockResolvedValue('{"title":"T","body":"B","cta":"C","strategicNote":"N","intent":"awareness"}');
    await generateContent({ userId: "u1", platform: "instagram", goal: "visibilité", brandDna });
    expect(dernierAppel().destinataire).toBe("audience");
  });

  it("generateOutreachMessage : message à un prospect qui ne la connaît pas → tiers", async () => {
    claude.callClaudeWithContext.mockResolvedValue('{"body":"Bonjour","followUp":"Relance","reasoning":"r"}');
    await generateOutreachMessage({ userId: "u1", leadInfo: { name: "Sam", platform: "linkedin" }, messageType: "initial", goal: "rdv", brandDna } as any);
    expect(dernierAppel().destinataire).toBe("tiers");
  });

  it("l'atelier rédige les posts de la marque → audience", async () => {
    claude.callClaudeWithContext.mockResolvedValue("Le texte du post.");
    await depsRedaction.ia("u1", 7, "Écris le texte…", { plateformes: ["instagram"] });
    expect(dernierAppel().destinataire).toBe("audience");
  });
});
