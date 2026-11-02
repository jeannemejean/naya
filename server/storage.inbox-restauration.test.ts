// R13 — « Ce n'était pas une vraie réponse » : restauration de la séquence (seulement depuis
// stopped_replied), libération du SEUL brouillon de l'étape attendue (jamais un envoi réel ni
// une réservation en cours), annulation du marquage de réponse posé par l'ingestion.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const h = vi.hoisted(() => ({
  appels: [] as Array<{ op: string; table: string; where?: any; set?: any }>,
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
const ETAT = { status: "active", currentStep: 2, nextRunAt: "2026-11-02T10:00:00.000Z", delayAnchorAt: null };

beforeEach(() => { h.appels = []; h.resultats = []; vi.clearAllMocks(); });

describe("storage.restaurerEtatSequence (R12/R13)", () => {
  it("libère le brouillon de l'étape, et SEULEMENT une réservation « draft », dans la même transaction", async () => {
    h.resultats = [[{ leadId: 7, campaignId: 4, status: "active" }], []];
    const r = await storage.restaurerEtatSequence(7, ETAT, { libererBrouillonEtape: 3 });
    expect(r).toMatchObject({ leadId: 7 });
    expect(h.transaction).toHaveBeenCalledTimes(1);
    expect(h.appels.map((a) => `${a.op}:${a.table}`)).toEqual(["tx:update:lead_sequence_state", "tx:delete:outreach_step_sends"]);
    const maj = q(h.appels[0].where);
    expect(maj.sql).toContain('"lead_sequence_state"."status" = $');
    expect(maj.params).toContain("stopped_replied");
    const del = q(h.appels[1].where);
    expect(del.params).toEqual(expect.arrayContaining([7, 4, 3, "draft"]));
    expect(del.params).not.toContain("sent");
    expect(del.params).not.toContain("claimed");
    expect(del.sql).toContain('"outreach_step_sends"."status" = $');
  });

  it("rien restauré (plus en stopped_replied) → aucune réservation touchée", async () => {
    h.resultats = [[]];
    expect(await storage.restaurerEtatSequence(7, ETAT, { libererBrouillonEtape: 3 })).toBeNull();
    expect(h.appels.map((a) => a.op)).toEqual(["tx:update"]);
  });

  it("sans brouillon à libérer → aucune suppression", async () => {
    h.resultats = [[{ leadId: 7, campaignId: 4 }]];
    await storage.restaurerEtatSequence(7, ETAT);
    expect(h.appels.map((a) => a.op)).toEqual(["tx:update"]);
  });
});

describe("storage.annulerReponseOutreach (R13)", () => {
  it("ne défait que le marquage posé à l'instant de CETTE réponse, pour ce lead", async () => {
    const at = new Date("2026-11-01T09:00:00.000Z");
    h.resultats = [[{ id: 50 }]];
    expect(await storage.annulerReponseOutreach(7, at)).toBe(1);
    const [u] = h.appels;
    expect(`${u.op}:${u.table}`).toBe("db:update:outreach_messages");
    expect(u.set).toEqual({ responseReceived: false, responseDate: null });
    const w = q(u.where);
    expect(w.sql).toContain('"outreach_messages"."lead_id" = $');
    expect(w.sql).toContain('"outreach_messages"."response_date" = $');
    expect(w.params).toContain(7);
  });
});
