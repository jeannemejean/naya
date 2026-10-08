import { describe, it, expect, vi } from "vitest";

vi.mock("../storage", () => ({ storage: {} }));
vi.mock("./claude", () => ({ callClaude: vi.fn(), callClaudeDetailed: vi.fn(), CLAUDE_MODELS: { fast: "fast" } }));

import { imposerLangue, traducteurClaude, type Traducteur } from "./garde-langue";

const enFrancais: Traducteur = async (textes) => textes.map((t) => `FR:${t}`);

describe("imposerLangue — aucune tâche anglaise pour un compte français", () => {
  it("retraduit uniquement les champs en anglais, en un seul appel", async () => {
    const traduire = vi.fn(enFrancais);
    const taches = [
      { title: "Send the 3 personalized DMs (based on outreach template)", description: "Écris à chaque prospect de ta liste avec une accroche" },
      { title: "Photographier 3 détails de ton environnement", description: "Share one moment from your week with the community" },
      { title: "Ostéopathes Mr Darcy" },
    ];
    const n = await imposerLangue(taches, "fr", traduire);

    expect(n).toBe(2);
    expect(traduire).toHaveBeenCalledTimes(1);
    expect(taches[0].title).toBe("FR:Send the 3 personalized DMs (based on outreach template)");
    expect(taches[0].description).toBe("Écris à chaque prospect de ta liste avec une accroche");
    expect(taches[1].title).toBe("Photographier 3 détails de ton environnement");
    expect(taches[1].description).toBe("FR:Share one moment from your week with the community");
    expect(taches[2].title).toBe("Ostéopathes Mr Darcy");
  });

  it("n'appelle pas le traducteur quand tout est déjà dans la bonne langue", async () => {
    const traduire = vi.fn(enFrancais);
    await imposerLangue([{ title: "Rédiger le post de la semaine" }], "fr", traduire);
    expect(traduire).not.toHaveBeenCalled();
  });

  it("garde les textes d'origine si la traduction échoue (ne lève jamais)", async () => {
    const taches = [{ title: "Send the DMs to your prospects" }];
    const n = await imposerLangue(taches, "fr", async () => { throw new Error("API down"); });
    expect(n).toBe(0);
    expect(taches[0].title).toBe("Send the DMs to your prospects");
  });

  it("garde les textes d'origine si la réponse n'a pas la bonne longueur", async () => {
    const taches = [{ title: "Send the DMs to your prospects" }, { title: "Share the post with your network" }];
    const n = await imposerLangue(taches, "fr", async () => ["un seul"]);
    expect(n).toBe(0);
    expect(taches[0].title).toBe("Send the DMs to your prospects");
  });

  it("supporte une liste absente sans planter", async () => {
    await expect(imposerLangue(undefined as any, "fr", enFrancais)).resolves.toBe(0);
  });
});

describe("imposerLangue — lots découpés, nouvel essai, repli sur les titres (9 octobre 2026)", () => {
  const lot = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      title: `Draft DM outreach template number ${i}`,
      description: `Send the template to your prospects and document the responses ${i}`,
    }));

  it("traduit par paquets d'au plus 4 tâches", async () => {
    const traduire = vi.fn(enFrancais);
    const taches = lot(10);
    const n = await imposerLangue(taches, "fr", traduire);

    expect(n).toBe(20);
    expect(traduire).toHaveBeenCalledTimes(3);
    for (const [textes] of traduire.mock.calls) expect(textes.length).toBeLessThanOrEqual(8);
    expect(taches.every((t) => t.title.startsWith("FR:") && t.description.startsWith("FR:"))).toBe(true);
  });

  it("retente une fois un paquet qui échoue", async () => {
    let appels = 0;
    const traduire = vi.fn<Traducteur>(async (textes) => {
      appels++;
      if (appels === 1) throw new Error("JSON tronqué");
      return textes.map((t) => `FR:${t}`);
    });
    const taches = lot(2);
    const n = await imposerLangue(taches, "fr", traduire);
    expect(n).toBe(4);
    expect(traduire).toHaveBeenCalledTimes(2);
  });

  it("si le paquet échoue deux fois, traduit au moins les titres dans un appel minimal", async () => {
    // Simule un traducteur qui casse dès qu'on lui donne les descriptions (trop long).
    const traduire = vi.fn<Traducteur>(async (textes) => {
      if (textes.some((t) => t.startsWith("Send the template"))) throw new Error("max_tokens");
      return textes.map((t) => `FR:${t}`);
    });
    const taches = lot(3);
    const n = await imposerLangue(taches, "fr", traduire);

    expect(n).toBe(3);
    expect(taches.every((t) => t.title.startsWith("FR:"))).toBe(true);
    expect(taches.every((t) => t.description.startsWith("Send the template"))).toBe(true);
  });

  it("un paquet en échec n'empêche pas les autres d'être traduits", async () => {
    const traduire = vi.fn<Traducteur>(async (textes) => {
      if (textes.some((t) => t.includes("number 0"))) throw new Error("API down");
      return textes.map((t) => `FR:${t}`);
    });
    const taches = lot(6); // paquets : [0..3] en échec, [4..5] OK
    const n = await imposerLangue(taches, "fr", traduire);
    expect(n).toBe(4);
    expect(taches[0].title.startsWith("FR:")).toBe(false);
    expect(taches[5].title.startsWith("FR:")).toBe(true);
  });
});

describe("traducteurClaude — réponse tronquée", () => {
  it("refuse une réponse coupée par max_tokens au lieu de la parser", async () => {
    const claude = await import("./claude");
    (claude as any).callClaudeDetailed.mockResolvedValueOnce({ text: '["Rédiger', stopReason: "max_tokens" });
    await expect(traducteurClaude()(["Draft the post"], "fr")).rejects.toThrow(/tronqu/i);
  });

  it("rend le tableau traduit quand la réponse est complète", async () => {
    const claude = await import("./claude");
    (claude as any).callClaudeDetailed.mockResolvedValueOnce({ text: '```json\n["Rédiger le post"]\n```', stopReason: "end_turn" });
    await expect(traducteurClaude()(["Draft the post"], "fr")).resolves.toEqual(["Rédiger le post"]);
  });
});
