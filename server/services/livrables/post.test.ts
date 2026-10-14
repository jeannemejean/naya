import { describe, it, expect, vi } from "vitest";
import { nourrirLePost, nouvelOrdreMedias, type PostDeps } from "./post";

function deps(post: any): PostDeps & { majPost: ReturnType<typeof vi.fn> } {
  return { lirePost: vi.fn().mockResolvedValue(post), majPost: vi.fn().mockResolvedValue({}), ajouterMedia: vi.fn().mockResolvedValue({}) } as any;
}

describe("nourrirLePost", () => {
  it("le texte déposé sur « Rédiger le texte » devient le texte du post", async () => {
    const d = deps({ id: 9, postStatus: "pending", mediaIds: [] });
    const r = await nourrirLePost(d, {
      userId: "u", tache: { title: "Rédiger le texte — Coulisses", contentId: 9 },
      livrable: { kind: "texte", content: "  Mon texte  " },
    });
    // Brouillon : c'est le texte de l'utilisatrice, l'atelier ne le fera pas réécrire par Naya.
    expect(d.majPost).toHaveBeenCalledWith(9, { body: "Mon texte", contentStatus: "draft" });
    expect(r).toEqual({ contentId: 9, texte: true });
  });

  it("la photo déposée sur « Préparer le visuel » est ajoutée aux médias du post, en une écriture atomique", async () => {
    const d = deps({ id: 9, postStatus: "pending", mediaIds: [3] });
    const r = await nourrirLePost(d, { userId: "u", tache: { title: "Préparer le visuel — X", contentId: 9 }, livrable: { kind: "media", mediaId: 5 } });
    // Pas de lecture-puis-écriture de la liste : cinq slides déposées d'un coup arrivent en
    // parallèle, et l'une écrasait l'autre (un visuel perdu en prod).
    expect((d as any).ajouterMedia).toHaveBeenCalledWith(9, 5);
    expect(d.majPost).not.toHaveBeenCalled();
    expect(r).toEqual({ contentId: 9, media: true });
  });

  it("ne touche pas au post : tâche sans post, étape intermédiaire, mauvais type", async () => {
    const d = deps({ id: 9, postStatus: "pending" });
    expect(await nourrirLePost(d, { userId: "u", tache: { title: "Rédiger le texte — X", contentId: null }, livrable: { kind: "texte", content: "a" } })).toBeNull();
    expect(await nourrirLePost(d, { userId: "u", tache: { title: "Écrire le script — X", contentId: 9 }, livrable: { kind: "texte", content: "a" } })).toBeNull();
    expect(await nourrirLePost(d, { userId: "u", tache: { title: "Préparer le visuel — X", contentId: 9 }, livrable: { kind: "texte", content: "a" } })).toBeNull();
    expect(await nourrirLePost(d, { userId: "u", tache: { title: "Rédiger le texte — X", contentId: 9 }, livrable: { kind: "lien", content: "a" } })).toBeNull();
    expect(d.majPost).not.toHaveBeenCalled();
  });

  it("ne modifie jamais un post publié ou introuvable (autre compte)", async () => {
    const publie = deps({ id: 9, postStatus: "posted" });
    expect(await nourrirLePost(publie, { userId: "u", tache: { title: "Publier — X", contentId: 9 }, livrable: { kind: "texte", content: "a" } })).toBeNull();
    expect(publie.majPost).not.toHaveBeenCalled();
    const absent = deps(undefined);
    expect(await nourrirLePost(absent, { userId: "u", tache: { title: "Publier — X", contentId: 9 }, livrable: { kind: "texte", content: "a" } })).toBeNull();
  });

  it("ne modifie jamais un post validé ou programmé (il partirait autrement que validé)", async () => {
    for (const post of [{ id: 9, postStatus: "pending", contentStatus: "ready" }, { id: 9, postStatus: "pending", autoPost: true }]) {
      const d = deps(post);
      expect(await nourrirLePost(d, { userId: "u", tache: { title: "Monter — X", contentId: 9 }, livrable: { kind: "media", mediaId: 5 } })).toBeNull();
      expect(await nourrirLePost(d, { userId: "u", tache: { title: "Rédiger le texte — X", contentId: 9 }, livrable: { kind: "texte", content: "a" } })).toBeNull();
      expect((d as any).ajouterMedia).not.toHaveBeenCalled();
      expect(d.majPost).not.toHaveBeenCalled();
    }
  });

  it("un échec d'écriture ne lève pas", async () => {
    const d: PostDeps = { lirePost: vi.fn().mockResolvedValue({ id: 9, postStatus: "pending" }), majPost: vi.fn().mockRejectedValue(new Error("db")), ajouterMedia: vi.fn() };
    expect(await nourrirLePost(d, { userId: "u", tache: { title: "Rédiger le texte — X", contentId: 9 }, livrable: { kind: "texte", content: "a" } })).toBeNull();
  });
});

describe("nouvelOrdreMedias", () => {
  it("applique l'ordre demandé", () => {
    expect(nouvelOrdreMedias([5, 6, 7], [7, 5, 6])).toEqual([7, 5, 6]);
  });
  it("ignore les ids inconnus ou en double, garde les visuels arrivés entre-temps", () => {
    expect(nouvelOrdreMedias([5, 6, 7, 8], [6, 99, 5, 6])).toEqual([6, 5, 7, 8]);
    expect(nouvelOrdreMedias([5, 6], ["6", "5"])).toEqual([6, 5]);
  });
});
