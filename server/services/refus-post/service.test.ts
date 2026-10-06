import { describe, it, expect } from "vitest";
import { refuserPost, type PostRefusable, type RefusPostDeps } from "./service";

const post = (o: Partial<PostRefusable> = {}): PostRefusable => ({
  id: 10, userId: "u1", projectId: 5, campaignId: 3, socialAccountId: 4,
  title: "Mon post", body: "Corps", platform: "linkedin", contentType: "text", pillar: "trust", goal: "awareness",
  intent: "awareness", scheduledFor: new Date("2026-10-08T09:00:00Z"), postFormat: "text",
  publishedAt: null, postStatus: "pending", contentStatus: "idea", autoPost: true, ...o,
});
const remp = { title: "Nouveau titre", body: "Nouveau corps" };

function faire(over: Partial<RefusPostDeps> = {}, p: PostRefusable | null = post()) {
  const j: string[] = [];
  const d: any = {
    j,
    lirePost: async () => p ?? undefined,
    ecrireSouvenir: async (i: any) => { j.push("souvenir"); d.souvenir = i; },
    generer: async (i: any) => { j.push("generer"); d.genInput = i; return remp; },
    creerPost: async (r: any) => { j.push("creer"); d.cree = r; return { id: 99, ...r }; },
    supprimerPost: async (id: number) => { j.push(`suppr:${id}`); },
    neutraliserPost: async (u: string, id: number) => { j.push(`neutralise:${id}`); },
    ...over,
  };
  return d;
}
const entree = { userId: "u1", contentId: 10, raison: "wrong_tone" as const, explication: "trop institutionnel" as string | null, remplacer: true };

