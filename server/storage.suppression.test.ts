// Suppression définitive + liste « ne plus contacter » côté stockage. Base simulée : on lit le
// SQL généré, aucune connexion (consigne projet).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { getTableName } from "drizzle-orm";

const h = vi.hoisted(() => ({
  appels: [] as any[],
  resultats: [] as any[][],
  transactions: 0,
  issues: [] as any[],
}));
vi.mock("./db", () => {
  const chaine = () => {
    const appel: any = {};
    h.appels.push(appel);
    const suite: any = {
      from: (t: any) => { appel.table = getTableName(t); return suite; },
      where: (w: any) => { appel.where = w; return suite; },
      innerJoin: () => suite,
      orderBy: () => suite,
      limit: () => suite,
      then: (ok: any, ko: any) => Promise.resolve(h.resultats.shift() ?? []).then(ok, ko),
    };
    return suite;
  };
  return {
    db: {
      select: () => chaine(),
      transaction: async (fn: any) => { h.transactions++; return fn({ marque: "tx" }); },
    },
    pool: { query: vi.fn(), on: vi.fn() },
  };
});
vi.mock("./services/prospection-suppression", async (orig) => ({
  ...(await orig<any>()),
  supprimerLeadDansTransaction: vi.fn(async (_tx: any, id: number) => {
    const issue = h.issues.shift();
    if (issue instanceof Error) throw issue;
    return issue ?? { ok: true, bloque: false, id };
  }),
}));

const { storage } = await import("./storage");
const { supprimerLeadDansTransaction } = await import("./services/prospection-suppression");
const q = (w: any) => new PgDialect().sqlToQuery(w);
beforeEach(() => { h.appels = []; h.resultats = []; h.transactions = 0; h.issues = []; vi.clearAllMocks(); });

describe("storage.deleteLeads", () => {
  it("une transaction PAR prospect, ids dédoublonnés, scopée à l'utilisatrice", async () => {
    const r = await storage.deleteLeads([4, 5, 4], "u1");
    expect(h.transactions).toBe(2);
    expect(supprimerLeadDansTransaction).toHaveBeenCalledWith({ marque: "tx" }, 4, "u1");
    expect(supprimerLeadDansTransaction).toHaveBeenCalledWith({ marque: "tx" }, 5, "u1");
    expect(r).toEqual({ supprimes: [4, 5], refuses: [], bloques: 0 });
  });

  it("ids qui ne sont pas à elle → refusés (introuvable), les siens supprimés", async () => {
    h.issues = [{ ok: false, raison: "introuvable" }, { ok: true, bloque: true }];
    const r = await storage.deleteLeads([99, 5], "u1");
    expect(r).toEqual({ supprimes: [5], refuses: [{ id: 99, raison: "introuvable" }], bloques: 1 });
  });

  it("transaction annulée (clé étrangère : réservation arrivée entre-temps) → ce prospect intact, les autres continuent", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.issues = [Object.assign(new Error("fk"), { code: "23503" }), Object.assign(new Error("boom"), {}), { ok: true, bloque: false }];
    const r = await storage.deleteLeads([1, 2, 3], "u1");
    expect(r.supprimes).toEqual([3]);
    expect(r.refuses).toEqual([{ id: 1, raison: "envoi_en_cours" }, { id: 2, raison: "erreur" }]);
  });
});

describe("storage.isLeadUnsubscribed — liste « ne plus contacter »", () => {
  it("personne bloquée (désinscrite puis supprimée) → true, sans même lire les séquences", async () => {
    h.resultats = [[{ email: " Marie@Ex.fr", linkedinProviderId: null, linkedinUrl: null }], [{ id: 1 }]];
    expect(await storage.isLeadUnsubscribed(7, "u1")).toBe(true);
    expect(h.appels).toHaveLength(2);
    expect(h.appels[1].table).toBe("prospects_bloques");
    const { sql, params } = q(h.appels[1].where);
    expect(sql).toContain(`"prospects_bloques"."user_id" = $1`);
    expect(params).toEqual(["u1", "marie@ex.fr"]);
  });

  it("pas bloquée → la vérification habituelle (lead_sequence_state unsubscribed) a lieu", async () => {
    h.resultats = [[{ email: "marie@ex.fr", linkedinProviderId: null, linkedinUrl: null }], [], []];
    expect(await storage.isLeadUnsubscribed(7, "u1")).toBe(false);
    expect(h.appels).toHaveLength(3);
    expect(q(h.appels[2].where).params).toContain("unsubscribed");
  });

  it("enrollLead : une personne bloquée n'entre jamais en séquence", async () => {
    h.resultats = [
      [{ tags: null }],                                   // prospect test ?
      [{ id: 1, delayDays: 0 }],                          // étapes de la campagne
      [{ email: "marie@ex.fr", linkedinProviderId: null, linkedinUrl: "https://www.linkedin.com/in/marie/" }],
      [{ id: 1 }],                                        // prospects_bloques
    ];
    expect(await storage.enrollLead(7, 10, "u1")).toBeNull();
    expect(q(h.appels[3].where).params).toEqual(["u1", "marie@ex.fr", "marie"]);
  });
});

describe("storage.estProspectBloque / getProspectsBloques", () => {
  it("fiche sans aucun identifiant : false sans requête", async () => {
    expect(await storage.estProspectBloque("u1", {})).toBe(false);
    expect(h.appels).toHaveLength(0);
  });
  it("getProspectsBloques : ensembles d'emails et d'identifiants LinkedIn de l'utilisatrice", async () => {
    h.resultats = [[{ e: "a@b.fr", l: null }, { e: null, l: "marie" }]];
    const r = await storage.getProspectsBloques("u1");
    expect(Array.from(r.emails)).toEqual(["a@b.fr"]);
    expect(Array.from(r.linkedinIds)).toEqual(["marie"]);
    expect(q(h.appels[0].where).params).toEqual(["u1"]);
  });
});
