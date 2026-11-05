// Mode test — requêtes de garde (adresse d'un vrai prospect, plafond de 5 tests / 24 h).
// Base simulée : on lit le SQL généré, aucune connexion.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const h = vi.hoisted(() => ({ appels: [] as any[], resultats: [] as any[][] }));
vi.mock("./db", () => {
  const chaine = () => {
    const appel: any = {};
    h.appels.push(appel);
    const suite: any = {
      from: () => suite,
      where: (w: any) => { appel.where = w; return suite; },
      limit: () => suite,
      then: (ok: any, ko: any) => Promise.resolve(h.resultats.shift() ?? []).then(ok, ko),
    };
    return suite;
  };
  return { db: { select: () => chaine() }, pool: { query: vi.fn(), on: vi.fn() } };
});

const { storage } = await import("./storage");
const q = (w: any) => new PgDialect().sqlToQuery(w);
beforeEach(() => { h.appels = []; h.resultats = []; });

describe("storage.adresseDeVraiProspect", () => {
  it("cherche l'adresse normalisée parmi les prospects NON test de l'utilisatrice (archivés compris)", async () => {
    h.resultats = [[{ id: 3 }]];
    expect(await storage.adresseDeVraiProspect("u1", "claire@exemple.fr")).toBe(true);
    const { sql, params } = q(h.appels[0].where);
    expect(sql).toContain("lower(regexp_replace(");
    expect(sql).toContain("not (coalesce(");
    expect(sql).toContain("@> array[");
    expect(sql).not.toContain("archived_at");
    expect(params).toEqual(expect.arrayContaining(["u1", "claire@exemple.fr", "naya_test"]));
  });
  it("aucune ligne : false", async () => {
    h.resultats = [[]];
    expect(await storage.adresseDeVraiProspect("u1", "x@y.fr")).toBe(false);
  });
});

describe("storage.compterLeadsTestDepuis", () => {
  it("compte les prospects test créés depuis l'instant donné", async () => {
    h.resultats = [[{ n: 4 }]];
    const depuis = new Date("2026-11-04T10:00:00Z");
    expect(await storage.compterLeadsTestDepuis("u1", depuis)).toBe(4);
    const { sql, params } = q(h.appels[0].where);
    expect(sql).toContain("@> array[");
    expect(sql).toContain("created_at");
    expect(sql).not.toContain("not (coalesce(");
    expect(params).toEqual(expect.arrayContaining(["u1", "naya_test"]));
  });
});
