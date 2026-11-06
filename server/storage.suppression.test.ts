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
  journal: [] as string[],
  txFactory: null as null | (() => any),
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
      transaction: async (fn: any) => { h.transactions++; return fn(h.txFactory ? h.txFactory() : { marque: "tx" }); },
    },
    pool: { query: vi.fn(), on: vi.fn() },
  };
});
vi.mock("./services/prospection-suppression", async (orig) => ({
  ...(await orig<any>()),
  purgerSuppressionsExpirees: vi.fn(async () => {}),
  bloquerDesinscritsAvantSuppression: vi.fn(async () => { h.journal.push("bloquer"); return 1; }),
  desinscrireProspect: vi.fn(async () => "supprime"),
  supprimerLeadDansTransaction: vi.fn(async (_tx: any, id: number) => {
    const issue = h.issues.shift();
    if (issue instanceof Error) throw issue;
    return issue ?? { ok: true, bloque: false, id };
  }),
}));

const { storage } = await import("./storage");
const { supprimerLeadDansTransaction, purgerSuppressionsExpirees, desinscrireProspect, bloquerDesinscritsAvantSuppression } = await import("./services/prospection-suppression");
const q = (w: any) => new PgDialect().sqlToQuery(w);
beforeEach(() => { h.appels = []; h.resultats = []; h.transactions = 0; h.issues = []; h.journal = []; h.txFactory = null; vi.clearAllMocks(); });

