// Santé des tâches de fond : `pannes` est pure, `suivrePassage` écrit via une base mockée.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EtatTacheFond } from "@shared/schema";

const h = vi.hoisted(() => ({ valeurs: vi.fn(), set: vi.fn(), ecrit: [] as any[], echec: false }));
vi.mock("../../db", () => ({
  db: {
    insert: () => ({
      values: (v: any) => ({
        onConflictDoUpdate: async ({ set }: any) => {
          if (h.echec) throw new Error("base indisponible");
          h.ecrit.push({ ...v, ...set });
        },
      }),
    }),
  },
}));

const { pannes, suivrePassage, ATTENDUS } = await import("./etat-taches-fond");

const MAINT = new Date("2026-11-12T08:00:00Z");
const il = (minutes: number) => new Date(MAINT.getTime() - minutes * 60_000);
const etat = (nom: string, o: Partial<EtatTacheFond> = {}): EtatTacheFond =>
  ({ nom, dernierDebut: null, dernierSucces: null, derniereErreur: null, derniereErreurAt: null, ...o });
const tousBien = () => ["planificateur", "veille_ao", "revue_du_matin"].map((n) => etat(n, { dernierSucces: il(60) }))
  .concat(["envoi_prospection", "indexeur"].map((n) => etat(n, { dernierSucces: il(2) })));

beforeEach(() => { h.ecrit.length = 0; h.echec = false; });

describe("pannes", () => {
  it("tout va bien : aucune panne", () => {
    expect(pannes(tousBien(), MAINT, true)).toEqual([]);
  });
  it("jamais passé : en panne, sans dernier succès", () => {
    const p = pannes(tousBien().filter((e) => e.nom !== "indexeur"), MAINT, true);
    expect(p).toEqual([{ nom: ATTENDUS.indexeur.libelle, dernierSucces: null }]);
  });
  it("en retard : plus de tolérance depuis le dernier succès, date en ISO", () => {
    const etats = tousBien().map((e) => e.nom === "envoi_prospection" ? etat(e.nom, { dernierSucces: il(45) }) : e);
    expect(pannes(etats, MAINT, true)).toEqual([{ nom: ATTENDUS.envoi_prospection.libelle, dernierSucces: il(45).toISOString() }]);
  });
  it("erreur après un succès : en panne même dans les temps ; erreur plus ancienne que le succès : non", () => {
    const etats = tousBien().map((e) => e.nom === "planificateur"
      ? etat(e.nom, { dernierSucces: il(120), derniereErreurAt: il(60), derniereErreur: "x" }) : e);
    expect(pannes(etats, MAINT, true).map((p) => p.nom)).toEqual([ATTENDUS.planificateur.libelle]);
    const reglee = tousBien().map((e) => e.nom === "planificateur"
      ? etat(e.nom, { dernierSucces: il(60), derniereErreurAt: il(120), derniereErreur: "x" }) : e);
    expect(pannes(reglee, MAINT, true)).toEqual([]);
  });
  it("la veille AO n'est attendue que si des utilisatrices y sont inscrites", () => {
    const sansVeille = tousBien().filter((e) => e.nom !== "veille_ao");
    expect(pannes(sansVeille, MAINT, false)).toEqual([]);
    expect(pannes(sansVeille, MAINT, true).map((p) => p.nom)).toEqual([ATTENDUS.veille_ao.libelle]);
  });
});

describe("suivrePassage", () => {
  it("note le début puis le succès, et rend la valeur de fn", async () => {
    expect(await suivrePassage("indexeur", async () => 42)).toBe(42);
    expect(h.ecrit.map((e) => Object.keys(e).filter((k) => k !== "nom"))).toEqual([["dernierDebut"], ["dernierSucces"]]);
  });
  it("note l'erreur et la relance telle quelle", async () => {
    const boum = new Error("boum");
    await expect(suivrePassage("indexeur", async () => { throw boum; })).rejects.toBe(boum);
    expect(h.ecrit.at(-1)).toMatchObject({ nom: "indexeur", derniereErreur: "boum" });
  });
  it("un échec d'écriture ne fait pas échouer fn", async () => {
    h.echec = true;
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await suivrePassage("indexeur", async () => "ok")).toBe("ok");
    err.mockRestore();
  });
});
