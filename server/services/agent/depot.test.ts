// Tests du dépôt de l'agent. `../../db` est mocké : aucun test ne touche une vraie base
// (consigne projet). Le mock capture les clauses `where`, `set` et `values`, rendues en SQL
// avec le dialecte Postgres de drizzle pour affirmer ce que les requêtes bornent réellement.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const hoisted = vi.hoisted(() => ({
  resultats: [] as any[][],
  wheres: [] as any[],
  sets: [] as any[],
  valeurs: [] as any[],
}));

vi.mock("../../db", () => {
  const chaine = (): any => {
    const suite: any = {
      then: (ok: any, ko: any) => Promise.resolve(hoisted.resultats.shift() ?? []).then(ok, ko),
    };
    for (const m of ["from", "where", "limit", "values", "returning", "set"]) {
      suite[m] = (...args: any[]) => {
        if (m === "where") hoisted.wheres.push(args[0]);
        if (m === "set") hoisted.sets.push(args[0]);
        if (m === "values") hoisted.valeurs.push(args[0]);
        return suite;
      };
    }
    return suite;
  };
  return { db: { select: () => chaine(), update: () => chaine(), insert: () => chaine() }, pool: { query: vi.fn(), on: vi.fn() } };
});

import { depot, type LigneJournal } from "./depot";

const dialecte = new PgDialect();
const rendre = (w: any) => dialecte.sqlToQuery(w);

beforeEach(() => {
  hoisted.resultats.length = 0;
  hoisted.wheres.length = 0;
  hoisted.sets.length = 0;
  hoisted.valeurs.length = 0;
});

const ligne: LigneJournal = { table: "tasks", id: 3, avant: null, apres: { title: "x" } };

describe("depot de l'agent", () => {
  it("ajouterAction écrit l'action de l'utilisatrice et rend la ligne créée", async () => {
    hoisted.resultats.push([{ id: 9, userId: "u1" }]);
    const a = await depot.ajouterAction("u1", "creer_tache", "Créé x", [ligne]);
    expect(a.id).toBe(9);
    expect(hoisted.valeurs[0]).toMatchObject({ userId: "u1", outil: "creer_tache", resume: "Créé x", lignes: [ligne] });
  });

  it("getAction filtre par id ET par user_id (autre utilisatrice : undefined)", async () => {
    hoisted.resultats.push([]);
    expect(await depot.getAction(9, "autre-user")).toBeUndefined();
    const q = rendre(hoisted.wheres[0]);
    expect(q.sql).toContain('"agent_actions"."id"');
    expect(q.sql).toContain('"agent_actions"."user_id"');
    expect(q.params).toEqual([9, "autre-user"]);
  });

  it("marquerAnnulee pose annulee_at, borné à l'utilisatrice", async () => {
    const quand = new Date("2026-11-02T10:00:00Z");
    await depot.marquerAnnulee(9, "u1", quand);
    expect(hoisted.sets[0]).toEqual({ annuleeAt: quand });
    const q = rendre(hoisted.wheres[0]);
    expect(q.sql).toContain('"user_id"');
    expect(q.params).toEqual([9, "u1"]);
  });

  it("ajouterProposition enregistre toutes les pièces avec le statut en attente", async () => {
    const expireA = new Date("2026-11-02T11:00:00Z");
    hoisted.resultats.push([{ id: 4 }]);
    const p = await depot.ajouterProposition("u1", "replanifier", { a: 1 }, [{ libelle: "l", avant: null, apres: "y" }], { tasks: {} }, expireA);
    expect(p.id).toBe(4);
    expect(hoisted.valeurs[0]).toMatchObject({ userId: "u1", outil: "replanifier", arguments: { a: 1 }, empreinte: { tasks: {} }, expireA, statut: "en_attente" });
  });

  it("getProposition et majProposition sont bornées par user_id", async () => {
    hoisted.resultats.push([]);
    expect(await depot.getProposition(4, "autre-user")).toBeUndefined();
    expect(rendre(hoisted.wheres[0]).params).toEqual([4, "autre-user"]);
    hoisted.resultats.push([{ id: 4, statut: "validee" }]);
    const maj = await depot.majProposition(4, "u1", { statut: "validee" });
    expect(maj?.statut).toBe("validee");
    expect(hoisted.sets[0]).toEqual({ statut: "validee" });
    const q = rendre(hoisted.wheres[1]);
    expect(q.sql).toContain('"user_id"');
    expect(q.params).toEqual([4, "u1"]);
  });

  it("reclamerProposition : mise à jour conditionnelle (id, user_id, statut en_attente), vrai si une ligne a changé", async () => {
    hoisted.resultats.push([{ id: 4 }]);
    expect(await depot.reclamerProposition(4, "u1", "validee")).toBe(true);
    expect(hoisted.sets[0]).toEqual({ statut: "validee" });
    const q = rendre(hoisted.wheres[0]);
    expect(q.sql).toContain('"user_id"');
    expect(q.sql).toContain('"statut"');
    expect(q.params).toEqual([4, "u1", "en_attente"]);
    // Second clic concurrent : la ligne n'est plus en_attente, aucune ligne ne change.
    hoisted.resultats.push([]);
    expect(await depot.reclamerProposition(4, "u1", "validee")).toBe(false);
  });
});
