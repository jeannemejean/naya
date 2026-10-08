// `deleteCampaignContentItems` (/regenerate-content) : conditions de garde redites en SQL
// (mêmes que « repenser »), tâches détachées avant la suppression, une transaction, compte réel.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const h = vi.hoisted(() => ({
  appels: [] as Array<{ op: string; table: string; where?: any; set?: any; for?: string }>,
  resultats: [] as any[][],
  transaction: vi.fn(),
}));

vi.mock("./db", () => {
  const nomTable = (t: any) => t?.[Symbol.for("drizzle:Name")] ?? "?";
  const executeur = (marque: string) => {
    const chaine = (op: string, table: any) => {
      const appel: any = { op: `${marque}:${op}`, table: nomTable(table) };
      h.appels.push(appel);
      const suite: any = {
        from: (t: any) => { appel.table = nomTable(t); return suite; },
        set: (v: any) => { appel.set = v; return suite; },
        where: (w: any) => { appel.where = w; return suite; },
        returning: () => suite,
        for: (mode: string) => { appel.for = mode; return suite; },
        then: (ok: any, ko: any) => Promise.resolve(h.resultats.shift() ?? []).then(ok, ko),
      };
      return suite;
    };
    return {
      select: () => chaine("select", undefined),
      update: (t: any) => chaine("update", t),
      delete: (t: any) => chaine("delete", t),
    };
  };
  h.transaction.mockImplementation(async (fn: any) => fn(executeur("tx")));
  return { db: { ...executeur("db"), transaction: h.transaction }, pool: { query: vi.fn(), on: vi.fn() } };
});

const { storage } = await import("./storage");
const dialecte = new PgDialect();
const q = (w: any) => dialecte.sqlToQuery(w);

beforeEach(() => { h.appels = []; h.resultats = []; vi.clearAllMocks(); });

describe("storage.deleteCampaignContentItems", () => {
  it("relit les supprimables FOR UPDATE, détache tasks.content_id, supprime avec les gardes, rend le compte réel", async () => {
    h.resultats = [
      [{ id: 3 }],   // select : seul 3 est encore supprimable (4 a été pris par le publieur)
      [],            // select des tâches non faites reliées (aucune)
      [],            // update tasks (détache)
      [{ id: 3 }],   // delete returning
    ];
    const n = await storage.deleteCampaignContentItems(9, [3, 4], "u1");
    expect(n).toBe(1);
    expect(h.transaction).toHaveBeenCalledTimes(1);
    expect(h.appels.every((a) => a.op.startsWith("tx:"))).toBe(true);
    expect(h.appels.map((a) => `${a.op}:${a.table}`)).toEqual(["tx:select:content", "tx:select:tasks", "tx:update:tasks", "tx:delete:content"]);

    const [sel, , detache, del] = h.appels;
    expect(sel.for).toBe("update");
    for (const w of [sel.where, del.where]) {
      const r = q(w);
      expect(r.sql).toContain('"published_at" is null');
      expect(r.sql).toMatch(/lower\(trim\(coalesce\("content"\."post_status", ''\)\)\) not in/);
      expect(r.sql).toMatch(/lower\(trim\(coalesce\("content"\."content_status", ''\)\)\) <> 'published'/);
      expect(r.params).toEqual(expect.arrayContaining([9, "u1", "posted", "uploading", "processing", "posting"]));
    }
    expect(q(sel.where).params).toEqual(expect.arrayContaining([3, 4]));
    // Détachement et suppression : seulement ce qui part vraiment.
    expect(detache.set).toEqual({ contentId: null });
    expect(q(detache.where).params).toEqual([3]);
    expect(q(del.where).params).toContain(3);
    expect(q(del.where).params).not.toContain(4);
  });

  it("les tâches de production NON FAITES des posts qui partent partent avec eux ; les faites sont détachées", async () => {
    h.resultats = [
      [{ id: 3 }],             // select content FOR UPDATE
      [{ id: 70 }, { id: 71 }], // tâches non faites reliées au post 3
    ];
    await storage.deleteCampaignContentItems(9, [3], "u1");
    const ops = h.appels.map((a) => `${a.op}:${a.table}`);
    expect(ops[0]).toBe("tx:select:content");
    expect(ops[1]).toBe("tx:select:tasks");
    const selTaches = h.appels[1];
    const r = q(selTaches.where);
    expect(r.sql).toContain('"content_id" in');
    expect(r.sql).toContain('"completed" =');
    expect(r.params).toEqual(expect.arrayContaining([3, false]));
    const iDelTaches = ops.indexOf("tx:delete:tasks");
    expect(iDelTaches).toBeGreaterThan(1);
    expect(q(h.appels[iDelTaches].where).params).toEqual([70, 71]);
    // Les références des tâches (captures, messages, événements, espace de travail) sont
    // libérées avant leur suppression.
    expect(ops.slice(2, iDelTaches).length).toBeGreaterThanOrEqual(4);
    expect(ops.slice(iDelTaches + 1)).toEqual(["tx:update:tasks", "tx:delete:content"]);
  });

  it("plus rien de supprimable après relecture → 0, ni détachement ni suppression", async () => {
    h.resultats = [[]];
    expect(await storage.deleteCampaignContentItems(9, [3], "u1")).toBe(0);
    expect(h.appels.map((a) => a.op)).toEqual(["tx:select"]);
  });

  it("liste vide → 0, aucune requête", async () => {
    expect(await storage.deleteCampaignContentItems(9, [])).toBe(0);
    expect(h.appels).toEqual([]);
    expect(h.transaction).not.toHaveBeenCalled();
  });
});

