// Corbeille côté stockage : un post supprimé (supprime_le non nul) sort des listes, et surtout
// ne part JAMAIS — ni lu comme « dû » par le worker, ni pris par le claim. Base simulée : on
// lit le SQL généré, aucune connexion.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { getTableName } from "drizzle-orm";

const h = vi.hoisted(() => ({ appels: [] as any[], resultats: [] as any[][] }));
vi.mock("./db", () => {
  const chaine = (genre: string, table?: any) => {
    const appel: any = { genre, table: table ? getTableName(table) : undefined };
    h.appels.push(appel);
    const suite: any = {
      from: (t: any) => { appel.table = getTableName(t); return suite; },
      set: (v: any) => { appel.set = v; return suite; },
      where: (w: any) => { appel.where = w; return suite; },
      orderBy: () => suite, limit: () => suite, for: () => suite, returning: () => suite,
      then: (ok: any, ko: any) => Promise.resolve(h.resultats.shift() ?? []).then(ok, ko),
    };
    return suite;
  };
  const db: any = {
    select: () => chaine("select"),
    update: (t: any) => chaine("update", t),
    transaction: async (fn: any) => fn(db),
  };
  return { db, pool: { query: vi.fn(), on: vi.fn() } };
});

const { storage } = await import("./storage");
const sqlDe = (w: any) => new PgDialect().sqlToQuery(w).sql;
beforeEach(() => { h.appels = []; h.resultats = []; });

describe("corbeille — exclusion des posts supprimés", () => {
  it("le worker ne lit jamais un post de la corbeille comme dû", async () => {
    await storage.getDueScheduledContent(new Date());
    expect(sqlDe(h.appels[0].where)).toContain('"content"."supprime_le" is null');
  });

  it("le claim refuse un post de la corbeille (course : supprimé après la lecture)", async () => {
    await storage.claimContentForPosting(5);
    expect(h.appels[0].genre).toBe("update");
    expect(sqlDe(h.appels[0].where)).toContain('"content"."supprime_le" is null');
  });

  it("calendrier, statut, atelier, post seul : hors corbeille", async () => {
    await storage.getContent("u1", 50);
    await storage.getContentByStatus("u1", "draft");
    await storage.getPostsEntre("u1", new Date(), new Date());
    await storage.getContentById(3, "u1");
    for (const a of h.appels) expect(sqlDe(a.where)).toContain('"content"."supprime_le" is null');
  });

  it("le post « même supprimé » ne filtre pas la corbeille", async () => {
    await storage.getContentByIdMemeSupprime(3, "u1");
    expect(sqlDe(h.appels[0].where)).not.toContain("supprime_le");
  });

  it("mettre à la corbeille : déprogramme, jamais un post en cours d'envoi, archive ses tâches non faites", async () => {
    h.resultats = [[{ id: 3 }], []];
    expect(await storage.mettreALaCorbeille(3, "u1")).toBe(true);
    const [post, taches] = h.appels;
    expect(post.set).toMatchObject({ autoPost: false });
    expect(post.set.supprimeLe).toBeInstanceOf(Date);
    expect(sqlDe(post.where)).toContain("not in ('posting', 'processing', 'uploading')");
    expect(taches.table).toBe("tasks");
    expect(taches.set.archivedAt).toBe(post.set.supprimeLe);
  });

  it("rien mis à la corbeille → aucune tâche touchée", async () => {
    h.resultats = [[]];
    expect(await storage.mettreALaCorbeille(3, "u1")).toBe(false);
    expect(h.appels).toHaveLength(1);
  });

  it("restaurer ne ramène que les tâches archivées avec le post", async () => {
    const quand = new Date("2026-11-20T10:00:00Z");
    h.resultats = [[{ supprimeLe: quand }], [], []];
    expect(await storage.restaurerContenu(3, "u1")).toBe(true);
    const taches = h.appels[2];
    expect(taches.table).toBe("tasks");
    expect(taches.set).toEqual({ archivedAt: null });
    expect(new PgDialect().sqlToQuery(taches.where).params).toContain(quand.toISOString());
  });
});

describe("corbeille et téléphone — revue de branche", () => {
  it("le contenu issu d'une tâche ignore la corbeille (sinon le brouillon supprimé bloque la recréation)", async () => {
    await storage.getContentBySourceTask("u1", 9);
    expect(sqlDe(h.appels[0].where)).toContain('"content"."supprime_le" is null');
  });

  it("étiquetage : un post de la corbeille n'est ni à étiqueter ni compté", async () => {
    await storage.getContenusAEtiqueter("u1", 2, new Date(), 10);
    await storage.getContenusEtiquetes("u1", 2, new Date());
    for (const a of h.appels) expect(sqlDe(a.where)).toContain('"content"."supprime_le" is null');
  });

  it("le worker ne lit jamais un post « à finir sur le téléphone » comme dû", async () => {
    await storage.getDueScheduledContent(new Date());
    expect(sqlDe(h.appels[0].where)).toContain('"content"."finir_sur_telephone"');
  });
});
