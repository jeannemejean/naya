// Suppression définitive d'un prospect. Aucune base réelle (consigne projet — en-tête de
// server/routes.reading.test.ts) : la transaction est un faux qui ENREGISTRE chaque opération,
// et les clauses sont rendues en SQL avec le dialecte Postgres de drizzle, hors connexion.
import { describe, it, expect, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { getTableName, eq, type SQL } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "@shared/schema";
import {
  supprimerLeadDansTransaction, clesBlocage, lignesBlocage, conditionBlocage, bloquerContact,
  bloquerDesinscritsAvantSuppression, desinscrireProspect, purgerSuppressionsExpirees, estContrainteLead,
  TABLES_SUPPRIMEES, TABLES_DETACHEES, RESERVATION_EN_COURS_MS, DUREE_PIERRE_TOMBALE_MS,
} from "./prospection-suppression";

const dialect = new PgDialect();
const rendre = (c: SQL | undefined) => (c ? dialect.sqlToQuery(c) : { sql: "", params: [] as unknown[] });

interface Op {
  op: "select" | "delete" | "update" | "insert"; table: string; sql: string; params: unknown[];
  set?: any; values?: any; lock?: string; onConflict?: boolean;
}

/** Faux `tx` : chaque select (et chaque update … returning) consomme le prochain résultat de `resultats`. */
function fauxTx(resultats: any[][]) {
  const ops: Op[] = [];
  const thenable = (op: Op, rendu: () => any) => ({
    then: (ok: any, ko: any) => { ops.push(op); return Promise.resolve(rendu()).then(ok, ko); },
  });
  const tx: any = {
    select: () => {
      const op: Op = { op: "select", table: "", sql: "", params: [] };
      const chaine: any = {
        from: (t: any) => { op.table = getTableName(t); return chaine; },
        innerJoin: () => chaine,
        where: (c: SQL) => { Object.assign(op, rendre(c)); return chaine; },
        for: (l: string) => { op.lock = l; return chaine; },
        limit: () => chaine,
        ...thenable(op, () => resultats.shift() ?? []),
      };
      return chaine;
    },
    delete: (t: any) => ({
      where: async (c: SQL) => { ops.push({ op: "delete", table: getTableName(t), ...rendre(c) }); },
    }),
    update: (t: any) => ({
      set: (set: any) => ({
        where: (c: SQL) => {
          const op: Op = { op: "update", table: getTableName(t), set, ...rendre(c) };
          return { ...thenable(op, () => undefined), returning: () => thenable(op, () => resultats.shift() ?? []) };
        },
      }),
    }),
    insert: (t: any) => ({
      values: (values: any) => {
        const op: Op = { op: "insert", table: getTableName(t), sql: "", params: [], values };
        return {
          ...thenable(op, () => undefined),
          onConflictDoNothing: () => thenable({ ...op, onConflict: true }, () => undefined),
        };
      },
    }),
  };
  return { tx, ops };
}

const FICHE = { id: 7, email: "  Marie.Dupont@Exemple.FR ", linkedinProviderId: "ACoAAB123", linkedinUrl: "https://www.linkedin.com/in/marie-dupont/" };
const NOW = new Date("2026-11-06T10:00:00Z");
const opts = () => ({ now: NOW, clearTaskReferences: vi.fn(async () => {}) });

/** Toutes les tables du schéma qui ont une clé étrangère vers `leads`. */
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

    // fiche, réservation en cours, désinscrit, envois, tâches « répondre ».
    const { tx, ops } = fauxTx([[FICHE], [], [], [], [{ id: 55 }]]);
    const o = opts();
    const r = await supprimerLeadDansTransaction(tx, 7, "u1", o);
    expect(r).toEqual({ ok: true, bloque: false });

    const deletes = ops.filter((x) => x.op === "delete");
    const updates = ops.filter((x) => x.op === "update");
    expect(deletes.map((x) => x.table)).toEqual([...TABLES_SUPPRIMEES]);
    expect(updates.map((x) => x.table)).toEqual([...TABLES_DETACHEES]);
    // La fiche part en DERNIER (une clé oubliée ferait échouer la transaction entière).
    expect(ops[ops.length - 1]).toMatchObject({ op: "delete", table: "leads" });

    // Chaque suppression est bornée au prospect 7 (ou à ses tâches « répondre »).
    for (const d of deletes.filter((x) => x.table !== "tasks")) expect(d.params, d.table).toContain(7);
    expect(deletes.find((d) => d.table === "inbox_messages")!.sql)
      .toBe(`"inbox_messages"."conversation_id" in (select "inbox_conversations"."id" from "inbox_conversations" where "inbox_conversations"."lead_id" = $1)`);
    expect(deletes.find((d) => d.table === "leads")!.sql).toBe(`("leads"."id" = $1 and "leads"."user_id" = $2)`);
    expect(deletes.find((d) => d.table === "leads")!.params).toEqual([7, "u1"]);
    // Feedback : supprimé (il nourrit les exemples des prompts), plus détaché.
    expect(deletes.find((d) => d.table === "prospection_message_feedback")!.params).toEqual([7]);

    // Tâches : « Répondre à X » et « Relancer X » supprimées (références nettoyées d'abord),
    // les autres détachées.
    const selTaches = ops.filter((x) => x.op === "select" && x.table === "tasks")[0];
    expect(selTaches.params).toEqual([7, "reponse_prospect", "relance_prospect"]);
    expect(selTaches.sql).toContain(`"tasks"."source" in ($2, $3)`);
    expect(o.clearTaskReferences).toHaveBeenCalledWith(tx, [55]);
    expect(deletes.find((d) => d.table === "tasks")!.params).toEqual([55]);
    expect(updates.find((u) => u.table === "tasks")!.set).toEqual({ leadId: null });

    expect(updates.find((u) => u.table === "linkedin_send_attempts")!.set).toEqual({ leadId: null });
    expect(updates.find((u) => u.table === "prospection_usage")!.set).toEqual({ prospectId: null });
    for (const u of updates) expect(u.params, u.table).toEqual([7]);
    // Jamais contacté, pas désinscrit : ni blocage, ni pierre tombale, ni envoi gardé.
    expect(ops.some((x) => x.op === "insert")).toBe(false);
  });

  it("aucune tâche « répondre » : rien à nettoyer", async () => {
    const { tx } = fauxTx([[FICHE], [], [], [], []]);
    const o = opts();
    await supprimerLeadDansTransaction(tx, 7, "u1", o);
    expect(o.clearTaskReferences).not.toHaveBeenCalled();
  });

  it("propriété : la fiche est lue verrouillée ET bornée à l'utilisatrice ; pas à elle → rien n'est touché", async () => {
    const { tx, ops } = fauxTx([[]]);
    const r = await supprimerLeadDansTransaction(tx, 7, "autre", opts());
    expect(r).toEqual({ ok: false, raison: "introuvable" });
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ op: "select", table: "leads", lock: "update" });
    expect(ops[0].sql).toBe(`("leads"."id" = $1 and "leads"."user_id" = $2)`);
    expect(ops[0].params).toEqual([7, "autre"]);
  });

  it("envoi en cours (réservation `claimed` récente) → refus, rien n'est supprimé", async () => {
    const { tx, ops } = fauxTx([[FICHE], [{ id: 1 }]]);
    const r = await supprimerLeadDansTransaction(tx, 7, "u1", opts());
    expect(r).toEqual({ ok: false, raison: "envoi_en_cours" });
    expect(ops.some((x) => x.op !== "select")).toBe(false);
    const garde = ops[1];
    expect(garde.table).toBe("outreach_step_sends");
    expect(garde.params).toContain("claimed");
    expect(garde.params).toContainEqual(new Date(NOW.getTime() - RESERVATION_EN_COURS_MS).toISOString());
  });

  it("désinscrit → UNE LIGNE PAR CLÉ dans prospects_bloques (email, profil public, Unipile), chacune ON CONFLICT DO NOTHING, avant toute suppression", async () => {
    const { tx, ops } = fauxTx([[FICHE], [], [{ id: 3 }], [], []]);
    const r = await supprimerLeadDansTransaction(tx, 7, "u1", opts());
    expect(r).toEqual({ ok: true, bloque: true });
    const ins = ops.filter((x) => x.op === "insert");
    expect(ins.every((x) => x.table === "prospects_bloques" && x.onConflict)).toBe(true);
    expect(ins.map((x) => x.values)).toEqual([
      { userId: "u1", emailNormalise: "marie.dupont@exemple.fr", linkedinId: null, raison: "desinscription" },
      { userId: "u1", emailNormalise: null, linkedinId: "marie-dupont", raison: "desinscription" },
      { userId: "u1", emailNormalise: null, linkedinId: "ACoAAB123", raison: "desinscription" },
    ]);
    expect(ops.indexOf(ins[0])).toBeLessThan(ops.findIndex((x) => x.op === "delete"));
    expect(ops[2].table).toBe("lead_sequence_state");
    expect(ops[2].params).toContain("unsubscribed");
  });

  it("contacté (message parti) → pierre tombale de 90 jours qui NE bloque PAS, + envois des 7 derniers jours gardés pour le plafond", async () => {
    const recent = new Date("2026-11-05T09:00:00Z");
    const ancien = new Date("2026-10-01T09:00:00Z");
    const envois = [{ canal: "email", sentAt: recent }, { canal: "linkedin", sentAt: ancien }];
    const { tx, ops } = fauxTx([[FICHE], [], [], envois, []]);
    const r = await supprimerLeadDansTransaction(tx, 7, "u1", opts());
    expect(r).toEqual({ ok: true, bloque: false });
    const selEnvois = ops.find((x) => x.op === "select" && x.table === "outreach_messages")!;
    expect(selEnvois.sql).toContain(`"outreach_messages"."sent_at" is not null`);

    const tombe = ops.find((x) => x.op === "insert" && x.table === "prospects_supprimes")!;
    expect(tombe.onConflict).toBe(true);
    expect(tombe.values).toEqual({
      userId: "u1", leadIdSupprime: 7, emailNormalise: "marie.dupont@exemple.fr",
      linkedinPublicId: "marie-dupont", linkedinProviderId: "ACoAAB123",
      expireA: new Date(NOW.getTime() + DUREE_PIERRE_TOMBALE_MS),
    });
    // Ni nom ni contenu dans la pierre tombale.
    expect(Object.keys(tombe.values)).not.toContain("name");
    // Rien sur « ne plus contacter » : la pierre tombale ne bloque jamais.
    expect(ops.some((x) => x.op === "insert" && x.table === "prospects_bloques")).toBe(false);

    const plafond = ops.find((x) => x.op === "insert" && x.table === "envois_plafond")!;
    expect(plafond.values).toEqual([{ userId: "u1", canal: "email", sentAt: recent }]);
    // Écrit AVANT la suppression des messages.
    expect(ops.indexOf(plafond)).toBeLessThan(ops.findIndex((x) => x.op === "delete" && x.table === "outreach_messages"));
  });

  it("une erreur SQL en cours de route se propage (la transaction s'annule, rien à moitié)", async () => {
    const { tx } = fauxTx([[FICHE], [], [], [], []]);
    tx.delete = () => ({ where: async () => { throw Object.assign(new Error("fk"), { code: "23503" }); } });
    await expect(supprimerLeadDansTransaction(tx, 7, "u1", opts())).rejects.toThrow("fk");
  });
});

