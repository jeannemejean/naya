// Les posts de la corbeille ne comptent ni comme mouvement du fil, ni dans l'indicateur
// « posts publiés » d'un compte. Base simulée : on lit le SQL généré.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const h = vi.hoisted(() => ({ wheres: [] as any[] }));
vi.mock("../../db", () => {
  const chaine = (): any => {
    const suite: any = {
      from: () => suite, innerJoin: () => suite, leftJoin: () => suite, orderBy: () => suite, limit: () => suite, groupBy: () => suite,
      where: (w: any) => { h.wheres.push(w); return suite; },
      then: (ok: any, ko: any) => Promise.resolve([]).then(ok, ko),
    };
    return suite;
  };
  return { db: { select: () => chaine() }, pool: { query: vi.fn(), on: vi.fn() } };
});

const { sourcesParDefaut } = await import("./mouvements");
const { sourcesIndicateurs } = await import("./indicateurs-deps");
const sqlDe = (w: any) => new PgDialect().sqlToQuery(w).sql;
beforeEach(() => { h.wheres = []; });

describe("corbeille — sources du fil", () => {
  it("mouvements : un post publié puis mis à la corbeille ne compte pas", async () => {
    await sourcesParDefaut.contenusPublies("u1", new Date());
    expect(sqlDe(h.wheres[0])).toContain('"content"."supprime_le" is null');
  });
  it("indicateurs : posts publiés d'un compte hors corbeille", async () => {
    await sourcesIndicateurs.postsPublies("u1", 3, new Date());
    expect(sqlDe(h.wheres[0])).toContain('"content"."supprime_le" is null');
  });
});
