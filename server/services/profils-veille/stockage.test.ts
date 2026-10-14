// server/services/profils-veille/stockage.test.ts — les conditions SQL qui portent une règle
// (écart de Jeanne, profil courant, profil archivé, banc d'évaluation, doublons) sont relues
// dans le SQL produit par Drizzle, sans base.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const h = vi.hoisted(() => ({
  appels: [] as Array<{ op: string; table: string; champs?: any; where?: any; set?: any; joins: any[]; conflit?: any; limit?: number }>,
  resultats: [] as any[][],
}));

vi.mock("../../db", () => {
  const nomTable = (t: any) => t?.[Symbol.for("drizzle:Name")] ?? "?";
  const chaine = (op: string, table: any, champs?: any) => {
    const appel: any = { op, table: nomTable(table), champs, joins: [] };
    h.appels.push(appel);
    const suite: any = {
      from: (t: any) => { appel.table = nomTable(t); return suite; },
      innerJoin: (t: any, c: any) => { appel.joins.push({ table: nomTable(t), on: c }); return suite; },
      leftJoin: (t: any, c: any) => { appel.joins.push({ table: nomTable(t), on: c }); return suite; },
      where: (w: any) => { appel.where = w; return suite; },
      orderBy: () => suite,
      limit: (n: number) => { appel.limit = n; return suite; },
      set: (v: any) => { appel.set = v; return suite; },
      values: (v: any) => { appel.values = v; return suite; },
      onConflictDoUpdate: (c: any) => { appel.conflit = c; return suite; },
      onConflictDoNothing: () => suite,
      returning: () => suite,
      then: (ok: any, ko: any) => Promise.resolve(h.resultats.shift() ?? []).then(ok, ko),
    };
    return suite;
  };
  return {
    db: {
      select: (champs?: any) => chaine("select", undefined, champs),
      selectDistinct: (champs?: any) => chaine("select", undefined, champs),
      update: (t: any) => chaine("update", t),
      insert: (t: any) => chaine("insert", t),
      delete: (t: any) => chaine("delete", t),
    },
  };
});

const { stockageProfils: s } = await import("./stockage");
const dialecte = new PgDialect();
const q = (w: any) => dialecte.sqlToQuery(w);

beforeEach(() => { h.appels = []; h.resultats = []; });

describe("tendances côté utilisatrice", () => {
  it("tendancesDuProjet : jamais une tendance écartée par Jeanne, seulement celles du profil courant (propose|confirme)", async () => {
    await s.tendancesDuProjet("u", 4);
    const [sel] = h.appels;
    const where = q(sel.where);
    expect(where.sql).toContain('"profil_tendances"."ecarte_par_jeanne" = $');
    expect(where.params).toContain(false);
    const ratt = sel.joins.find((j) => j.table === "profil_rattachements");
    expect(ratt).toBeTruthy();
    const on = q(ratt.on);
    expect(on.sql).toContain('"profil_rattachements"."project_id" = "tendances_projet"."project_id"');
    expect(on.sql).toContain('"profil_rattachements"."profil_id" = "profil_tendances"."profil_id"');
    expect(on.sql).toMatch(/"profil_rattachements"\."statut" in \(\$\d+, \$\d+\)/);
    expect(on.params).toEqual(expect.arrayContaining(["propose", "confirme"]));
  });
  it("tendanceProjet : une tendance écartée par Jeanne est introuvable", async () => {
    await s.tendanceProjet("u", 3);
    const where = q(h.appels[0].where);
    expect(where.sql).toContain('"profil_tendances"."ecarte_par_jeanne" = $');
    expect(where.params).toContain(false);
  });
  it("tendancesSemaineDuProfil : le statut est lu (les « en baisse » ne vont pas au tri)", async () => {
    await s.tendancesSemaineDuProfil(7, "2026-10-19");
    expect(Object.keys(h.appels[0].champs)).toContain("statut");
  });
  it("clesRecentes : lignes visibles (gardée, ou nouvelle/vue non expirée) ou utilisées il y a moins de 28 jours", async () => {
    h.resultats = [[{ cle: "instagram|carrousel|liste" }]];
    const maintenant = new Date("2026-10-19T07:00:00Z");
    expect(await s.clesRecentes(4, maintenant)).toEqual(new Set(["instagram|carrousel|liste"]));
    const where = q(h.appels[0].where);
    expect(where.sql).toContain('"tendances_projet"."project_id" = $');
    expect(where.sql).toContain('"tendances_projet"."expire_le" > $');
    expect(where.sql).toContain('"tendances_projet"."created_at" >= $');
    expect(where.params).toEqual(expect.arrayContaining([4, "garde", "nouveau", "vu", "utilise", maintenant.toISOString(), "2026-09-21T07:00:00.000Z"]));
  });
});