describe("liste « ne plus contacter » — clés", () => {
  it("email : minuscules, sans espaces (même normalisation que le rattachement des réponses)", () => {
    expect(clesBlocage({ email: " A.B @Ex.com " }).email).toBe("a.b@ex.com");
  });
  it("LinkedIn : identifiant public tiré de l'URL et identifiant Unipile, les deux confrontés", () => {
    expect(clesBlocage(FICHE).linkedinIds).toEqual(["marie-dupont", "ACoAAB123"]);
  });
  it("lignes : une par clé ; aucune sans identifiant ; pas de doublon si public = Unipile", () => {
    expect(lignesBlocage("u1", { email: null, publicId: null, providerId: "ACo9" }))
      .toEqual([{ userId: "u1", emailNormalise: null, linkedinId: "ACo9", raison: "desinscription" }]);
    expect(lignesBlocage("u1", { email: null, publicId: null, providerId: null })).toEqual([]);
    expect(lignesBlocage("u1", { email: null, publicId: "x", providerId: "x" })).toHaveLength(1);
  });
  it("bloquerContact : un conflit sur une clé n'empêche pas les autres (insert séparés)", async () => {
    const { tx, ops } = fauxTx([]);
    expect(await bloquerContact(tx, "u1", { email: "a@b.fr", publicId: "p", providerId: "q" })).toBe(3);
    expect(ops.filter((x) => x.op === "insert" && x.onConflict)).toHaveLength(3);
  });
  it("condition SQL bornée à l'utilisatrice, email OU LinkedIn", () => {
    const q = rendre(conditionBlocage("u1", FICHE)!);
    expect(q.sql).toBe(`("prospects_bloques"."user_id" = $1 and ("prospects_bloques"."email_normalise" = $2 or "prospects_bloques"."linkedin_id" in ($3, $4)))`);
    expect(q.params).toEqual(["u1", "marie.dupont@exemple.fr", "marie-dupont", "ACoAAB123"]);
    expect(conditionBlocage("u1", {})).toBeNull();
  });
});

