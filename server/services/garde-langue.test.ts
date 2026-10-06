import { describe, it, expect, vi } from "vitest";

vi.mock("../storage", () => ({ storage: {} }));
vi.mock("./claude", () => ({ callClaude: vi.fn(), CLAUDE_MODELS: { fast: "fast" } }));

import { imposerLangue, type Traducteur } from "./garde-langue";

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
