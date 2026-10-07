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
      [],            // update tasks (détache)
      [{ id: 3 }],   // delete returning
    ];
    const n = await storage.deleteCampaignContentItems(9, [3, 4], "u1");
    expect(n).toBe(1);
    expect(h.transaction).toHaveBeenCalledTimes(1);
    expect(h.appels.every((a) => a.op.startsWith("tx:"))).toBe(true);
    expect(h.appels.map((a) => `${a.op}:${a.table}`)).toEqual(["tx:select:content", "tx:update:tasks", "tx:delete:content"]);

    const [sel, detache, del] = h.appels;
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