describe("bloquerDesinscritsAvantSuppression (campagne supprimée, compte remis à zéro)", () => {
  it("chaque état `unsubscribed` visé laisse ses clés sur « ne plus contacter »", async () => {
    const { tx, ops } = fauxTx([[
      { userId: "u1", email: "a@b.fr", linkedinProviderId: null, linkedinUrl: null },
      { userId: "u1", email: null, linkedinProviderId: "ACo1", linkedinUrl: "https://linkedin.com/in/zoe" },
    ]]);
    expect(await bloquerDesinscritsAvantSuppression(tx, eq(schema.leadSequenceState.campaignId, 4))).toBe(2);
    expect(ops[0].table).toBe("lead_sequence_state");
    expect(ops[0].params).toEqual(["unsubscribed", 4]);
    expect(ops.filter((x) => x.op === "insert").map((x) => x.values)).toEqual([
      { userId: "u1", emailNormalise: "a@b.fr", linkedinId: null, raison: "desinscription" },
      { userId: "u1", emailNormalise: null, linkedinId: "zoe", raison: "desinscription" },
      { userId: "u1", emailNormalise: null, linkedinId: "ACo1", raison: "desinscription" },
    ]);
  });
});

describe("desinscrireProspect (lien, un clic, webhook)", () => {
  it("fiche existante → séquence unsubscribed", async () => {
    const { tx, ops } = fauxTx([[{ userId: "u1", email: "a@b.fr", linkedinProviderId: null, linkedinUrl: null }], [{ id: 1 }]]);
    expect(await desinscrireProspect(tx, 7, { now: NOW })).toBe("lead");
    const maj = ops.find((x) => x.op === "update")!;
    expect(maj.table).toBe("lead_sequence_state");
    expect(maj.set).toMatchObject({ status: "unsubscribed", nextRunAt: null });
    expect(ops.some((x) => x.op === "insert")).toBe(false);
  });
  it("fiche existante sans séquence → ses clés vont directement sur « ne plus contacter »", async () => {
    const { tx, ops } = fauxTx([[{ userId: "u1", email: "a@b.fr", linkedinProviderId: null, linkedinUrl: null }], []]);
    expect(await desinscrireProspect(tx, 7, { now: NOW })).toBe("lead");
    expect(ops.find((x) => x.op === "insert")!.values).toEqual({ userId: "u1", emailNormalise: "a@b.fr", linkedinId: null, raison: "desinscription" });
  });
  it("fiche SUPPRIMÉE → la pierre tombale (non expirée) devient « ne plus contacter » pour son utilisatrice", async () => {
    const tombe = { userId: "u9", emailNormalise: "a@b.fr", linkedinPublicId: "zoe", linkedinProviderId: null };
    const { tx, ops } = fauxTx([[], [tombe]]);
    expect(await desinscrireProspect(tx, 7, { now: NOW })).toBe("supprime");
    const lecture = ops[1];
    expect(lecture.table).toBe("prospects_supprimes");
    expect(lecture.params).toEqual([7, NOW.toISOString()]);
    expect(ops.filter((x) => x.op === "insert").map((x) => x.values)).toEqual([
      { userId: "u9", emailNormalise: "a@b.fr", linkedinId: null, raison: "desinscription" },
      { userId: "u9", emailNormalise: null, linkedinId: "zoe", raison: "desinscription" },
    ]);
  });
  it("ni fiche ni pierre tombale, mais utilisatrice + adresse (SendGrid) → l'adresse est bloquée", async () => {
    const { tx, ops } = fauxTx([[], []]);
    expect(await desinscrireProspect(tx, 7, { userId: "u1", email: " A@B.fr", now: NOW })).toBe("email");
    expect(ops.find((x) => x.op === "insert")!.values).toEqual({ userId: "u1", emailNormalise: "a@b.fr", linkedinId: null, raison: "desinscription" });
  });
  it("rien de connu → `inconnu`, rien d'écrit", async () => {
    const { tx, ops } = fauxTx([[], []]);
    expect(await desinscrireProspect(tx, 7, { now: NOW })).toBe("inconnu");
    expect(ops.some((x) => x.op !== "select")).toBe(false);
  });
});

