// Suppression définitive d'un prospect. Aucune base réelle (consigne projet — en-tête de
// server/routes.reading.test.ts) : la transaction est un faux qui ENREGISTRE chaque opération,
// et les clauses sont rendues en SQL avec le dialecte Postgres de drizzle, hors connexion.
import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { getTableName, type SQL } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "@shared/schema";
import {
  supprimerLeadDansTransaction, clesBlocage, ligneBlocage, conditionBlocage,
  TABLES_SUPPRIMEES, TABLES_DETACHEES, RESERVATION_EN_COURS_MS,
} from "./prospection-suppression";

const dialect = new PgDialect();
const rendre = (c: SQL | undefined) => (c ? dialect.sqlToQuery(c) : { sql: "", params: [] as unknown[] });

interface Op { op: "select" | "delete" | "update" | "insert"; table: string; sql: string; params: unknown[]; set?: any; values?: any; lock?: string }

/** Faux `tx` : chaque select consomme le prochain résultat de `resultats`. */
function fauxTx(resultats: any[][]) {
  const ops: Op[] = [];
  const tx: any = {
    select: () => {
      const op: Op = { op: "select", table: "", sql: "", params: [] };
      const chaine: any = {
        from: (t: any) => { op.table = getTableName(t); return chaine; },
        where: (c: SQL) => { Object.assign(op, rendre(c)); return chaine; },
        for: (l: string) => { op.lock = l; return chaine; },
        limit: () => chaine,
        then: (ok: any, ko: any) => { ops.push(op); return Promise.resolve(resultats.shift() ?? []).then(ok, ko); },
      };
      return chaine;
    },
    delete: (t: any) => ({
      where: async (c: SQL) => { ops.push({ op: "delete", table: getTableName(t), ...rendre(c) }); },
    }),
    update: (t: any) => ({
      set: (set: any) => ({
        where: async (c: SQL) => { ops.push({ op: "update", table: getTableName(t), set, ...rendre(c) }); },
      }),
    }),
    insert: (t: any) => ({
      values: (values: any) => ({
        onConflictDoNothing: async () => { ops.push({ op: "insert", table: getTableName(t), sql: "", params: [], values }); },
      }),
    }),
  };
  return { tx, ops };
}

const FICHE = { id: 7, email: "  Marie.Dupont@Exemple.FR ", linkedinProviderId: "ACoAAB123", linkedinUrl: "https://www.linkedin.com/in/marie-dupont/" };
const NOW = new Date("2026-11-06T10:00:00Z");

/** Toutes les tables du schéma qui ont une clé étrangère vers `leads`, plus la colonne libre du feedback. */
function tablesQuiPointentVersLeads(): string[] {
  const out = new Set<string>();
  for (const v of Object.values(schema)) {
    if (!v || typeof v !== "object" || !(Symbol.for("drizzle:IsDrizzleTable") in (v as any))) continue;
    let cfg;
    try { cfg = getTableConfig(v as any); } catch { continue; }
    for (const fk of cfg.foreignKeys) {
      if (getTableName(fk.reference().foreignTable) === "leads" && cfg.name !== "leads") out.add(cfg.name);
    }
  }
  return Array.from(out).sort();
}