// Un post supprimé emporte ses tâches de production non faites (sinon : tâches orphelines,
// ou erreur de clé étrangère `tasks.content_id`) ; les tâches faites restent, détachées.
describe("suppression de posts : tâches de production reliées", () => {
  it("deleteContent : tâches non faites supprimées, faites détachées, puis le post, en une transaction", async () => {
    h.resultats = [[{ id: 80 }]];
    await storage.deleteContent(5);
    expect(h.transaction).toHaveBeenCalledTimes(1);
    const ops = h.appels.map((a) => `${a.op}:${a.table}`);
    expect(ops[0]).toBe("tx:select:tasks");
    expect(q(h.appels[0].where).params).toEqual(expect.arrayContaining([5, false]));
    expect(ops).toContain("tx:delete:tasks");
    expect(ops.slice(-2)).toEqual(["tx:update:tasks", "tx:delete:content"]);
    expect(h.appels[h.appels.length - 2].set).toEqual({ contentId: null });
  });

  it("deleteContent sans tâche reliée : ni suppression de tâches ni références touchées", async () => {
    h.resultats = [[]];
    await storage.deleteContent(5);
    expect(h.appels.map((a) => `${a.op}:${a.table}`)).toEqual(["tx:select:tasks", "tx:update:tasks", "tx:delete:content"]);
  });

  it("deleteCampaignFutureContent (/pause) : libère les tâches des posts à venir avant de les supprimer", async () => {
    h.resultats = [
      [{ id: 3 }, { id: 4 }], // posts à venir
      [],                     // tâches non faites reliées
      [],                     // détache
      [{ id: 3 }, { id: 4 }], // delete returning
    ];
    const n = await storage.deleteCampaignFutureContent(9, "2026-10-08");
    expect(n).toBe(2);
    expect(h.appels.map((a) => `${a.op}:${a.table}`)).toEqual([
      "tx:select:content", "tx:select:tasks", "tx:update:tasks", "tx:delete:content",
    ]);
    expect(q(h.appels[1].where).params).toEqual(expect.arrayContaining([3, 4]));
  });

  it("deleteCampaignFutureContent sans post à venir : rien d'autre", async () => {
    h.resultats = [[]];
    expect(await storage.deleteCampaignFutureContent(9, "2026-10-08")).toBe(0);
    expect(h.appels.map((a) => a.op)).toEqual(["tx:select"]);
  });

  it("getTasksForContents : tâches de l'utilisatrice reliées à ces posts ; liste vide → aucune requête", async () => {
    expect(await storage.getTasksForContents("u1", [])).toEqual([]);
    expect(h.appels).toEqual([]);
    h.resultats = [[{ id: 1, contentId: 3 }]];
    expect(await storage.getTasksForContents("u1", [3, 4])).toEqual([{ id: 1, contentId: 3 }]);
    const r = q(h.appels[0].where);
    expect(h.appels[0].table).toBe("tasks");
    expect(r.params).toEqual(expect.arrayContaining(["u1", 3, 4]));
  });
});
