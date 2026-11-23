// Le passage des autolistes, avec une fausse base en mémoire : créneaux posés, file, boucle,
// règles de « Programmer », anti-doublon, corbeille des posts à venir, consommation.
import { describe, it, expect, beforeEach } from "vitest";
import {
  materialiserAutoliste, materialiserTout, reconstruireAutoliste, retirerDeLaFile, supprimerAutoliste,
  type DepsMaterialiser, type ListeAutoliste, type PostAutoliste,
} from "./materialiser";
import { cleCreneau } from "@shared/autolistes";

const MAINTENANT = new Date("2026-11-23T07:00:00Z"); // lundi 8 h à Paris

const contenu = (n: number, extra: Record<string, unknown> = {}) => ({
  platform: "instagram", textes: { instagram: `IG ${n}`, linkedin: `LI ${n}` }, title: `Post ${n}`, mediaIds: [1],
  postFormat: "feed_image", contentType: "post", pillar: "p", goal: "g", ...extra,
});

function fausseBase(opts: { liste?: Partial<ListeAutoliste>; posts?: Array<Partial<PostAutoliste> & { id: number }>; comptes?: any[]; projets?: any[] } = {}) {
  const liste: ListeAutoliste = {
    id: 4, userId: "u1", projectId: null, nom: "Evergreen", actif: true, enBoucle: false, fuseau: "Europe/Paris",
    creneaux: [{ heure: "09:00", jours: [1, 3, 5] }], comptes: [30, 31], ...opts.liste,
  };
  const posts: PostAutoliste[] = (opts.posts ?? [{ id: 1 }, { id: 2 }]).map((p, i) => ({
    ordre: i, actif: true, contenu: contenu(p.id), publieFois: 0, dernierPassageAt: null, ...p,
  }));
  const comptes = opts.comptes ?? [
    { id: 30, platform: "instagram", projectId: null, isActive: true },
    { id: 31, platform: "linkedin", projectId: null, isActive: true },
  ];
  const projets = opts.projets ?? [];
  const contenus: any[] = [];
  const journal: Array<[number, string]> = [];
  const etat = { liste, posts, contenus, journal, problemes: [] as any[] };
  let n = 100;
  const deps: DepsMaterialiser = {
    maintenant: () => MAINTENANT,
    listesActives: async () => (etat.liste.actif ? [etat.liste] : []),
    liste: async (userId, id) => (userId === etat.liste.userId && id === etat.liste.id ? { ...etat.liste } : undefined),
    posts: async () => etat.posts.map((p) => ({ ...p })),
    materialisations: async (userId, _id, depuis) => etat.contenus.filter((c) => c.userId === userId && (
      (c.autolisteCreneau && c.autolisteCreneau >= depuis) || (!c.supprimeLe && !c.publishedAt && !["posted", "failed"].includes(c.postStatus))
    )),
    publies: async (userId) => etat.contenus.filter((c) => c.userId === userId && c.publishedAt),
    majPost: async (_l, id, maj) => { Object.assign(etat.posts.find((p) => p.id === id)!, maj); },
    projet: async (id, userId) => projets.find((p) => p.id === id && userId === "u1"),
    comptes: async () => comptes,
    medias: async (_u, ids) => ids.map((id) => ({ id, url: `m${id}.jpg`, mimeType: "image/jpeg" })),
    creerContenu: async (row) => {
      const cle = cleCreneau(row.autolisteId, row.autolisteCreneau, row.socialAccountId);
      if (etat.contenus.some((c) => c.autolisteCreneau && cleCreneau(c.autolisteId, c.autolisteCreneau, c.socialAccountId) === cle)) return null;
      const c = { ...row, id: ++n, supprimeLe: null };
      etat.contenus.push(c);
      return { id: c.id };
    },
    journaliser: async (_u, id, ev) => { journal.push([id, ev]); },
    noterPassage: async (_u, _id, problemes) => { etat.problemes = problemes; },
    supprimerFuturs: async (userId, _id, apres, postId) => {
      const ids: number[] = [];
      for (const c of etat.contenus) {
        if (c.userId !== userId || c.supprimeLe || c.publishedAt || !["pending", "failed"].includes(c.postStatus)) continue;
        if (postId != null && c.autolistePostId !== postId) continue;
        if (!(c.scheduledFor > apres)) continue;
        c.supprimeLe = MAINTENANT; c.autolisteCreneau = null; c.autoPost = false;
        ids.push(c.id);
      }
      return ids;
    },
  };
  return { deps, etat };
}

