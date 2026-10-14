import { describe, it, expect, vi } from "vitest";
import { validerPost, devaliderPost } from "./validation";

const maintenant = new Date("2026-10-19T08:00:00Z");
const post = (over: any = {}) => ({
  id: 5, userId: "u", projectId: 9, campaignId: 3, title: "Mon post", body: "Le texte", platform: "linkedin",
  postFormat: "text", contentType: "post", scheduledFor: new Date("2026-10-22T07:00:00Z"),
  contentStatus: "draft", autoPost: false, consigne: "L'idée", postStatus: "pending", publishedAt: null, mediaIds: [], ...over,
});
const compte = { id: 40, platform: "linkedin", isActive: true, expiresAt: null };

function fabrique(p: any = post(), over: any = {}) {
  const ecrits: any[] = [];
  return {
    ecrits,
    lirePost: vi.fn(async () => p),
    majPost: vi.fn(async (_id: number, _u: string, patch: any) => { ecrits.push(patch); Object.assign(p, patch); return p; }),
    mediasDuPost: vi.fn(async () => [] as Array<"image" | "video">),
    compteDuPost: vi.fn(async () => compte as any),
    tachesDuPost: vi.fn(async () => [] as any[]),
    archiverTaches: vi.fn(async () => {}),
    creerTache: vi.fn(async (t: any) => ({ id: 900, ...t })),
    majTache: vi.fn(async () => {}),
    postsEntre: vi.fn(async () => [p]),
    tachesAtelier: vi.fn(async () => [] as any[]),
    cocherTaches: vi.fn(async () => {}),
    maintenant: () => maintenant,
    ...over,
  };
}

describe("validerPost", () => {
  it("compte connecté, rien ne manque : programmé (Naya publie seule) et validé", async () => {
    const deps = fabrique();
    const r = await validerPost(deps, "u", 5, {});
    expect(r).toEqual({ statut: "programme" });
    expect(deps.ecrits.at(-1)).toMatchObject({ autoPost: true, postStatus: "pending", contentStatus: "ready", socialAccountId: 40, platform: "linkedin", lastError: null });
    expect(deps.creerTache).not.toHaveBeenCalled();
  });

  it("les modifications envoyées sont enregistrées avant de valider", async () => {
    const deps = fabrique();
    await validerPost(deps, "u", 5, { body: "Nouveau texte", scheduledFor: "2026-10-23T08:00:00Z", postFormat: "feed_image" });
    expect(deps.ecrits[0]).toEqual({ body: "Nouveau texte", scheduledFor: new Date("2026-10-23T08:00:00Z"), postFormat: "feed_image" });
  });

  it("il manque un visuel : rien n'est programmé, les manques sont dits", async () => {
    const deps = fabrique(post({ postFormat: "feed_image" }));
    const r = await validerPost(deps, "u", 5, {});
    expect(r).toEqual({ statut: "manques", manques: ["visuel"] });
    expect(deps.ecrits.some((e) => e.autoPost === true || e.contentStatus === "ready")).toBe(false);
  });

  it("vidéo : sans vidéo, jamais programmée (même avec une image)", async () => {
    const deps = fabrique(post({ postFormat: "reel" }), { mediasDuPost: vi.fn(async () => ["image"]) });
    expect(await validerPost(deps, "u", 5, {})).toEqual({ statut: "manques", manques: ["video", "format_incoherent"] });
  });

  it("Instagram en texte seul : Instagram exige un visuel", async () => {
    const deps = fabrique(post({ platform: "instagram" }), { compteDuPost: vi.fn(async () => ({ ...compte, platform: "instagram" })) });
    expect(await validerPost(deps, "u", 5, {})).toEqual({ statut: "manques", manques: ["visuel"] });
  });

  it("date passée ou texte vide : manques", async () => {
    const deps = fabrique(post({ body: " ", scheduledFor: new Date("2026-10-19T07:00:00Z") }));
    expect(await validerPost(deps, "u", 5, {})).toEqual({ statut: "manques", manques: ["texte", "date"] });
  });

  it("sans compte connecté : validé quand même, non programmé, une tâche « Publier » de 5 min le jour J à l'heure du post", async () => {
    const deps = fabrique(post(), { compteDuPost: vi.fn(async () => null) });
    const r = await validerPost(deps, "u", 5, {});
    expect(r).toEqual({ statut: "a_publier_soi_meme" });
    expect(deps.ecrits.at(-1)).toMatchObject({ contentStatus: "ready", autoPost: false });
    expect(deps.creerTache).toHaveBeenCalledWith(expect.objectContaining({
      userId: "u", contentId: 5, title: "Publier — Mon post", estimatedDuration: 5, type: "content", taskType: "post_publish",
      scheduledDate: "2026-10-22", scheduledTime: "09:00", scheduledEndTime: "09:05", completed: false,
      actionData: expect.objectContaining({ postContent: "Le texte", platform: "linkedin" }),
    }));
  });

  it("sans compte, une tâche « Publier » existante non faite est réutilisée (pas de doublon)", async () => {
    const deps = fabrique(post(), {
      compteDuPost: vi.fn(async () => null),
      tachesDuPost: vi.fn(async () => [{ id: 31, title: "Publier — Mon post", completed: false, archivedAt: null }]),
    });
    await validerPost(deps, "u", 5, {});
    expect(deps.creerTache).not.toHaveBeenCalled();
    expect(deps.majTache).toHaveBeenCalledWith("u", 31, expect.objectContaining({ scheduledDate: "2026-10-22", scheduledTime: "09:00", estimatedDuration: 5 }));
    expect(deps.archiverTaches).not.toHaveBeenCalledWith("u", expect.arrayContaining([31]));
  });

  it("archive les anciennes étapes d'écran non faites du post ; garde Tourner, Monter et les étapes faites", async () => {
    const deps = fabrique(post(), {
      tachesDuPost: vi.fn(async () => [
        { id: 1, title: "Rédiger le texte — Mon post", completed: false, archivedAt: null },
        { id: 2, title: "Relire et valider le post — Mon post", completed: false, archivedAt: null },
        { id: 3, title: "Publier — Mon post", completed: false, archivedAt: null },
        { id: 4, title: "Tourner — Mon post", completed: false, archivedAt: null },
        { id: 5, title: "Préparer le visuel — Mon post", completed: true, archivedAt: null },
      ]),
    });
    await validerPost(deps, "u", 5, {});
    expect(deps.archiverTaches).toHaveBeenCalledWith("u", [1, 2, 3]);
  });

  it("dernier post de la semaine validé : les tâches d'atelier non faites de la semaine sont cochées", async () => {
    const autre = post({ id: 6, contentStatus: "ready" });
    const celui = post();
    const deps = fabrique(celui, {
      postsEntre: vi.fn(async () => [autre, celui]),
      tachesAtelier: vi.fn(async () => [{ id: 70, completed: false }, { id: 71, completed: true }, { id: 72, completed: false }]),
    });
    await validerPost(deps, "u", 5, {});
    expect(deps.tachesAtelier).toHaveBeenCalledWith("u", "2026-10-19");
    expect(deps.cocherTaches).toHaveBeenCalledWith("u", [70, 72]);
  });

  it("il reste un post à valider dans la semaine : rien n'est coché", async () => {
    const deps = fabrique(post(), {
      postsEntre: vi.fn(async () => [post({ id: 6, contentStatus: "draft" })]),
      tachesAtelier: vi.fn(async () => [{ id: 70, completed: false }]),
    });
    await validerPost(deps, "u", 5, {});
    expect(deps.cocherTaches).not.toHaveBeenCalled();
  });

  it("publié, en cours de publication, introuvable", async () => {
    expect((await validerPost(fabrique(post({ postStatus: "posted" })), "u", 5, {})).statut).toBe("deja_publie");
    expect((await validerPost(fabrique(post({ postStatus: "posting" })), "u", 5, {})).statut).toBe("en_cours");
    expect((await validerPost(fabrique(post(), { lirePost: vi.fn(async () => undefined) }), "u", 5, {})).statut).toBe("introuvable");
  });

  it("format inconnu ou date illisible : refusés", async () => {
    expect((await validerPost(fabrique(), "u", 5, { postFormat: "hologramme" })).statut).toBe("invalide");
    expect((await validerPost(fabrique(), "u", 5, { scheduledFor: "pas une date" })).statut).toBe("invalide");
  });
});

