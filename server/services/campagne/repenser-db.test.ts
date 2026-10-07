// Chaque écriture de « repenser » porte sur userId ET campaignId, dans UNE transaction.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const h = vi.hoisted(() => ({
  appels: [] as Array<{ op: string; table: string; where?: any; set?: any }>,
  transaction: vi.fn(),
  clearTaskReferences: vi.fn(),
  resultats: [] as any[][],
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
  return { db: { ...executeur("db"), transaction: h.transaction }, pool: {} };
});
vi.mock("../../storage", () => ({ storage: { clearTaskReferences: h.clearTaskReferences } }));

const { transactionRepenser, lecturesRepenser } = await import("./repenser-db");
const dialecte = new PgDialect();
const params = (w: any) => dialecte.sqlToQuery(w).params;

const texte = (w: any) => dialecte.sqlToQuery(w).sql;

beforeEach(() => { h.appels = []; h.resultats = []; vi.clearAllMocks(); });

describe("repenser-db", () => {
  it("mise à jour et suppressions : une transaction, scopées, conditions de garde redites dans le SQL", async () => {
    h.resultats = [
      [{ id: 7 }],                 // update campaigns returning
      [{ id: 11 }],                // select tâches partantes (12 cochée entre-temps)
      [{ id: 11 }],                // delete tasks returning
      [{ id: 3 }],                 // select posts partants
      [],                          // update tasks (détache content_id)
      [{ id: 3 }],                 // delete content returning
    ];
    let r: any;
    await transactionRepenser(async (ops) => {
      await ops.mettreAJourCampagne("u1", 7, { coreMessage: "m" } as any);
      r = {
        taches: await ops.supprimerTaches("u1", 7, [11, 12]),
        contenus: await ops.supprimerContenus("u1", 7, [3, 4]),
      };
    });
    expect(h.transaction).toHaveBeenCalledTimes(1);
    expect(h.appels.every((a) => a.op.startsWith("tx:"))).toBe(true);
    // Comptes exacts : ceux du RETURNING, pas ceux demandés.
    expect(r).toEqual({ taches: 1, contenus: 1 });

    const maj = h.appels.find((a) => a.op === "tx:update" && a.table === "campaigns")!;
    expect(params(maj.where)).toEqual(expect.arrayContaining(["u1", 7]));
    expect(maj.set).toMatchObject({ coreMessage: "m" });
    expect(maj.set).not.toHaveProperty("name");

    const selTaches = h.appels.find((a) => a.op === "tx:select" && a.table === "tasks")!;
    expect(selTaches.for).toBe("update");
    expect(texte(selTaches.where)).toContain('"completed" is not true');
    const delTaches = h.appels.find((a) => a.op === "tx:delete" && a.table === "tasks")!;
    expect(params(delTaches.where)).toEqual(expect.arrayContaining(["u1", 7, 11]));
    expect(params(delTaches.where)).not.toContain(12);
    expect(texte(delTaches.where)).toContain('"completed" is not true');
    expect(h.clearTaskReferences).toHaveBeenCalledWith(expect.anything(), [11]);

    const selContenus = h.appels.find((a) => a.op === "tx:select" && a.table === "content")!;
    expect(selContenus.for).toBe("update");
    const delContenus = h.appels.find((a) => a.op === "tx:delete" && a.table === "content")!;
    expect(params(delContenus.where)).toEqual(expect.arrayContaining(["u1", 7, 3]));
    for (const w of [selContenus.where, delContenus.where]) {
      const q = dialecte.sqlToQuery(w);
      expect(q.sql).toContain('"published_at" is null');
      expect(q.sql).toMatch(/lower\(trim\(coalesce\("content"\."post_status", ''\)\)\) not in/);
      expect(q.sql).toMatch(/lower\(trim\(coalesce\("content"\."content_status", ''\)\)\) <> 'published'/);
      expect(q.params).toEqual(expect.arrayContaining(["posted", "uploading", "processing", "posting"]));
    }

    // Détache content_id seulement pour les posts qui partent vraiment.
    const detache = h.appels.find((a) => a.op === "tx:update" && a.table === "tasks")!;
    expect(detache.set).toEqual({ contentId: null });
    expect(params(detache.where)).toEqual(["u1", 3]);
  });

  it("rien ne reste supprimable après relecture : aucune suppression, aucun détachement", async () => {
    h.resultats = [[], []];
    await transactionRepenser(async (ops) => {
      expect(await ops.supprimerTaches("u1", 7, [11])).toBe(0);
      expect(await ops.supprimerContenus("u1", 7, [3])).toBe(0);
    });
    expect(h.appels.map((a) => a.op)).toEqual(["tx:select", "tx:select"]);
    expect(h.clearTaskReferences).not.toHaveBeenCalled();
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