const vivants = (contenus: any[]) => contenus.filter((c) => !c.supprimeLe);
/** Ce que lit le worker de publication (storage.getDueScheduledContent), hors fenêtre horaire. */
const publiable = (c: any) => c.autoPost === true && c.postStatus === "pending" && c.publishedAt == null && c.supprimeLe == null && c.scheduledFor instanceof Date;

describe("materialiserAutoliste", () => {
  let base: ReturnType<typeof fausseBase>;
  beforeEach(() => { base = fausseBase(); });

  it("sans boucle : chaque post une fois, sur chaque compte, en posts programmés que le worker publiera", async () => {
    const b = await materialiserAutoliste(base.deps, "u1", 4);
    // Lun 23 (9 h), mer 25, ven 27 : 2 posts sans boucle → 2 créneaux × 2 comptes, le 3e reste vide.
    expect(b?.poses).toBe(4);
    const rows = base.etat.contenus;
    expect(rows.map((r) => [r.scheduledFor.toISOString(), r.autolistePostId, r.socialAccountId, r.platform, r.body])).toEqual([
      ["2026-11-23T08:00:00.000Z", 1, 30, "instagram", "IG 1"], ["2026-11-23T08:00:00.000Z", 1, 31, "linkedin", "LI 1"],
      ["2026-11-25T08:00:00.000Z", 2, 30, "instagram", "IG 2"], ["2026-11-25T08:00:00.000Z", 2, 31, "linkedin", "LI 2"],
    ]);
    expect(rows.every(publiable)).toBe(true);
    expect(rows.every((r) => r.userId === "u1" && r.autolisteId === 4 && r.contentStatus === "ready")).toBe(true);
    expect(base.etat.journal.every(([, ev]) => ev === "cree")).toBe(true);
    expect(base.etat.problemes).toEqual([]);
  });

  it("ne pose jamais deux fois le même créneau (passage relancé)", async () => {
    await materialiserAutoliste(base.deps, "u1", 4);
    const b = await materialiserAutoliste(base.deps, "u1", 4);
    expect(b?.poses).toBe(0);
    expect(base.etat.contenus).toHaveLength(4);
  });

  it("en boucle : la file tourne (evergreen) et l'ordre gardé suit", async () => {
    base = fausseBase({ liste: { enBoucle: true, comptes: [31] } });
    await materialiserAutoliste(base.deps, "u1", 4);
    // Lun 23, mer 25, ven 27 (le lundi 30 à 9 h tombe après les 7 jours).
    expect(base.etat.contenus.map((r) => r.autolistePostId)).toEqual([1, 2, 1]);
    // Le post 1, posé en dernier, repart en fin de file : le 2 est le prochain.
    expect(base.etat.posts.sort((a, b) => a.ordre - b.ordre).map((p) => p.id)).toEqual([2, 1]);
    // Un passage plus tard : rien de neuf à poser, l'ordre ne bouge pas.
    await materialiserAutoliste(base.deps, "u1", 4);
    expect(base.etat.contenus).toHaveLength(3);
    expect(base.etat.posts.sort((a, b) => a.ordre - b.ordre).map((p) => p.id)).toEqual([2, 1]);
  });

  it("liste vide, liste inactive, liste d'une autre : rien", async () => {
    base = fausseBase({ posts: [] });
    expect((await materialiserAutoliste(base.deps, "u1", 4))?.poses).toBe(0);
    base = fausseBase({ liste: { actif: false } });
    expect((await materialiserAutoliste(base.deps, "u1", 4))?.poses).toBe(0);
    expect(await materialiserAutoliste(base.deps, "u2", 4)).toBeNull();
    expect(base.etat.contenus).toEqual([]);
  });

  it("les créneaux passés (ou dans la marge) ne sont pas posés", async () => {
    base = fausseBase({ liste: { creneaux: [{ heure: "08:01", jours: [1] }, { heure: "08:30", jours: [1] }], comptes: [31] } });
    await materialiserAutoliste(base.deps, "u1", 4);
    // 08:01 Paris = 07:01Z, dans la marge de 3 min → sauté ; 08:30 posé ; lundi suivant hors 7 jours.
    expect(base.etat.contenus.map((r) => r.scheduledFor.toISOString())).toEqual(["2026-11-23T07:30:00.000Z"]);
  });

  it("une ligne refusée par les règles de « Programmer » n'est pas créée ; la raison reste ; la file s'arrête", async () => {
    base = fausseBase({ posts: [{ id: 1, contenu: contenu(1, { mediaIds: [] }) }, { id: 2 }] });
    await materialiserAutoliste(base.deps, "u1", 4);
    // LinkedIn accepte un texte seul ; Instagram exige un visuel.
    expect(base.etat.contenus.map((r) => [r.autolistePostId, r.socialAccountId])).toEqual([[1, 31], [2, 30], [2, 31]]);
    expect(base.etat.problemes).toEqual([{ creneau: "2026-11-23T08:00:00.000Z", postId: 1, compteId: 30, raisons: ["visuel_requis"] }]);

    base = fausseBase({ posts: [{ id: 1, contenu: contenu(1, { mediaIds: [] }) }, { id: 2 }], liste: { comptes: [30] } });
    await materialiserAutoliste(base.deps, "u1", 4);
    expect(base.etat.contenus).toEqual([]);
    expect(base.etat.problemes.map((p: any) => p.postId)).toEqual([1]);
  });

  it("un compte hors du périmètre de la marque (projet client) est refusé, jamais remplacé", async () => {
    base = fausseBase({ liste: { projectId: 7, comptes: [30] }, projets: [{ id: 7, projectKind: "client" }] });
    await materialiserAutoliste(base.deps, "u1", 4);
    expect(base.etat.contenus).toEqual([]);
    expect(base.etat.problemes[0].raisons).toEqual(["compte_hors_projet"]);
  });

  it("aucun compte choisi : rien, et la liste le dit", async () => {
    base = fausseBase({ liste: { comptes: [] } });
    await materialiserAutoliste(base.deps, "u1", 4);
    expect(base.etat.contenus).toEqual([]);
    expect(base.etat.problemes[0].raisons).toEqual(["aucun_compte"]);
  });

  it("un post publié est compté ; sans boucle, il est consommé", async () => {
    base = fausseBase({ liste: { comptes: [31] } });
    await materialiserAutoliste(base.deps, "u1", 4);
    const premier = base.etat.contenus[0];
    Object.assign(premier, { publishedAt: new Date("2026-11-23T08:00:20Z"), postStatus: "posted" });
    await materialiserAutoliste(base.deps, "u1", 4);
    const p1 = base.etat.posts.find((p) => p.id === 1)!;
    expect(p1).toMatchObject({ publieFois: 1, actif: false });
    expect(p1.dernierPassageAt?.toISOString()).toBe("2026-11-23T08:00:20.000Z");
  });

  it("un post en échec libère son post (sans boucle), reposé au créneau libre suivant", async () => {
    base = fausseBase({ posts: [{ id: 1 }], liste: { comptes: [31] } });
    await materialiserAutoliste(base.deps, "u1", 4);
    expect(base.etat.contenus).toHaveLength(1);
    base.etat.contenus[0].postStatus = "failed";
    await materialiserAutoliste(base.deps, "u1", 4);
    expect(base.etat.contenus.map((r) => [r.autolistePostId, r.scheduledFor.toISOString()])).toEqual([
      [1, "2026-11-23T08:00:00.000Z"], [1, "2026-11-25T08:00:00.000Z"],
    ]);
  });

  it("un créneau retiré du calendrier par l'utilisatrice n'est pas reposé", async () => {
    base = fausseBase({ liste: { comptes: [31] } });
    await materialiserAutoliste(base.deps, "u1", 4);
    base.etat.contenus[0].supprimeLe = MAINTENANT; // corbeille du calendrier : le créneau reste pris
    await materialiserAutoliste(base.deps, "u1", 4);
    expect(vivants(base.etat.contenus).map((r) => r.scheduledFor.toISOString())).toEqual(["2026-11-25T08:00:00.000Z", "2026-11-27T08:00:00.000Z"]);
  });
});