describe("validerPost — jamais la consigne, jamais un post déjà programmé", () => {
  it("un post encore « à rédiger » (son texte est la consigne) n'est jamais validé, même avec ce texte renvoyé", async () => {
    const p = post({ contentStatus: "idea", consigne: null, body: "Raconter le retour d'un client" });
    const deps = fabrique(p);
    expect(await validerPost(deps, "u", 5, { body: "Raconter le retour d'un client" })).toEqual({ statut: "manques", manques: ["redaction"] });
    expect(deps.ecrits).toEqual([]);
  });
  it("un post « à rédiger » dont l'utilisatrice a écrit le texte : c'est son texte, il est validé", async () => {
    const p = post({ contentStatus: "idea", consigne: null, body: "Raconter le retour d'un client" });
    const deps = fabrique(p);
    expect((await validerPost(deps, "u", 5, { body: "Mon vrai post." })).statut).toBe("programme");
    expect(deps.ecrits[0]).toMatchObject({ body: "Mon vrai post.", contentStatus: "draft", consigne: "Raconter le retour d'un client" });
  });
  it("un post déjà validé n'est ni modifié ni revalidé (on le dévalide d'abord)", async () => {
    const deps = fabrique(post({ contentStatus: "ready", autoPost: true }));
    expect(await validerPost(deps, "u", 5, { scheduledFor: "2026-10-19T07:00:00Z" })).toEqual({ statut: "deja_valide" });
    expect(deps.ecrits).toEqual([]);
  });
});

describe("devaliderPost", () => {
  it("remet le post en brouillon, annule la programmation et archive la tâche « Publier » de secours", async () => {
    const deps = fabrique(post({ contentStatus: "ready", autoPost: true }), {
      tachesDuPost: vi.fn(async () => [{ id: 31, title: "Publier — Mon post", completed: false, archivedAt: null }, { id: 4, title: "Tourner — Mon post", completed: false }]),
    });
    expect(await devaliderPost(deps, "u", 5)).toEqual({ statut: "brouillon" });
    expect(deps.ecrits.at(-1)).toEqual({ autoPost: false, postStatus: "pending", contentStatus: "draft" });
    expect(deps.archiverTaches).toHaveBeenCalledWith("u", [31]);
  });
  it("refuse un post publié ou en cours", async () => {
    expect((await devaliderPost(fabrique(post({ postStatus: "posted" })), "u", 5)).statut).toBe("deja_publie");
    expect((await devaliderPost(fabrique(post({ postStatus: "uploading" })), "u", 5)).statut).toBe("en_cours");
  });
});