describe("storage.deleteLeads", () => {
  it("une transaction PAR prospect, ids dédoublonnés, scopée à l'utilisatrice", async () => {
    const r = await storage.deleteLeads([4, 5, 4], "u1");
    expect(h.transactions).toBe(2);
    const avecNettoyage = expect.objectContaining({ clearTaskReferences: expect.any(Function) });
    expect(supprimerLeadDansTransaction).toHaveBeenCalledWith({ marque: "tx" }, 4, "u1", avecNettoyage);
    expect(supprimerLeadDansTransaction).toHaveBeenCalledWith({ marque: "tx" }, 5, "u1", avecNettoyage);
    // Purge paresseuse des pierres tombales expirées et des vieux envois, à chaque suppression.
    expect(purgerSuppressionsExpirees).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ supprimes: [4, 5], refuses: [], bloques: 0 });
  });

  it("ids qui ne sont pas à elle → refusés (introuvable), les siens supprimés", async () => {
    h.issues = [{ ok: false, raison: "introuvable" }, { ok: true, bloque: true }];
    const r = await storage.deleteLeads([99, 5], "u1");
    expect(r).toEqual({ supprimes: [5], refuses: [{ id: 99, raison: "introuvable" }], bloques: 1 });
  });

  it("transaction annulée : seule une clé étrangère SUR LE PROSPECT vaut « envoi en cours » ; les autres continuent", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.issues = [
      Object.assign(new Error("fk"), { code: "23503", constraint: "outreach_step_sends_lead_id_fkey" }),
      Object.assign(new Error("fk"), { code: "23503", constraint: "tasks_project_id_projects_id_fk" }),
      Object.assign(new Error("boom"), {}),
      { ok: true, bloque: false },
    ];
    const r = await storage.deleteLeads([1, 2, 3, 4], "u1");
    expect(r.supprimes).toEqual([4]);
    expect(r.refuses).toEqual([{ id: 1, raison: "envoi_en_cours" }, { id: 2, raison: "erreur" }, { id: 3, raison: "erreur" }]);
  });

  it("purge en échec : la suppression continue", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    (purgerSuppressionsExpirees as any).mockRejectedValueOnce(new Error("db"));
    expect((await storage.deleteLeads([4], "u1")).supprimes).toEqual([4]);
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

describe("plafond d'emails — les envois des prospects supprimés comptent", () => {
  it("countOutreachSentSince additionne envois_plafond (même utilisatrice, canal, fenêtre)", async () => {
    const depuis = new Date("2026-11-05T10:00:00Z");
    h.resultats = [[{ id: 1 }, { id: 2 }], [{ n: 3 }]];
    expect(await storage.countOutreachSentSince("u1", depuis, "email")).toBe(5);
    expect(h.appels[1].table).toBe("envois_plafond");
    expect(q(h.appels[1].where).params).toEqual(["u1", depuis.toISOString(), "email"]);
  });
  it("getLastOutreachSentAt : le plus récent des deux (espacement entre deux envois)", async () => {
    const a = new Date("2026-11-06T08:00:00Z");
    const b = new Date("2026-11-06T09:30:00Z");
    h.resultats = [[{ sentAt: a }], [{ sentAt: b }]];
    expect(await storage.getLastOutreachSentAt("u1", "email")).toEqual(b);
    expect(h.appels[1].table).toBe("envois_plafond");
    h.resultats = [[{ sentAt: b }], []];
    expect(await storage.getLastOutreachSentAt("u1", "email")).toEqual(b);
    h.resultats = [[], [{ sentAt: a }]];
    expect(await storage.getLastOutreachSentAt("u1", "email")).toEqual(a);
  });
});

describe("storage.desinscrireProspect", () => {
  it("dans une transaction, transmet le prospect, l'utilisatrice et l'adresse", async () => {
    expect(await storage.desinscrireProspect(7, { userId: "u1", email: "a@b.fr" })).toBe("supprime");
    expect(h.transactions).toBe(1);
    expect(desinscrireProspect).toHaveBeenCalledWith({ marque: "tx" }, 7, { userId: "u1", email: "a@b.fr" });
  });
});

describe("campagne supprimée : les désinscrits passent sur « ne plus contacter » AVANT l'effacement de leur état", () => {
  it("deleteProspectionCampaign appelle le blocage avant de supprimer lead_sequence_state", async () => {
    const exec: any = {
      select: () => {
        const c: any = { from: () => c, where: () => c, then: (ok: any) => Promise.resolve([{ id: 4 }]).then(ok) };
        return c;
      },
      update: (t: any) => ({ set: () => ({ where: async () => { h.journal.push(`update:${getTableName(t)}`); } }) }),
      delete: (t: any) => ({ where: async () => { h.journal.push(`delete:${getTableName(t)}`); } }),
    };
    await storage.deleteProspectionCampaign(4, "u1", exec);
    expect(bloquerDesinscritsAvantSuppression).toHaveBeenCalledWith(exec, expect.anything());
    const cond = q((bloquerDesinscritsAvantSuppression as any).mock.calls[0][1]);
    expect(cond.sql).toBe(`"lead_sequence_state"."campaign_id" = $1`);
    expect(cond.params).toEqual([4]);
    expect(h.journal.indexOf("bloquer")).toBeLessThan(h.journal.indexOf("delete:lead_sequence_state"));
  });
});

describe("remise à zéro du compte : même garantie", () => {
  it("resetUserOnboardingState bloque les désinscrits de l'utilisatrice avant d'effacer lead_sequence_state", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    // Faux tx « tout accepte » : chaque chaîne est attendable et rend [] ; les delete sont journalisés.
    const chaine = (): any => new Proxy(function () {}, {
      get: (_t, p) => (p === "then" ? (ok: any) => Promise.resolve([]).then(ok) : () => chaine()),
      apply: () => chaine(),
    });
    h.txFactory = () => new Proxy({}, {
      get: (_t, p) => (p === "delete"
        ? (t: any) => { h.journal.push(`delete:${getTableName(t)}`); return chaine(); }
        : () => chaine()),
    });
    await storage.resetUserOnboardingState("u1");
    expect(bloquerDesinscritsAvantSuppression).toHaveBeenCalledTimes(1);
    const cond = q((bloquerDesinscritsAvantSuppression as any).mock.calls[0][1]);
    expect(cond.sql).toBe(`"lead_sequence_state"."user_id" = $1`);
    expect(cond.params).toEqual(["u1"]);
    expect(h.journal.indexOf("bloquer")).toBeGreaterThanOrEqual(0);
    expect(h.journal.indexOf("bloquer")).toBeLessThan(h.journal.indexOf("delete:lead_sequence_state"));
    // La liste « ne plus contacter » n'est jamais effacée par la remise à zéro.
    expect(h.journal).not.toContain("delete:prospects_bloques");
  });
});
