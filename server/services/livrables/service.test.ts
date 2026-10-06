// server/services/livrables/service.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Livrable } from "@shared/schema";
import {
  creerLivrable, modifierLivrable, supprimerLivrable, rattraperMemoire,
  type LivrablesDeps,
} from "./service";

function fakeDeps(over: Partial<LivrablesDeps> = {}) {
  const rows = new Map<number, Livrable>();
  let nextId = 1;
  let nextMem = 100;
  const deps: LivrablesDeps = {
    inserer: vi.fn(async (row) => {
      const l = { id: nextId++, createdAt: new Date(), updatedAt: new Date(), ...row } as Livrable;
      rows.set(l.id, l);
      return l;
    }),
    maj: vi.fn(async (id, userId, patch) => {
      const l = rows.get(id);
      if (!l || l.userId !== userId) return null;
      const n = { ...l, ...patch } as Livrable;
      rows.set(id, n);
      return n;
    }),
    lire: vi.fn(async (id, userId) => {
      const l = rows.get(id);
      return l && l.userId === userId ? l : undefined;
    }),
    supprimer: vi.fn(async (id, userId) => {
      const l = rows.get(id);
      if (!l || l.userId !== userId) return false;
      rows.delete(id);
      return true;
    }),
    creerMedia: vi.fn(async () => ({ id: 42 })),
    majMediaAlt: vi.fn(async () => {}),
    supprimerMedia: vi.fn(async () => {}),
    mediaReferenceParUnContenu: vi.fn(async () => false),
    deposerMemoire: vi.fn(async () => ({ morceaux: 1, ids: [nextMem++] })),
    perimerMemoire: vi.fn(async () => {}),
    supprimerObjetPublic: vi.fn(async () => {}),
    supprimerObjetPrive: vi.fn(async () => {}),
    ...over,
  };
  return { deps, rows };
}

// Les échecs de dépôt mémoire sont attendus dans ces tests : on coupe le bruit console.
beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

const base = { userId: "u1", taskId: 7, taskTitle: "Photographier 3 détails", projectId: 3 };

describe("creerLivrable", () => {
  it("photo décrite → médiathèque (alt, projet, dossier livrables) + mémoire", async () => {
    const { deps } = fakeDeps();
    const l = await creerLivrable(deps, {
      ...base, kind: "media", content: "Lumière du matin",
      url: "https://media.x/a.jpg", fileName: "a.jpg", mimeType: "image/jpeg", size: 1000,
    });
    expect(deps.creerMedia).toHaveBeenCalledWith(expect.objectContaining({
      userId: "u1", url: "https://media.x/a.jpg", alt: "Lumière du matin", projectId: 3, folder: "livrables",
      mimeType: "image/jpeg", originalName: "a.jpg", size: 1000,
    }));
    expect(deps.deposerMemoire).toHaveBeenCalledWith({
      userId: "u1", projectId: 3, titre: "Livrable : Photographier 3 détails", contenu: "Lumière du matin",
    });
    expect(l.mediaId).toBe(42);
    expect(l.memoryEntryIds).toEqual([100]);
    expect(l.memoirePending).toBe(false);
  });

  it("lien sans note → ni médiathèque ni mémoire", async () => {
    const { deps } = fakeDeps();
    await creerLivrable(deps, { ...base, kind: "lien", url: "https://x.fr", content: null });
    expect(deps.creerMedia).not.toHaveBeenCalled();
    expect(deps.deposerMemoire).not.toHaveBeenCalled();
  });

  it("fichier → jamais en médiathèque", async () => {
    const { deps } = fakeDeps();
    await creerLivrable(deps, { ...base, kind: "fichier", url: "livrables/u1/k.pdf", content: "Devis", fileName: "d.pdf", mimeType: "application/pdf", size: 10 });
    expect(deps.creerMedia).not.toHaveBeenCalled();
    expect(deps.deposerMemoire).toHaveBeenCalled();
  });

  it("mémoire en échec → livrable créé quand même, en attente", async () => {
    const { deps } = fakeDeps({ deposerMemoire: vi.fn(async () => { throw new Error("db down"); }) });
    const l = await creerLivrable(deps, { ...base, kind: "texte", content: "Mon pitch" });
    expect(l.memoirePending).toBe(true);
    expect(l.memoryEntryIds).toEqual([]);
  });

  it("mémoire sans aucun souvenir écrit → en attente", async () => {
    const { deps } = fakeDeps({ deposerMemoire: vi.fn(async () => ({ morceaux: 1, ids: [] })) });
    const l = await creerLivrable(deps, { ...base, kind: "texte", content: "Mon pitch" });
    expect(l.memoirePending).toBe(true);
  });
});

