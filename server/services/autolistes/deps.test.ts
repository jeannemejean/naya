// Dépendances réelles des autolistes : le SQL généré (base simulée, aucune connexion).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const h = vi.hoisted(() => ({ appels: [] as any[], resultats: [] as any[][] }));
vi.mock("../../db", () => {
  const chaine = (genre: string) => {
    const appel: any = { genre };
    h.appels.push(appel);
    const suite: any = {
      from: () => suite, limit: () => suite, returning: () => suite, orderBy: () => suite,
      set: (v: any) => { appel.set = v; return suite; },
      where: (w: any) => { appel.where = w; return suite; },
      then: (ok: any, ko: any) => Promise.resolve(h.resultats.shift() ?? []).then(ok, ko),
    };
    return suite;
  };
  return { db: { select: () => chaine("select"), update: () => chaine("update") }, pool: { query: vi.fn(), on: vi.fn() } };
});
vi.mock("../../storage", () => ({ storage: { createTask: vi.fn(async (t: any) => ({ id: 1, ...t })) } }));
vi.mock("../gestion-posts/historique", () => ({ journaliser: vi.fn() }));

const { depsMaterialiser } = await import("./deps");
const sqlDe = (w: any) => new PgDialect().sqlToQuery(w).sql;
beforeEach(() => { h.appels = []; h.resultats = []; });

describe("depsMaterialiser", () => {
  it("supprimerFuturs ne touche jamais un post modifié dans le calendrier depuis sa pose", async () => {
    await depsMaterialiser.supprimerFuturs("u1", 4, new Date());
    const q = sqlDe(h.appels[0].where);
    expect(q).toContain('"content"."updated_at" <= "content"."created_at" + interval');
  });

  it("validationActive lit validation_projet (actif) de la marque", async () => {
    h.resultats = [[{ actif: true }]];
    expect(await depsMaterialiser.validationActive(7)).toBe(true);
    expect(await depsMaterialiser.validationActive(8)).toBe(false);
  });
});
