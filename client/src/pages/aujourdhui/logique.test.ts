import { describe, it, expect } from "vitest";
import {
  prochaineEtape, nonCocheesPassees, indexMaintenant, trierFil, estTacheProspection, capsuleCampagne, chiffreCle,
  capsulesAffichables, ligneEnAttente, doitAllerALOnboarding, type TacheAccueil,
} from "./logique";

const t = (id: number, o: Partial<TacheAccueil> = {}): TacheAccueil =>
  ({ id, title: `T${id}`, completed: false, scheduledTime: null, priority: 3, estimatedDuration: 30, ...o });

describe("prochaineEtape", () => {
  const id = (r: ReturnType<typeof prochaineEtape>) => r && { id: r.tache.id, moment: r.moment };
  it("la tâche dont le créneau est en cours", () =>
    expect(id(prochaineEtape([t(1, { scheduledTime: "18:30", scheduledEndTime: "19:00" }), t(2, { scheduledTime: "19:00" })], "18:48")))
      .toEqual({ id: 1, moment: "maintenant" }));
  it("jamais une tâche passée : à 18:48, pas celle de 10:50 (cas réel du 20 oct.)", () =>
    expect(id(prochaineEtape([t(1, { scheduledTime: "10:50", estimatedDuration: 5 }), t(2, { scheduledTime: "19:00" })], "18:48")))
      .toEqual({ id: 2, moment: "ensuite" }));
  it("sans heure de fin : début + durée", () =>
    expect(id(prochaineEtape([t(1, { scheduledTime: "18:30", estimatedDuration: 30 })], "18:48"))).toEqual({ id: 1, moment: "maintenant" }));
  it("plus rien à venir : la plus prioritaire sans heure", () =>
    expect(id(prochaineEtape([t(1, { scheduledTime: "09:00" }), t(2, { priority: 4 }), t(3, { priority: 1 })], "18:48")))
      .toEqual({ id: 3, moment: "sansHeure" }));
  it("seulement des tâches passées non cochées → null", () =>
    expect(prochaineEtape([t(1, { scheduledTime: "09:00" })], "18:48")).toBeNull());
  it("tout est fait → null", () => expect(prochaineEtape([t(1, { completed: true })], "08:00")).toBeNull());
  it("journée vide → null", () => expect(prochaineEtape([], "08:00")).toBeNull());
});

describe("nonCocheesPassees et indexMaintenant", () => {
  const fil = [t(1, { scheduledTime: "09:00" }), t(2, { scheduledTime: "10:00", completed: true }), t(3, { scheduledTime: "18:30" }), t(4, { scheduledTime: "19:00" }), t(5)];
  it("créneau fini et non coché", () => expect(nonCocheesPassees(fil, "18:48").map((x) => x.id)).toEqual([1]));
  it("la ligne se pose avant la première tâche qui commence après maintenant", () => {
    expect(indexMaintenant(fil, "18:48")).toBe(3);
    expect(indexMaintenant(fil, "07:00")).toBe(0);
    expect(indexMaintenant([t(1, { scheduledTime: "09:00" })], "23:00")).toBe(1);
  });
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
  it("date de fin dans la langue demandée, fr-FR par défaut", () => {
    const c = [{ name: "A", status: "active", endDate: "2026-10-30" }];
    expect(capsuleCampagne(c, "2026-10-16")?.fin).toBe("30 oct.");
    expect(capsuleCampagne(c, "2026-10-16", "en-GB")?.fin).toBe("30 Oct");
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

describe("doitAllerALOnboarding", () => {
  it("réponse reçue sans ADN de marque (null) → onboarding", () =>
    expect(doitAllerALOnboarding({ isSuccess: true, data: null })).toBe(true));
  it("ADN de marque présent → on reste", () =>
    expect(doitAllerALOnboarding({ isSuccess: true, data: { id: 1 } })).toBe(false));
  it("requête en cours → on reste (pas de flash)", () =>
    expect(doitAllerALOnboarding({ isSuccess: false, data: undefined })).toBe(false));
  // Même un null (dernière valeur connue) ne doit pas suffire sans réponse réussie.
  it("requête en erreur → on reste", () =>
    expect(doitAllerALOnboarding({ isSuccess: false, data: null })).toBe(false));
});