describe("modifierLivrable", () => {
  it("périme les anciens souvenirs puis redépose", async () => {
    const { deps } = fakeDeps();
    const l = await creerLivrable(deps, { ...base, kind: "texte", content: "v1" });
    const m = await modifierLivrable(deps, l.id, "u1", "v2");
    expect(deps.perimerMemoire).toHaveBeenCalledWith("u1", [100]);
    expect(m?.content).toBe("v2");
    expect(m?.memoryEntryIds).toEqual([101]);
  });

  it("même texte → ne touche pas à la mémoire", async () => {
    const { deps } = fakeDeps();
    const l = await creerLivrable(deps, { ...base, kind: "texte", content: "v1" });
    await modifierLivrable(deps, l.id, "u1", "  v1 ");
    expect(deps.perimerMemoire).not.toHaveBeenCalled();
    expect(deps.deposerMemoire).toHaveBeenCalledTimes(1);
  });

  it("met à jour l'alt du média", async () => {
    const { deps } = fakeDeps();
    const l = await creerLivrable(deps, { ...base, kind: "media", content: "v1", url: "https://m/a.jpg", fileName: "a.jpg", mimeType: "image/jpeg", size: 1 });
    await modifierLivrable(deps, l.id, "u1", "v2");
    expect(deps.majMediaAlt).toHaveBeenCalledWith(42, "u1", "v2");
  });

  it("livrable d'un autre compte → null, rien touché", async () => {
    const { deps } = fakeDeps();
    const l = await creerLivrable(deps, { ...base, kind: "texte", content: "v1" });
    expect(await modifierLivrable(deps, l.id, "intrus", "v2")).toBeNull();
    expect(deps.perimerMemoire).not.toHaveBeenCalled();
  });
});

describe("supprimerLivrable", () => {
  it("périme les souvenirs, supprime média et objet s'ils ne servent à aucun contenu", async () => {
    const { deps } = fakeDeps();
    const l = await creerLivrable(deps, { ...base, kind: "media", content: "x", url: "https://m/a.jpg", fileName: "a.jpg", mimeType: "image/jpeg", size: 1 });
    expect(await supprimerLivrable(deps, l.id, "u1")).toBe(true);
    expect(deps.perimerMemoire).toHaveBeenCalledWith("u1", [100]);
    expect(deps.supprimerMedia).toHaveBeenCalledWith(42, "u1");
    expect(deps.supprimerObjetPublic).toHaveBeenCalledWith("u1", "https://m/a.jpg");
  });

  it("garde le média et l'objet s'ils sont utilisés par un post", async () => {
    const { deps } = fakeDeps({ mediaReferenceParUnContenu: vi.fn(async () => true) });
    const l = await creerLivrable(deps, { ...base, kind: "media", content: "x", url: "https://m/a.jpg", fileName: "a.jpg", mimeType: "image/jpeg", size: 1 });
    await supprimerLivrable(deps, l.id, "u1");
    expect(deps.supprimerMedia).not.toHaveBeenCalled();
    expect(deps.supprimerObjetPublic).not.toHaveBeenCalled();
  });

  it("fichier → objet privé supprimé", async () => {
    const { deps } = fakeDeps();
    const l = await creerLivrable(deps, { ...base, kind: "fichier", url: "livrables/u1/k.pdf", content: null, fileName: "d.pdf", mimeType: "application/pdf", size: 1 });
    await supprimerLivrable(deps, l.id, "u1");
    expect(deps.supprimerObjetPrive).toHaveBeenCalledWith("u1", "livrables/u1/k.pdf");
  });

  it("livrable d'un autre compte → false, rien supprimé", async () => {
    const { deps } = fakeDeps();
    const l = await creerLivrable(deps, { ...base, kind: "texte", content: "x" });
    expect(await supprimerLivrable(deps, l.id, "intrus")).toBe(false);
    expect(deps.perimerMemoire).not.toHaveBeenCalled();
  });
});

describe("rattraperMemoire", () => {
  it("redépose les livrables en attente, même si la tâche a disparu", async () => {
    const { deps } = fakeDeps({ deposerMemoire: vi.fn(async () => { throw new Error("down"); }) });
    const l = await creerLivrable(deps, { ...base, kind: "texte", content: "Mon pitch" });
    const orphelin = { ...l, taskId: null } as Livrable;
    deps.deposerMemoire = vi.fn(async () => ({ morceaux: 1, ids: [555] }));
    await rattraperMemoire(deps, [orphelin]);
    expect(deps.deposerMemoire).toHaveBeenCalledWith(expect.objectContaining({ titre: "Livrable : Photographier 3 détails" }));
    expect(deps.maj).toHaveBeenLastCalledWith(l.id, "u1", { memoryEntryIds: [555], memoirePending: false });
  });

  it("ignore les livrables qui ne sont pas en attente, et ne lève jamais", async () => {
    const { deps } = fakeDeps();
    const l = await creerLivrable(deps, { ...base, kind: "texte", content: "ok" });
    deps.deposerMemoire = vi.fn(async () => { throw new Error("down"); });
    await expect(rattraperMemoire(deps, [l, { ...l, id: 99, memoirePending: true } as Livrable])).resolves.toBeUndefined();
    expect(deps.deposerMemoire).toHaveBeenCalledTimes(1);
  });
});
