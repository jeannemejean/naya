import { describe, it, expect } from "vitest";
import {
  prochaineEtape, nonCocheesPassees, indexMaintenant, trierFil, estTacheProspection, capsuleCampagne, chiffreCle,
  capsulesAffichables, ligneEnAttente, doitAllerALOnboarding, resumeMatin, annulationOuverte, validationIncomplete, CLE_RIEN_NE_CLOCHE,
  type TacheAccueil,
} from "./logique";
import type { MatinFil } from "@shared/fil";

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

describe("resumeMatin", () => {
  const cle = { tacheId: 1, titre: "Relancer Léa", pourquoi: "Elle attend ta proposition.", lien: null, score: 80 };
  const matin = (p: Partial<MatinFil> = {}): MatinFil => ({
    tachesCles: [cle], objectifsOublies: [], allegement: null, nonRattachees: 0, rienNeCloche: false, ...p,
  });
  const oubli = { objectifId: 4, titre: "Lancer le podcast", joursSansTache: 9, reprise: { titre: "20 min sur le pilote", pourquoi: "Un premier pas remet le podcast en route." } };

  it("rien ne cloche : une seule phrase, aucune section", () => {
    expect(resumeMatin(matin({ rienNeCloche: true }))).toEqual({ phraseUnique: CLE_RIEN_NE_CLOCHE, sections: [], indicateurs: false });
  });
  it("un objectif oublié : la section « oublis », après les tâches clés", () => {
    expect(resumeMatin(matin({ objectifsOublies: [oubli] }))).toEqual({ phraseUnique: null, sections: ["tachesCles", "oublis"], indicateurs: false });
  });
  it("chaque signal a sa section, dans l'ordre de l'écran ; rien de vide n'est montré", () => {
    expect(resumeMatin(matin({ objectifsOublies: [oubli], allegement: { propositionId: 3 }, nonRattachees: 2 })).sections)
      .toEqual(["tachesCles", "oublis", "allegement", "nonRattachees"]);
    expect(resumeMatin(matin({ tachesCles: [], nonRattachees: 1 })).sections).toEqual(["nonRattachees"]);
    expect(resumeMatin(matin({ tachesCles: [] }))).toEqual({ phraseUnique: null, sections: [], indicateurs: false });
  });

  // Le lot 4 (spec §7 et §8) : pannes, incohérences, chantiers bloqués, retards, nouveaux.
  const panne = { nom: "Veille des appels d'offres", dernierSucces: "2026-11-10T07:04:00.000Z" };
  const chantier = { libelle: "Être visible (JMD)", joursSansMouvement: 16, prochainPas: "Écrire le post de rentrée" };
  const aTrancher = { tacheId: 9, titre: "Refaire la plaquette", ouverteDepuis: 12 };
  const incoherence = { source: "reponses", libelle: "Léa (LinkedIn) à traiter : aucune tâche pour s'en occuper", lien: "/outreach?onglet=reponses&conversation=3" };
  const creation = { alertes: ["Rien de prévu sur Instagram (JMD) dans les 7 prochains jours."], aValider: [{ libelle: "À valider : « Rentrée »", lien: "/atelier?semaine=2026-11-09" }] };
  const indicateur = { cle: "prospection_envois_4s", libelle: "Messages envoyés (4 sem.)", valeur: 42, precedente: 30 };

  it("lot 4 : pannes, incohérences, chantiers bloqués, retards, nouveaux, dans l'ordre de la spec", () => {
    const tout = matin({
      pannes: [panne], reconciliation: [incoherence], chantiersBloques: [chantier], cloture: [aTrancher], creation,
      objectifsOublies: [oubli], allegement: { propositionId: 3 }, nonRattachees: 2,
    });
    expect(resumeMatin(tout).sections).toEqual([
      "tachesCles", "pannes", "reconciliation", "chantiersBloques", "oublis", "cloture", "creationAlertes", "aValider",
      "allegement", "nonRattachees",
    ]);
  });
  it("lot 4 : une section par signal présent, aucune pour un signal vide", () => {
    expect(resumeMatin(matin({ pannes: [panne] })).sections).toEqual(["tachesCles", "pannes"]);
    expect(resumeMatin(matin({ creation: { alertes: [], aValider: creation.aValider } })).sections).toEqual(["tachesCles", "aValider"]);
    expect(resumeMatin(matin({ creation: { alertes: creation.alertes, aValider: [] } })).sections).toEqual(["tachesCles", "creationAlertes"]);
    expect(resumeMatin(matin({ pannes: [], chantiersBloques: [], cloture: [], reconciliation: [], creation: { alertes: [], aValider: [] } })).sections)
      .toEqual(["tachesCles"]);
  });
  it("la clôture n'apparaît que le vendredi, la réconciliation que le lundi (le serveur ne les envoie que ces jours-là)", () => {
    // Fixture d'un vendredi : `cloture` présent, pas de `reconciliation`.
    const vendredi = resumeMatin(matin({ cloture: [aTrancher] })).sections;
    expect(vendredi).toContain("cloture");
    expect(vendredi).not.toContain("reconciliation");
    // Fixture d'un lundi : `reconciliation` présent, pas de `cloture`.
    const lundi = resumeMatin(matin({ reconciliation: [incoherence] })).sections;
    expect(lundi).toContain("reconciliation");
    expect(lundi).not.toContain("cloture");
    // Un mardi : ni l'un ni l'autre.
    const mardi = resumeMatin(matin({ chantiersBloques: [chantier] })).sections;
    expect(mardi).not.toContain("cloture");
    expect(mardi).not.toContain("reconciliation");
  });
  it("les indicateurs ne sont pas une section : la ligne se montre aussi quand rien ne cloche", () => {
    expect(resumeMatin(matin({ rienNeCloche: true, indicateurs: [indicateur] })))
      .toEqual({ phraseUnique: CLE_RIEN_NE_CLOCHE, sections: [], indicateurs: true });
    expect(resumeMatin(matin({ indicateurs: [indicateur] })).indicateurs).toBe(true);
    expect(resumeMatin(matin({ indicateurs: [] })).indicateurs).toBe(false);
    expect(resumeMatin(matin()).indicateurs).toBe(false);
  });
});

describe("validationIncomplete", () => {
  it("sans actionId ou avec des échecs : incomplète", () => {
    expect(validationIncomplete({ actionId: 9, echecs: [] })).toBe(false);
    expect(validationIncomplete({ actionId: 9 })).toBe(false);
    expect(validationIncomplete({ echecs: [] })).toBe(true);
    expect(validationIncomplete({ actionId: 9, echecs: [{ libelle: "x" }] })).toBe(true);
    expect(validationIncomplete(null)).toBe(true);
  });
});

describe("annulationOuverte", () => {
  const valideA = "2026-11-12T08:00:00.000Z";
  it("pendant 24 h après la validation, pas au-delà", () => {
    expect(annulationOuverte(valideA, new Date("2026-11-13T07:59:00.000Z"))).toBe(true);
    expect(annulationOuverte(valideA, new Date("2026-11-13T08:00:00.000Z"))).toBe(false);
    expect(annulationOuverte("pas une date", new Date(valideA))).toBe(false);
  });
});