describe("modifications", () => {
  it("reconstruire : les posts à venir partent à la corbeille, jamais les publiés ; la liste est reposée", async () => {
    const base = fausseBase({ liste: { comptes: [31] } });
    await materialiserAutoliste(base.deps, "u1", 4);
    Object.assign(base.etat.contenus[0], { scheduledFor: new Date("2026-11-23T06:00:00Z"), publishedAt: new Date(), postStatus: "posted" });
    base.etat.liste.creneaux = [{ heure: "18:00", jours: [2] }];
    await reconstruireAutoliste(base.deps, "u1", 4);
    const publie = base.etat.contenus[0];
    expect(publie.supprimeLe).toBeNull();
    expect(base.etat.contenus[1].supprimeLe).toEqual(MAINTENANT);
    expect(base.etat.contenus[1].autolisteCreneau).toBeNull();
    // Le post 1 a été publié (consommé) : le post 2 prend le nouveau créneau (mardi 18 h).
    expect(vivants(base.etat.contenus).slice(1).map((r) => [r.autolistePostId, r.scheduledFor.toISOString()])).toEqual([[2, "2026-11-24T17:00:00.000Z"]]);
    expect(base.etat.journal.some(([, ev]) => ev === "supprime")).toBe(true);
  });

  it("désactiver : plus rien d'à venir", async () => {
    const base = fausseBase();
    await materialiserAutoliste(base.deps, "u1", 4);
    base.etat.liste.actif = false;
    await reconstruireAutoliste(base.deps, "u1", 4);
    expect(vivants(base.etat.contenus)).toEqual([]);
  });

  it("retirer un post : ses posts à venir partent, le créneau passe au suivant", async () => {
    const base = fausseBase({ posts: [{ id: 1 }, { id: 2 }, { id: 3 }], liste: { comptes: [31] } });
    await materialiserAutoliste(base.deps, "u1", 4);
    const ok = await retirerDeLaFile(base.deps, "u1", 4, 1, async () => {
      base.etat.posts = base.etat.posts.filter((p) => p.id !== 1);
      return true;
    });
    expect(ok).toBe(true);
    expect(vivants(base.etat.contenus).map((r) => [r.autolistePostId, r.scheduledFor.toISOString()])).toEqual([
      [2, "2026-11-25T08:00:00.000Z"], [3, "2026-11-27T08:00:00.000Z"],
    ]);
    // Le créneau du lundi, libéré, reste vide : la file sans boucle est épuisée.
    expect(await retirerDeLaFile(base.deps, "u2", 4, 2, async () => true)).toBe(false);
  });

  it("supprimer la liste : ses posts à venir d'abord à la corbeille", async () => {
    const base = fausseBase();
    await materialiserAutoliste(base.deps, "u1", 4);
    let supprimee = false;
    expect(await supprimerAutoliste(base.deps, "u1", 4, async () => (supprimee = true))).toBe(true);
    expect(supprimee).toBe(true);
    expect(vivants(base.etat.contenus)).toEqual([]);
  });

  it("materialiserTout : chaque liste active", async () => {
    const base = fausseBase();
    expect(await materialiserTout(base.deps)).toEqual({ listes: 1, poses: 4, erreurs: 0 });
  });
});
