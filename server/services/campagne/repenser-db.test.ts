// Chaque écriture de « repenser » porte sur userId ET campaignId, dans UNE transaction.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const h = vi.hoisted(() => ({
  appels: [] as Array<{ op: string; table: string; where?: any; set?: any }>,
  transaction: vi.fn(),
  clearTaskReferences: vi.fn(),
  hors: vi.fn(),
}));

vi.mock("../../db", () => {
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
        then: (ok: any, ko: any) => Promise.resolve([{ id: 1 }, { id: 2 }]).then(ok, ko),
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
  return { db: { ...executeur("db"), transaction: h.transaction }, pool: {} };
});
vi.mock("../../storage", () => ({ storage: { clearTaskReferences: h.clearTaskReferences } }));

const { transactionRepenser, lecturesRepenser } = await import("./repenser-db");
const dialecte = new PgDialect();
const params = (w: any) => dialecte.sqlToQuery(w).params;

beforeEach(() => { h.appels = []; vi.clearAllMocks(); });

describe("repenser-db", () => {
  it("mise à jour et suppressions : une transaction, toutes scopées userId + campaignId", async () => {
    await transactionRepenser(async (ops) => {
      await ops.mettreAJourCampagne("u1", 7, { coreMessage: "m" } as any);
      await ops.supprimerTaches("u1", 7, [11, 12]);
      await ops.supprimerContenus("u1", 7, [3]);
    });
    expect(h.transaction).toHaveBeenCalledTimes(1);
    expect(h.appels.every((a) => a.op.startsWith("tx:"))).toBe(true);

    const maj = h.appels.find((a) => a.op === "tx:update" && a.table === "campaigns")!;
    expect(params(maj.where)).toEqual(expect.arrayContaining(["u1", 7]));
    expect(maj.set).toMatchObject({ coreMessage: "m" });
    expect(maj.set).not.toHaveProperty("name");

    const delTaches = h.appels.find((a) => a.op === "tx:delete" && a.table === "tasks")!;
    expect(params(delTaches.where)).toEqual(expect.arrayContaining(["u1", 7, 11, 12]));
    expect(h.clearTaskReferences).toHaveBeenCalledWith(expect.anything(), [11, 12]);

    // Les tâches gardées qui pointent vers un post supprimé sont détachées, pas supprimées.
    const detache = h.appels.find((a) => a.op === "tx:update" && a.table === "tasks")!;
    expect(detache.set).toEqual({ contentId: null });
    expect(params(detache.where)).toEqual(expect.arrayContaining(["u1", 3]));

    const delContenus = h.appels.find((a) => a.op === "tx:delete" && a.table === "content")!;
    expect(params(delContenus.where)).toEqual(expect.arrayContaining(["u1", 7, 3]));
  });

  it("listes vides : aucune requête", async () => {
    await transactionRepenser(async (ops) => {
      expect(await ops.supprimerTaches("u1", 7, [])).toBe(0);
      expect(await ops.supprimerContenus("u1", 7, [])).toBe(0);
    });
    expect(h.appels).toEqual([]);
    expect(h.clearTaskReferences).not.toHaveBeenCalled();
  });

  it("les lectures de l'aperçu sont scopées userId + campaignId", async () => {
    await lecturesRepenser.lireContenus("u1", 7);
    await lecturesRepenser.lireTaches("u1", 7);
    for (const a of h.appels) expect(params(a.where)).toEqual(["u1", 7]);
    expect(h.appels.map((a) => a.table)).toEqual(["content", "tasks"]);
  });
});
