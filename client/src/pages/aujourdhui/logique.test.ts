import { describe, it, expect } from "vitest";
import {
  prochaineEtape, trierFil, estTacheProspection, capsuleCampagne, chiffreCle,
  capsulesAffichables, ligneEnAttente, type TacheAccueil,
} from "./logique";

const t = (id: number, o: Partial<TacheAccueil> = {}): TacheAccueil =>
  ({ id, title: `T${id}`, completed: false, scheduledTime: null, priority: 3, estimatedDuration: 30, ...o });

describe("prochaineEtape", () => {
  it("la première non faite dans l'ordre des heures, passées comprises", () =>
    expect(prochaineEtape([t(1, { scheduledTime: "14:00" }), t(2, { scheduledTime: "09:30" }), t(3, { scheduledTime: "08:00", completed: true })])?.id).toBe(2));
  it("sans heure : la plus prioritaire", () =>
    expect(prochaineEtape([t(1, { priority: 4 }), t(2, { priority: 1 }), t(3, { priority: null })])?.id).toBe(2));
  it("les tâches avec heure passent avant celles sans heure", () =>
    expect(prochaineEtape([t(1, { priority: 1 }), t(2, { scheduledTime: "16:00", priority: 5 })])?.id).toBe(2));
  it("tout est fait → null", () => expect(prochaineEtape([t(1, { completed: true })])).toBeNull());
  it("journée vide → null", () => expect(prochaineEtape([])).toBeNull());
});

describe("trierFil", () => {
  it("heures croissantes puis priorité, sans muter l'entrée, tâches faites comprises", () => {
    const entree = [t(1, { priority: 4 }), t(2, { scheduledTime: "14:00" }), t(3, { priority: 1, completed: true }), t(4, { scheduledTime: "09:00" })];
    expect(trierFil(entree).map((x) => x.id)).toEqual([4, 2, 3, 1]);
    expect(entree.map((x) => x.id)).toEqual([1, 2, 3, 4]);
  });
});

it("estTacheProspection suit le lien interne", () => {
  expect(estTacheProspection({ actionData: { lien: "/outreach/campaigns/3?onglet=prospects" } })).toBe(true);
  expect(estTacheProspection({ actionData: { lien: "/atelier" } })).toBe(false);
  expect(estTacheProspection({})).toBe(false);
});

describe("capsuleCampagne", () => {
  it("l'active qui finit le plus tôt, jamais une passée", () =>
    expect(capsuleCampagne([
      { name: "Hiver", status: "active", endDate: "2026-12-15" },
      { name: "Automne", status: "active", endDate: "2026-10-30" },
      { name: "Été", status: "active", endDate: "2026-09-01" },
      { name: "Brouillon", status: "draft", endDate: "2026-10-20" },
    ], "2026-10-16")).toEqual({ nom: "Automne", fin: "30 oct." }));
  it("une campagne qui finit aujourd'hui compte ; sans date de fin ou sans candidate → null", () => {
    expect(capsuleCampagne([{ name: "A", status: "active", endDate: "2026-10-16" }], "2026-10-16")?.nom).toBe("A");
    expect(capsuleCampagne([{ name: "A", status: "active", endDate: null }], "2026-10-16")).toBeNull();
    expect(capsuleCampagne([], "2026-10-16")).toBeNull();
  });
});

describe("chiffreCle", () => {
  const ev = (precedent: number | null) => ({ precedent, moyenne3: null });
  const reponse = (evolutions: Record<string, unknown>, indicateurs = ["ca", "nouveaux_clients", "mer"]) => ({
    mois: [{ mois: "2026-08", evolutions: { ca: ev(0.5) } }, { mois: "2026-09", indicateurs: {}, evolutions }],
    catalogues: { indicateurs },
  });
  it("null sur {} / null / mois vide / catalogue absent", () => {
    expect(chiffreCle({})).toBeNull();
    expect(chiffreCle(null)).toBeNull();
    expect(chiffreCle({ mois: [], catalogues: { indicateurs: ["ca"] } })).toBeNull();
    expect(chiffreCle({ mois: [{ mois: "2026-09", evolutions: {} }] })).toBeNull();
  });
  it("« +12 % » : dernier mois, premier indicateur à évolution numérique", () =>
    expect(chiffreCle(reponse({ ca: ev(null), nouveaux_clients: ev(0.123) }))).toEqual({ libelle: "nouveaux_clients", variation: "+12 %" }));
  it("variation négative signée et arrondie", () =>
    expect(chiffreCle(reponse({ ca: ev(-0.056) }))).toEqual({ libelle: "ca", variation: "-6 %" }));
  it("aucune évolution numérique → null", () =>
    expect(chiffreCle(reponse({ ca: ev(null), mer: { precedent: "x" } }))).toBeNull());
});

it("capsulesAffichables : rien de projet en mode tous les projets", () => {
  expect(capsulesAffichables(null)).toEqual({ veille: false, chiffres: false });
  expect(capsulesAffichables(7)).toEqual({ veille: true, chiffres: true });
});

it("ligneEnAttente", () => {
  expect(ligneEnAttente(0)).toBeNull();
  expect(ligneEnAttente(1)).toBe("1 tâche d'avant attend sa place. Naya la replace en fin de journée.");
  expect(ligneEnAttente(2)).toBe("2 tâches d'avant attendent leur place. Naya les replace en fin de journée.");
});