describe("changer de profil, refuser", () => {
  it("choisirProfil : un autre profil remet dernierTri à zéro (le tri du nouveau profil se fait), le même le garde", async () => {
    await s.choisirProfil("u", 4, 8);
    const set = h.appels[0].conflit.set;
    const r = q(set.dernierTri);
    expect(r.sql).toMatch(/case when "profil_rattachements"\."profil_id" = \$1 then "profil_rattachements"\."dernier_tri" else null end/i);
    expect(r.params).toEqual([8]);
  });
  it("refuserRattachement : statut refuse, profil exclu, dernierTri remis à zéro", async () => {
    h.resultats = [[{ id: 1, profilId: 7, exclus: [3] }]];
    await s.refuserRattachement("u", 4);
    const maj = h.appels[1];
    expect(maj.op).toBe("update");
    expect(maj.set).toMatchObject({ statut: "refuse", exclus: [3, 7], dernierTri: null });
  });
});

describe("profil archivé", () => {
  it("une proposition archivée libère ses projets en attente : refuse, profil exclu (rangés de nouveau le lendemain)", async () => {
    h.resultats = [
      [{ id: 12, statut: "archive" }],                       // update profils_veille returning
      [{ id: 50, exclus: [] }, { id: 51, exclus: [3] }],     // rattachements en attente de ce profil
    ];
    await s.majProfil(12, { statut: "archive" });
    const majs = h.appels.filter((a) => a.op === "update" && a.table === "profil_rattachements");
    expect(majs.map((m) => m.set)).toEqual([
      expect.objectContaining({ statut: "refuse", exclus: [12] }),
      expect.objectContaining({ statut: "refuse", exclus: [3, 12] }),
    ]);
    const lecture = h.appels.find((a) => a.op === "select" && a.table === "profil_rattachements")!;
    const w = q(lecture.where);
    expect(w.params).toEqual(expect.arrayContaining([12, "en_attente"]));
  });
  it("activer un profil : ses projets en attente deviennent rattachés (inchangé)", async () => {
    h.resultats = [[{ id: 12, statut: "actif" }]];
    await s.majProfil(12, { statut: "actif" });
    const maj = h.appels.find((a) => a.op === "update" && a.table === "profil_rattachements")!;
    expect(maj.set).toMatchObject({ statut: "propose" });
  });
});

describe("purge", () => {
  it("ne supprime jamais un post étiqueté (banc d'évaluation)", async () => {
    await s.purgerPosts(new Date("2026-10-19T00:00:00Z"));
    const del = h.appels.find((a) => a.op === "delete")!;
    const w = q(del.where);
    expect(w.sql).toMatch(/not exists \(select 1 from "profil_etiquettes" where "profil_etiquettes"\."post_id" = "profil_posts"\."id"\)/);
  });
});

describe("rattachement", () => {
  it("projetsARattacher rend tous les candidats (la sélection des 10 du tour se fait au planificateur)", async () => {
    const projets = Array.from({ length: 11 }, (_, i) => ({ id: i + 1, name: `P${i + 1}`, userId: "u" }));
    h.resultats = [projets, ...projets.flatMap(() => [[{ id: 1, updatedAt: null }], [], [{}]])];
    expect((await s.projetsARattacher(["u"])).length).toBe(11);
  });
});

describe("administration", () => {
  it("tendancesAdmin : plusieurs semaines à la fois", async () => {
    await s.tendancesAdmin(7, ["2026-10-12", "2026-10-19"]);
    const w = q(h.appels[0].where);
    expect(w.sql).toMatch(/"profil_tendances"\."semaine" in \(\$\d+, \$\d+\)/);
    expect(w.params).toEqual(expect.arrayContaining([7, "2026-10-12", "2026-10-19"]));
  });
});
