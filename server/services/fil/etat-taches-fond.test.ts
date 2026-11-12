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

const { pannes, suivrePassage, ATTENDUS, debutDuSuivi, _reinitialiserEtatTachesFond, _autoriserEcritureEnTest } = await import("./etat-taches-fond");

const MAINT = new Date("2026-11-12T08:00:00Z");
const il = (minutes: number) => new Date(MAINT.getTime() - minutes * 60_000);
const etat = (nom: string, o: Partial<EtatTacheFond> = {}): EtatTacheFond =>
  ({ nom, dernierDebut: null, dernierSucces: null, derniereErreur: null, derniereErreurAt: null, ...o });
const tousBien = () => ["planificateur", "veille_ao", "revue_du_matin"].map((n) => etat(n, { dernierSucces: il(60) }))
  .concat(["envoi_prospection", "indexeur"].map((n) => etat(n, { dernierSucces: il(2) })));

beforeEach(() => { _autoriserEcritureEnTest(true); h.ecrit.length = 0; h.echec = false; _reinitialiserEtatTachesFond(); });

describe("pannes", () => {
  it("tout va bien : aucune panne", () => {
    expect(pannes(tousBien(), MAINT, true)).toEqual([]);
  });
  it("jamais passé : en panne seulement une fois la tolérance écoulée depuis le début du suivi", () => {
    const etats = tousBien().filter((e) => e.nom !== "indexeur");
    expect(pannes(etats, MAINT, true, il(10))).toEqual([]);
    expect(pannes(etats, MAINT, true, il(45))).toEqual([{ nom: ATTENDUS.indexeur.libelle, dernierSucces: null }]);
  });
  it("juste déployé : aucune ligne, ou seulement des débuts récents, ne fait pas de fausse panne", () => {
    expect(pannes([], MAINT, true, debutDuSuivi([]))).toEqual([]);
    const recents = ["planificateur", "indexeur"].map((n) => etat(n, { dernierDebut: il(5) }));
    expect(pannes(recents, MAINT, true, debutDuSuivi(recents))).toEqual([]);
    // Même état, tolérance écoulée : ce qui n'a toujours rien produit est en panne.
    const plus = new Date(MAINT.getTime() + 27 * 3600_000);
    expect(pannes(recents, plus, false, debutDuSuivi(recents)).map((p) => p.nom)).toContain(ATTENDUS.indexeur.libelle);
  });
  it("plusieurs pannes à la fois", () => {
    const etats = tousBien().map((e) => ["indexeur", "envoi_prospection"].includes(e.nom) ? etat(e.nom, { dernierSucces: il(90) }) : e);
    expect(pannes(etats, MAINT, true).map((p) => p.nom)).toEqual([ATTENDUS.envoi_prospection.libelle, ATTENDUS.indexeur.libelle]);
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
    expect(pannes(sansVeille, MAINT, true, il(30 * 60)).map((p) => p.nom)).toEqual([ATTENDUS.veille_ao.libelle]);
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
  it("début en échec pendant que fn lève : l'erreur de fn est relancée", async () => {
    h.echec = true;
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const boum = new Error("boum");
    await expect(suivrePassage("indexeur", async () => { throw boum; })).rejects.toBe(boum);
    err.mockRestore();
  });
  it("le début n'est écrit qu'une fois par tranche de 5 minutes", async () => {
    await suivrePassage("indexeur", async () => 1);
    await suivrePassage("indexeur", async () => 2);
    expect(h.ecrit.filter((e) => "dernierDebut" in e)).toHaveLength(1);
    expect(h.ecrit.filter((e) => "dernierSucces" in e)).toHaveLength(2);
  });
  it("un échec d'écriture ne fait pas échouer fn", async () => {
    h.echec = true;
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await suivrePassage("indexeur", async () => "ok")).toBe("ok");
    err.mockRestore();
  });
});

describe("sous vitest", () => {
  it("par défaut, la persistance est un no-op (aucune écriture)", async () => {
    _autoriserEcritureEnTest(false);
    await suivrePassage("indexeur", async () => 1);
    expect(h.ecrit).toHaveLength(0);
  });
});