describe("supprimerLeadDansTransaction — cascade", () => {
  it("couvre CHAQUE table qui pointe vers leads (clés étrangères du schéma) + feedback + messages de réponses", async () => {
    const fk = tablesQuiPointentVersLeads();
    // Garde : si une nouvelle table référence leads, ce test tombe tant qu'elle n'est pas traitée.
    expect(fk).toEqual([
      "inbox_conversations", "lead_sequence_state", "lead_step_messages", "linkedin_send_attempts",
      "outreach_messages", "outreach_step_sends", "prospection_usage", "tasks",
    ]);
    const traitees = new Set<string>([...TABLES_SUPPRIMEES, ...TABLES_DETACHEES]);
    for (const t of fk) expect(traitees.has(t), t).toBe(true);
    expect(traitees.has("prospection_message_feedback")).toBe(true); // lead_id sans clé étrangère
    expect(traitees.has("inbox_messages")).toBe(true);               // rattachée par sa conversation

    const { tx, ops } = fauxTx([[FICHE], [], []]);
    const r = await supprimerLeadDansTransaction(tx, 7, "u1", NOW);
    expect(r).toEqual({ ok: true, bloque: false });

    const deletes = ops.filter((o) => o.op === "delete");
    const updates = ops.filter((o) => o.op === "update");
    expect(deletes.map((o) => o.table)).toEqual([...TABLES_SUPPRIMEES]);
    expect(updates.map((o) => o.table)).toEqual([...TABLES_DETACHEES]);
    // La fiche part en DERNIER (une clé oubliée ferait échouer la transaction entière).
    expect(ops[ops.length - 1]).toMatchObject({ op: "delete", table: "leads" });

    // Chaque suppression est bornée au prospect 7.
    for (const d of deletes) expect(d.params, d.table).toContain(7);
    expect(deletes.find((d) => d.table === "inbox_messages")!.sql)
      .toBe(`"inbox_messages"."conversation_id" in (select "inbox_conversations"."id" from "inbox_conversations" where "inbox_conversations"."lead_id" = $1)`);
    expect(deletes.find((d) => d.table === "leads")!.sql).toBe(`("leads"."id" = $1 and "leads"."user_id" = $2)`);
    expect(deletes.find((d) => d.table === "leads")!.params).toEqual([7, "u1"]);

    // Les lignes détachées gardent leur contenu, seul le lien saute.
    expect(updates.find((u) => u.table === "tasks")!.set).toEqual({ leadId: null });
    expect(updates.find((u) => u.table === "prospection_message_feedback")!.set).toEqual({ leadId: null });
    expect(updates.find((u) => u.table === "linkedin_send_attempts")!.set).toEqual({ leadId: null });
    expect(updates.find((u) => u.table === "prospection_usage")!.set).toEqual({ prospectId: null });
    for (const u of updates) expect(u.params, u.table).toEqual([7]);
  });

  it("propriété : la fiche est lue verrouillée ET bornée à l'utilisatrice ; pas à elle → rien n'est touché", async () => {
    const { tx, ops } = fauxTx([[]]);
    const r = await supprimerLeadDansTransaction(tx, 7, "autre", NOW);
    expect(r).toEqual({ ok: false, raison: "introuvable" });
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ op: "select", table: "leads", lock: "update" });
    expect(ops[0].sql).toBe(`("leads"."id" = $1 and "leads"."user_id" = $2)`);
    expect(ops[0].params).toEqual([7, "autre"]);
  });

  it("envoi en cours (réservation `claimed` récente) → refus, rien n'est supprimé", async () => {
    const { tx, ops } = fauxTx([[FICHE], [{ id: 1 }]]);
    const r = await supprimerLeadDansTransaction(tx, 7, "u1", NOW);
    expect(r).toEqual({ ok: false, raison: "envoi_en_cours" });
    expect(ops.some((o) => o.op !== "select")).toBe(false);
    const garde = ops[1];
    expect(garde.table).toBe("outreach_step_sends");
    expect(garde.sql).toContain(`"outreach_step_sends"."status" = $2`);
    expect(garde.params).toContain("claimed");
    expect(garde.params.find((p) => typeof p === "string" && p.startsWith("2026-11-06")) ?? garde.params.find((p) => p instanceof Date))
      .toBeTruthy();
  });

  it("désinscrit → SEUL l'identifiant de contact reste, dans prospects_bloques, avant toute suppression", async () => {
    const { tx, ops } = fauxTx([[FICHE], [], [{ id: 3 }]]);
    const r = await supprimerLeadDansTransaction(tx, 7, "u1", NOW);
    expect(r).toEqual({ ok: true, bloque: true });
    const ins = ops.find((o) => o.op === "insert")!;
    expect(ins.table).toBe("prospects_bloques");
    expect(ins.values).toEqual({ userId: "u1", emailNormalise: "marie.dupont@exemple.fr", linkedinId: "marie-dupont", raison: "desinscription" });
    // Ni nom ni historique.
    expect(Object.keys(ins.values).sort()).toEqual(["emailNormalise", "linkedinId", "raison", "userId"]);
    expect(ops.indexOf(ins)).toBeLessThan(ops.findIndex((o) => o.op === "delete"));
    const etat = ops[2];
    expect(etat.table).toBe("lead_sequence_state");
    expect(etat.params).toContain("unsubscribed");
  });

  it("pas désinscrit → aucune trace gardée", async () => {
    const { tx, ops } = fauxTx([[FICHE], [], []]);
    await supprimerLeadDansTransaction(tx, 7, "u1", NOW);
    expect(ops.some((o) => o.op === "insert")).toBe(false);
  });

  it("une erreur SQL en cours de route se propage (la transaction s'annule, rien à moitié)", async () => {
    const { tx } = fauxTx([[FICHE], [], []]);
    tx.delete = () => ({ where: async () => { throw Object.assign(new Error("fk"), { code: "23503" }); } });
    await expect(supprimerLeadDansTransaction(tx, 7, "u1", NOW)).rejects.toThrow("fk");
  });

  it("fenêtre « envoi en cours » : 15 minutes", () => {
    expect(RESERVATION_EN_COURS_MS).toBe(15 * 60 * 1000);
  });
});

describe("liste « ne plus contacter » — clés", () => {
  it("email : minuscules, sans espaces (même normalisation que le rattachement des réponses)", () => {
    expect(clesBlocage({ email: " A.B @Ex.com " }).email).toBe("a.b@ex.com");
  });
  it("LinkedIn : identifiant public tiré de l'URL et identifiant Unipile, les deux confrontés", () => {
    expect(clesBlocage(FICHE).linkedinIds).toEqual(["marie-dupont", "ACoAAB123"]);
  });
  it("ligne gardée : identifiant public d'abord, Unipile à défaut ; rien si aucun identifiant", () => {
    expect(ligneBlocage("u1", { linkedinProviderId: "ACo9" })).toEqual({ userId: "u1", emailNormalise: null, linkedinId: "ACo9", raison: "desinscription" });
    expect(ligneBlocage("u1", {})).toBeNull();
  });
  it("condition SQL bornée à l'utilisatrice, email OU LinkedIn", () => {
    const q = rendre(conditionBlocage("u1", FICHE)!);
    expect(q.sql).toBe(`("prospects_bloques"."user_id" = $1 and ("prospects_bloques"."email_normalise" = $2 or "prospects_bloques"."linkedin_id" in ($3, $4)))`);
    expect(q.params).toEqual(["u1", "marie.dupont@exemple.fr", "marie-dupont", "ACoAAB123"]);
    expect(conditionBlocage("u1", {})).toBeNull();
  });
});