describe("refuserPost", () => {
  it("introuvable si absent, sans écriture", async () => {
    const d = faire({}, null);
    expect(await refuserPost(d, entree)).toEqual({ statut: "introuvable" });
    expect(d.j).toEqual([]);
  });
  it("introuvable si autre compte, sans écriture", async () => {
    const d = faire({}, post({ userId: "autre" }));
    expect(await refuserPost(d, entree)).toEqual({ statut: "introuvable" });
    expect(d.j).toEqual([]);
  });
  it("publié → deja_publie, aucune écriture", async () => {
    for (const o of [{ publishedAt: new Date() }, { postStatus: "posted" }, { contentStatus: "published" }]) {
      const d = faire({}, post(o));
      expect(await refuserPost(d, entree)).toEqual({ statut: "deja_publie" });
      expect(d.j).toEqual([]);
    }
  });
  it("en cours de publication (processing, posting, uploading) → deja_publie, rien d'écrit", async () => {
    for (const s of ["processing", "posting", "uploading"]) {
      const d = faire({}, post({ postStatus: s }));
      expect(await refuserPost(d, entree)).toEqual({ statut: "deja_publie" });
      expect(d.j).toEqual([]);
    }
  });
  it("ordre exact : souvenir, génération, création, suppression", async () => {
    const d = faire();
    const r: any = await refuserPost(d, entree);
    expect(d.j).toEqual(["neutralise:10", "souvenir", "generer", "creer", "suppr:10"]);
    expect(r.statut).toBe("refuse");
    expect(r.remplacement.id).toBe(99);
    expect(r.raison).toBeUndefined();
  });
  it("souvenir cap avec projectId du post", async () => {
    const d = faire();
    await refuserPost(d, entree);
    expect(d.souvenir.userId).toBe("u1");
    expect(d.souvenir.projectId).toBe(5);
    expect(d.souvenir.texte).toBe("Post refusé (linkedin, trust) « Mon post » — pas le bon ton : trop institutionnel");
  });
  it("le remplacement est créé avec autoPost: false (sécurité)", async () => {
    const d = faire();
    await refuserPost(d, entree);
    expect(d.cree.autoPost).toBe(false);
    // Même si le post refusé avait l'auto-publication activée.
    expect(d.cree.postStatus).toBe("pending");
    expect(d.cree.status).toBe("draft");
    expect(d.cree.contentStatus).toBe("idea");
  });
  it("reprend les champs du post, titre et corps générés", async () => {
    const d = faire();
    await refuserPost(d, entree);
    expect(d.cree).toMatchObject({
      userId: "u1", projectId: 5, campaignId: 3, socialAccountId: 4, platform: "linkedin", contentType: "text",
      pillar: "trust", goal: "awareness", intent: "awareness", postFormat: "text",
      title: remp.title, body: remp.body,
    });
    expect(d.cree.scheduledFor).toEqual(new Date("2026-10-08T09:00:00Z"));
    expect(d.cree).not.toHaveProperty("id");
    expect(d.cree).not.toHaveProperty("publishedAt");
  });
  it("génération reçoit post, raison, explication", async () => {
    const d = faire();
    await refuserPost(d, entree);
    expect(d.genInput).toMatchObject({ userId: "u1", raison: "wrong_tone", explication: "trop institutionnel" });
    expect(d.genInput.post).toMatchObject({ projectId: 5, platform: "linkedin", title: "Mon post" });
  });
  it("remplacer=false : aucun appel IA, ni création, suppression faite", async () => {
    const d = faire();
    const r = await refuserPost(d, { ...entree, remplacer: false });
    expect(d.j).toEqual(["neutralise:10", "souvenir", "suppr:10"]);
    expect(r).toEqual({ statut: "refuse", remplacement: null });
  });
  it("échec génération : suppression + generation_failed", async () => {
    const d = faire({ generer: async () => null });
    expect(await refuserPost(d, entree)).toEqual({ statut: "refuse", remplacement: null, raison: "generation_failed" });
    expect(d.j).toEqual(["neutralise:10", "souvenir", "suppr:10"]);
  });
  it("génération qui lève : suppression + generation_failed", async () => {
    const d = faire({ generer: async () => { throw new Error("x"); } });
    expect(await refuserPost(d, entree)).toEqual({ statut: "refuse", remplacement: null, raison: "generation_failed" });
    expect(d.j).toContain("souvenir");
  });
  it("échec création : suppression + generation_failed", async () => {
    const d = faire({ creerPost: async () => { throw new Error("x"); } });
    expect(await refuserPost(d, entree)).toEqual({ statut: "refuse", remplacement: null, raison: "generation_failed" });
    expect(d.j).toContain("suppr:10");
  });
  it("échec souvenir non bloquant", async () => {
    const d = faire({ ecrireSouvenir: async () => { throw new Error("x"); } });
    const r: any = await refuserPost(d, entree);
    expect(r.remplacement.id).toBe(99);
    expect(d.j).toContain("suppr:10");
  });
  it("échec suppression non bloquant", async () => {
    const d = faire({ supprimerPost: async () => { throw new Error("x"); } });
    const r: any = await refuserPost(d, entree);
    expect(r.statut).toBe("refuse");
    expect(r.remplacement.id).toBe(99);
  });
  it("explication vide + other : aucun souvenir", async () => {
    const d = faire();
    await refuserPost(d, { ...entree, raison: "other", explication: null });
    expect(d.j).not.toContain("souvenir");
    expect(d.j).toContain("suppr:10");
  });
  it("raison précise sans explication : souvenir écrit", async () => {
    const d = faire();
    await refuserPost(d, { ...entree, raison: "too_many", explication: null });
    expect(d.souvenir.texte).toBe("Post refusé (linkedin, trust) « Mon post » — trop de posts");
  });
  it("post sans projet : souvenir projectId null, remplacement sans projet", async () => {
    const d = faire({}, post({ projectId: null, campaignId: null }));
    await refuserPost(d, entree);
    expect(d.souvenir.projectId).toBeNull();
    expect(d.cree.projectId).toBeNull();
    expect(d.cree.campaignId).toBeNull();
  });
  it("neutralisation avant génération et avant suppression", async () => {
    const d = faire();
    await refuserPost(d, entree);
    expect(d.j.indexOf("neutralise:10")).toBeLessThan(d.j.indexOf("generer"));
    expect(d.j.indexOf("neutralise:10")).toBeLessThan(d.j.indexOf("suppr:10"));
  });
  it("pas de neutralisation si introuvable ou déjà publié", async () => {
    const a = faire({}, null);
    await refuserPost(a, entree);
    const b = faire({}, post({ postStatus: "processing" }));
    await refuserPost(b, entree);
    expect(a.j).toEqual([]);
    expect(b.j).toEqual([]);
  });
  it("échec de neutralisation non bloquant", async () => {
    const d = faire({ neutraliserPost: async () => { throw new Error("x"); } });
    const r: any = await refuserPost(d, entree);
    expect(r.remplacement.id).toBe(99);
  });
});
