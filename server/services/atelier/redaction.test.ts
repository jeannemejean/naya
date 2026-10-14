import { describe, it, expect, vi } from "vitest";
import { redigerPost, refairePost, consigneRedaction, nettoyerTexte } from "./redaction";

const post = (over: any = {}) => ({
  id: 5, userId: "u", projectId: 9, campaignId: 3, title: "Pourquoi nos clients reviennent",
  body: "Raconter le retour d'un client fidèle, finir par une question.", platform: "linkedin",
  postFormat: "feed_image", contentType: "post", pillar: "preuve", goal: "confiance",
  contentStatus: "idea", autoPost: false, consigne: null, postStatus: "pending", publishedAt: null, ...over,
});

function fabrique(p: any = post(), over: any = {}) {
  return {
    lirePost: vi.fn(async () => p),
    reserverRedaction: vi.fn(async () => true),
    ecrireBrouillon: vi.fn(async () => {}),
    liberer: vi.fn(async () => {}),
    garde: vi.fn(async () => null),
    ia: vi.fn(async () => "Le texte du post.\n\nEt sa question ?"),
    ...over,
  };
}

describe("redigerPost", () => {
  it("met la consigne de côté (verrou), rédige, écrit le brouillon", async () => {
    const deps = fabrique();
    const r = await redigerPost(deps, "u", 5);
    expect(r).toEqual({ statut: "redige", body: "Le texte du post.\n\nEt sa question ?" });
    expect(deps.reserverRedaction).toHaveBeenCalledWith(5, "u", "Raconter le retour d'un client fidèle, finir par une question.");
    expect(deps.reserverRedaction.mock.invocationCallOrder[0]).toBeLessThan(deps.ia.mock.invocationCallOrder[0]);
    expect(deps.ecrireBrouillon).toHaveBeenCalledWith(5, "u", "Le texte du post.\n\nEt sa question ?");
    expect(deps.ia.mock.calls[0][1]).toBe(9);
  });

  it("déjà rédigé, validé, publié ou hors campagne : rien, aucune dépense", async () => {
    for (const p of [post({ consigne: "x", contentStatus: "draft" }), post({ contentStatus: "ready" }), post({ postStatus: "posted" }), post({ campaignId: null })]) {
      const deps = fabrique(p);
      expect((await redigerPost(deps, "u", 5)).statut).toBe("deja");
      expect(deps.ia).not.toHaveBeenCalled();
      expect(deps.reserverRedaction).not.toHaveBeenCalled();
    }
  });

  it("un autre passage a pris le verrou : rien, aucune dépense", async () => {
    const deps = fabrique(post(), { reserverRedaction: vi.fn(async () => false) });
    expect((await redigerPost(deps, "u", 5)).statut).toBe("deja");
    expect(deps.ia).not.toHaveBeenCalled();
  });

  it("garde de dépense : refus sans verrou ni appel", async () => {
    const deps = fabrique(post(), { garde: vi.fn(async () => ({ statut: "rien_a_faire", resume: "Budget" })) });
    expect((await redigerPost(deps, "u", 5)).statut).toBe("refus");
    expect(deps.reserverRedaction).not.toHaveBeenCalled();
    expect(deps.ia).not.toHaveBeenCalled();
  });

  it("échec ou réponse vide de l'IA : le verrou est rendu, le post reste à rédiger", async () => {
    for (const ia of [vi.fn(async () => { throw new Error("x"); }), vi.fn(async () => "   ")]) {
      const deps = fabrique(post(), { ia });
      expect((await redigerPost(deps, "u", 5)).statut).toBe("erreur");
      expect(deps.liberer).toHaveBeenCalledWith(5, "u");
      expect(deps.ecrireBrouillon).not.toHaveBeenCalled();
    }
  });

  it("post introuvable (ou d'un autre compte)", async () => {
    const deps = fabrique(post(), { lirePost: vi.fn(async () => undefined) });
    expect((await redigerPost(deps, "u", 5)).statut).toBe("introuvable");
  });
});

describe("refairePost", () => {
  it("réécrit un brouillon avec la consigne courte, en partant du texte actuel", async () => {
    const p = post({ consigne: "L'idée", contentStatus: "draft", body: "Ancien texte" });
    const deps = fabrique(p);
    const r = await refairePost(deps, "u", 5, "Plus court");
    expect(r.statut).toBe("redige");
    const prompt = deps.ia.mock.calls[0][2] as string;
    expect(prompt).toContain("Plus court");
    expect(prompt).toContain("Ancien texte");
    expect(prompt).toContain("L'idée");
    expect(deps.ecrireBrouillon).toHaveBeenCalled();
    expect(deps.reserverRedaction).not.toHaveBeenCalled();
  });

  it("un post encore à rédiger : la consigne est mise de côté d'abord", async () => {
    const deps = fabrique();
    await refairePost(deps, "u", 5, "");
    expect(deps.reserverRedaction).toHaveBeenCalled();
  });

  it("refuse un post validé ou publié (on dévalide d'abord)", async () => {
    const deps = fabrique(post({ contentStatus: "ready" }));
    expect((await refairePost(deps, "u", 5, "x")).statut).toBe("deja");
    expect(deps.ia).not.toHaveBeenCalled();
  });

  it("consigne courte bornée à 300 caractères", async () => {
    const deps = fabrique(post({ consigne: "L'idée", contentStatus: "draft" }));
    await refairePost(deps, "u", 5, "a".repeat(1000));
    expect((deps.ia.mock.calls[0][2] as string)).not.toContain("a".repeat(301));
  });
});

describe("consigneRedaction et nettoyerTexte", () => {
  it("la consigne porte l'idée, le réseau, le format, sans inventer de chiffres", () => {
    const c = consigneRedaction(post(), "Raconter le retour", null, null);
    expect(c).toContain("linkedin");
    expect(c).toContain("Raconter le retour");
    expect(c).toContain("Pourquoi nos clients reviennent");
    expect(c).toMatch(/invente/i);
  });
  it("retire guillemets, balises de code et titres d'introduction", () => {
    expect(nettoyerTexte('```\nBonjour\n```')).toBe("Bonjour");
    expect(nettoyerTexte('"Bonjour"')).toBe("Bonjour");
    expect(nettoyerTexte("Voici le post :\n\nBonjour")).toBe("Bonjour");
    expect(nettoyerTexte("  Bonjour  ")).toBe("Bonjour");
  });
});