describe("purge et contraintes", () => {
  it("purge : pierres tombales expirées et envois de plus de 7 jours", async () => {
    const { tx, ops } = fauxTx([]);
    await purgerSuppressionsExpirees(tx, NOW);
    expect(ops.map((x) => x.table)).toEqual(["prospects_supprimes", "envois_plafond"]);
    expect(ops[0].params).toEqual([NOW.toISOString()]);
    expect(ops[1].params).toEqual([new Date(NOW.getTime() - 7 * 86_400_000).toISOString()]);
  });
  it("estContrainteLead : seulement une clé étrangère SUR le prospect", () => {
    expect(estContrainteLead({ code: "23503", constraint: "outreach_step_sends_lead_id_fkey" })).toBe(true);
    expect(estContrainteLead({ code: "23503", constraint: "outreach_messages_lead_id_leads_id_fk" })).toBe(true);
    expect(estContrainteLead({ code: "23503", constraint: "prospection_usage_prospect_id_fkey" })).toBe(true);
    expect(estContrainteLead({ code: "23503", constraint: "outreach_step_sends_campaign_id_fkey" })).toBe(false);
    expect(estContrainteLead({ code: "23503" })).toBe(false);
    expect(estContrainteLead({ code: "23505", constraint: "x_lead_id_fk" })).toBe(false);
  });
});
