// Le matin du fil conducteur : tâches clés sur TOUS les objectifs (le filtre de projet de la barre
// latérale est ignoré), objectifs oubliés avec leur reprise, journée allégée proposée une fois
// par jour sur énergie basse, tâches non rattachées. Toutes les dépendances sont injectées :
// aucun test ne touche une vraie base, l'IA ni le réseau.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Task } from "@shared/schema";
import type { CarteFil, ObjectifCarte } from "./carte";
import { construireMatin, echeancesDe, viderReprisesEnMemoire, blocTachesDuBrief, SOURCES_HORS_RATTACHEMENT, type DepsMatin } from "./matin";

const AUJ = "2026-11-12";
const MAINTENANT = new Date("2026-11-12T08:00:00Z");

const objectif = (id: number, projetId: number, titre: string, etapeId: number): ObjectifCarte => ({
  id, projetId, titre, successMode: "revenue", goalType: "revenue", cible: null, dueDate: null,
  etapes: [{ id: etapeId, objectifId: id, projetId, titre: `Étape de ${titre}`, pourquoi: null, statut: "active", ordre: 0, faites: 1, prevues: 3 }],
});
const CARTE: CarteFil = {
  objectifs: [objectif(1, 10, "Objectif A", 100), objectif(2, 20, "Objectif B", 200)],
  chainesSansObjectif: new Map(), depuis: new Date("2026-10-01T08:00:00Z"),
};
const tache = (id: number, extra: Partial<Task> = {}): Task => ({
  id, userId: "u1", projectId: 10, title: `Tâche ${id}`, type: "planning", category: "planning", priority: 3,
  completed: false, archivedAt: null, scheduledDate: AUJ, goalId: null, milestoneId: null, ritualId: null,
  schedulingMode: "flexible", taskEnergyType: "execution", pourquoi: null, estimatedDuration: 30, ...extra,
} as unknown as Task);

// Toutes les tâches de fond ont réussi à l'instant : aucune panne.
const TACHES_EN_FORME = ["planificateur", "veille_ao", "envoi_prospection", "revue_du_matin", "indexeur"]
  .map((nom) => ({ nom, dernierDebut: MAINTENANT, dernierSucces: MAINTENANT, derniereErreur: null, derniereErreurAt: null }));

function deps(over: Partial<DepsMatin> = {}): DepsMatin & { [k: string]: any } {
  return {
    carte: vi.fn(async () => CARTE),
    tachesDuJour: vi.fn(async () => [
      tache(1, { projectId: 10, goalId: 1, milestoneId: 100 }),
      tache(2, { projectId: 20, goalId: 2, milestoneId: 200, priority: 1 }),
    ]),
    preferences: vi.fn(async () => ({ activeProjectId: 10, currentEnergyLevel: "high", energyUpdatedDate: AUJ, workDays: "mon,tue,wed,thu,fri", filConducteurDepuis: CARTE.depuis })),
    echeances: vi.fn(async () => []),
    oublies: vi.fn(async () => []),
    etatsTachesFond: vi.fn(async () => TACHES_EN_FORME),
    chantiersBloques: vi.fn(async () => []),
    indicateurs: vi.fn(async () => []),
    creation: vi.fn(async () => ({ alertes: [], aValider: [] })),
    cloture: vi.fn(async () => []),
    reconciliation: vi.fn(async () => []),
    reprise: vi.fn(async () => null),
    allegementsDuJour: vi.fn(async () => []),
    proposerAllegement: vi.fn(async () => ({ id: 77 })),
    ...over,
  } as any;
}

beforeEach(() => viderReprisesEnMemoire());

describe("construireMatin", () => {
  it("préférences lues une seule fois ; la carte est chargée depuis leur date de mise en route", async () => {
    const d = deps();
    await construireMatin("u1", AUJ, MAINTENANT, d);
    expect(d.preferences).toHaveBeenCalledTimes(1);
    expect(d.carte).toHaveBeenCalledWith("u1", CARTE.depuis);
  });

  it("échéances : date limite des tâches et date cible des étapes lues sur la carte", () => {
    const carte: CarteFil = { ...CARTE, objectifs: [{ ...CARTE.objectifs[0], etapes: [{ ...CARTE.objectifs[0].etapes[0], targetDate: "2026-11-14" }] }] };
    expect(echeancesDe(carte, [tache(1, { dueDate: new Date("2026-11-13T00:00:00Z") } as any)])).toEqual([
      { tacheId: 1, date: "2026-11-13" }, { etapeId: 100, date: "2026-11-14" },
    ]);
  });

  it("projet filtré A : le matin contient les tâches clés de B (filtre de la barre latérale ignoré)", async () => {
    const d = deps();
    const fil = await construireMatin("u1", AUJ, MAINTENANT, d);
    expect(fil.tachesCles.map((c) => c.tacheId)).toContain(2);
    expect(fil.tachesCles.find((c) => c.tacheId === 2)?.lien?.objectifTitre).toBe("Objectif B");
    // Les tâches du jour sont lues sans projet : tous les projets.
    expect(d.tachesDuJour).toHaveBeenCalledWith("u1", AUJ);
  });

  it("sans signal : rienNeCloche vrai, aucun allègement", async () => {
    const d = deps();
    const fil = await construireMatin("u1", AUJ, MAINTENANT, d);
    expect(fil).toMatchObject({ objectifsOublies: [], allegement: null, nonRattachees: 0, rienNeCloche: true });
    expect(d.proposerAllegement).not.toHaveBeenCalled();
  });

  it("une tâche de fond en panne : signalée avec son libellé et un succès en ISO, rienNeCloche faux", async () => {
    const etats = TACHES_EN_FORME.map((e) => e.nom === "indexeur" ? { ...e, dernierSucces: new Date("2026-11-10T08:00:00Z") } : e);
    const fil = await construireMatin("u1", AUJ, MAINTENANT, deps({ etatsTachesFond: vi.fn(async () => etats) }));
    expect(fil.pannes).toEqual([{ nom: "L'indexeur de la recherche", dernierSucces: "2026-11-10T08:00:00.000Z" }]);
    expect(fil.rienNeCloche).toBe(false);
  });

  it("un chantier sans mouvement : signalé avec son prochain pas, rienNeCloche faux ; une erreur n'invente rien", async () => {
    const bloque = { libelle: "Rendez-vous (Garance)", joursSansMouvement: 16, prochainPas: "Appeler Paul" };
    const d = deps({ chantiersBloques: vi.fn(async () => [bloque]) });
    const fil = await construireMatin("u1", AUJ, MAINTENANT, d);
    expect(fil.chantiersBloques).toEqual([bloque]);
    expect(fil.rienNeCloche).toBe(false);
    expect(d.chantiersBloques).toHaveBeenCalledWith("u1", CARTE, MAINTENANT);

    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const enPanne = await construireMatin("u1", AUJ, MAINTENANT, deps({ chantiersBloques: vi.fn(async () => { throw new Error("base"); }) }));
    err.mockRestore();
    expect(enPanne.chantiersBloques).toBeUndefined();
    expect(enPanne.rienNeCloche).toBe(true);
  });

  it("création : alertes et posts à valider remplissent `creation` et font sonner le matin ; vide ou en panne, rien", async () => {
    const suivi = {
      alertes: ["Rien de prévu sur Instagram (Encore Merci) dans les 7 prochains jours."],
      aValider: [{ libelle: "À valider : « Tarte » (Instagram, samedi 14 novembre)", lien: "/atelier?semaine=2026-11-09" }],
    };
    const d = deps({ creation: vi.fn(async () => suivi) });
    const fil = await construireMatin("u1", AUJ, MAINTENANT, d);
    expect(fil.creation).toEqual(suivi);
    expect(fil.rienNeCloche).toBe(false);
    expect(d.creation).toHaveBeenCalledWith("u1", MAINTENANT);

    const seulementAValider = await construireMatin("u1", AUJ, MAINTENANT, deps({ creation: vi.fn(async () => ({ alertes: [], aValider: suivi.aValider })) }));
    expect(seulementAValider.rienNeCloche).toBe(false);

    const vide = await construireMatin("u1", AUJ, MAINTENANT, deps());
    expect(vide.creation).toBeUndefined();
    expect(vide.rienNeCloche).toBe(true);

    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const enPanne = await construireMatin("u1", AUJ, MAINTENANT, deps({ creation: vi.fn(async () => { throw new Error("base"); }) }));
    err.mockRestore();
    expect(enPanne.creation).toBeUndefined();
    expect(enPanne.rienNeCloche).toBe(true);
  });

  it("clôture (vendredi) et réconciliation (lundi) : non vides, elles remplissent le matin et le font sonner ; vides ou en panne, rien", async () => {
    const cloture = [{ tacheId: 3, titre: "Relancer Margaux", ouverteDepuis: 9 }];
    const reco = [{ source: "reponses", libelle: "Réponse de Marc (LinkedIn) à traiter : aucune tâche pour s'en occuper", lien: "/outreach?onglet=reponses&conversation=7" }];
    const d = deps({ cloture: vi.fn(async () => cloture) });
    const fil = await construireMatin("u1", AUJ, MAINTENANT, d);
    expect(fil.cloture).toEqual(cloture);
    expect(fil.rienNeCloche).toBe(false);
    expect(d.cloture).toHaveBeenCalledWith("u1", MAINTENANT);
    expect(d.reconciliation).toHaveBeenCalledWith("u1", MAINTENANT);

    const r = await construireMatin("u1", AUJ, MAINTENANT, deps({ reconciliation: vi.fn(async () => reco) }));
    expect(r.reconciliation).toEqual(reco);
    expect(r.cloture).toBeUndefined();
    expect(r.rienNeCloche).toBe(false);

    const vide = await construireMatin("u1", AUJ, MAINTENANT, deps());
    expect(vide.cloture).toBeUndefined();
    expect(vide.reconciliation).toBeUndefined();
    expect(vide.rienNeCloche).toBe(true);

    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const enPanne = await construireMatin("u1", AUJ, MAINTENANT, deps({
      cloture: vi.fn(async () => { throw new Error("base"); }), reconciliation: vi.fn(() => { throw new Error("synchrone"); }),
    }));
    err.mockRestore();
    expect(enPanne.cloture).toBeUndefined();
    expect(enPanne.reconciliation).toBeUndefined();
    expect(enPanne.rienNeCloche).toBe(true);
  });

  it("indicateurs : remplis avec leur précédente, informatifs (rienNeCloche reste vrai), absents si leur lecture plante", async () => {
    const ind = [
      { cle: "prospection_envois_4s", libelle: "Messages de prospection envoyés (4 sem.)", valeur: 42, precedente: 30 },
      { cle: "prospection_rdv_4s", libelle: "Rendez-vous avec des prospects (4 sem.)", valeur: null, precedente: 3, indisponible: "agenda non relié" },
    ];
    const d = deps({ indicateurs: vi.fn(async () => ind) });
    const fil = await construireMatin("u1", AUJ, MAINTENANT, d);
    expect(d.indicateurs).toHaveBeenCalledWith("u1", AUJ, MAINTENANT);
    expect(fil.indicateurs).toEqual(ind);
    expect(fil.rienNeCloche).toBe(true);

    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const enPanne = await construireMatin("u1", AUJ, MAINTENANT, deps({ indicateurs: vi.fn(async () => { throw new Error("base"); }) }));
    err.mockRestore();
    expect(enPanne.indicateurs).toBeUndefined();
    expect(enPanne.tachesCles.length).toBeGreaterThan(0);
  });

  it("la lecture de l'état des tâches de fond échoue : pas de panne inventée", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const fil = await construireMatin("u1", AUJ, MAINTENANT, deps({ etatsTachesFond: vi.fn(async () => { throw new Error("x"); }) }));
    err.mockRestore();
    expect(fil.pannes).toBeUndefined();
    expect(fil.rienNeCloche).toBe(true);
  });

  it("une tâche du jour sans objectif : comptée, rienNeCloche faux ; rituels, heure fixe et faites exclus", async () => {
    const d = deps({
      tachesDuJour: vi.fn(async () => [
        tache(1, { goalId: 1, milestoneId: 100 }),
        tache(3), // non rattachée
        tache(4, { ritualId: 9 } as any),
        tache(5, { schedulingMode: "fixed" }),
        tache(6, { completed: true }),
      ]),
    });
    const fil = await construireMatin("u1", AUJ, MAINTENANT, d);
    expect(fil.nonRattachees).toBe(1);
    expect(fil.rienNeCloche).toBe(false);
  });

  it("les tâches de ménage de Naya (mail en attente, clôture) ne comptent pas comme non rattachées", async () => {
    const d = deps({
      tachesDuJour: vi.fn(async () => [
        tache(1, { goalId: 1, milestoneId: 100 }),
        tache(7, { source: "fil_mail" } as any),
        tache(8, { source: "fil_cloture" } as any),
      ]),
    });
    const fil = await construireMatin("u1", AUJ, MAINTENANT, d);
    expect(SOURCES_HORS_RATTACHEMENT).toEqual(expect.arrayContaining(["fil_mail", "fil_cloture"]));
    expect(fil.nonRattachees).toBe(0);
    expect(blocTachesDuBrief(fil, [])).not.toContain("rattachées à aucun objectif");
  });

  it("énergie low mise à jour aujourd'hui : une proposition est créée ; rappelé, le matin ne la recrée pas", async () => {
    const proposees: any[] = [];
    const d = deps({
      tachesDuJour: vi.fn(async () => [
        tache(1, { goalId: 1, milestoneId: 100 }), tache(2, { goalId: 2, milestoneId: 200 }),
        tache(3), tache(4), tache(5),
      ]),
      preferences: vi.fn(async () => ({ currentEnergyLevel: "low", energyUpdatedDate: AUJ, workDays: "mon,tue,wed,thu,fri" })),
      allegementsDuJour: vi.fn(async () => proposees.map((p) => ({ id: p.id, statut: "en_attente", expireA: new Date("2026-11-12T23:00:00Z") }))),
      proposerAllegement: vi.fn(async (_u: string, args: any) => { proposees.push({ id: 77, args }); return { id: 77 }; }),
    });
    const premier = await construireMatin("u1", AUJ, MAINTENANT, d);
    expect(premier.allegement).toEqual({ propositionId: 77 });
    // Une journée allégée en attente est un signal : pas « rien ne cloche ».
    expect(premier.rienNeCloche).toBe(false);
    expect(d.proposerAllegement).toHaveBeenCalledTimes(1);
    const args = (d.proposerAllegement as any).mock.calls[0][1];
    expect(args.date).toBe(AUJ);
    expect(args.deplacer.length).toBeGreaterThan(0);
    expect(args.deplacer.every((x: any) => x.vers > AUJ)).toBe(true);

    const second = await construireMatin("u1", AUJ, MAINTENANT, d);
    expect(second.allegement).toEqual({ propositionId: 77 });
    expect(d.proposerAllegement).toHaveBeenCalledTimes(1);
  });

  it("allègement déjà validé ou annulé aujourd'hui : pas de nouvelle proposition, allegement null", async () => {
    const d = deps({
      tachesDuJour: vi.fn(async () => [tache(1, { goalId: 1, milestoneId: 100 }), tache(3), tache(4), tache(5)]),
      preferences: vi.fn(async () => ({ currentEnergyLevel: "depleted", energyUpdatedDate: AUJ })),
      allegementsDuJour: vi.fn(async () => [{ id: 5, statut: "annulee", expireA: new Date("2026-11-12T23:00:00Z") }]),
    });
    const fil = await construireMatin("u1", AUJ, MAINTENANT, d);
    expect(fil.allegement).toBeNull();
    expect(d.proposerAllegement).not.toHaveBeenCalled();
  });

  it("énergie low d'un AUTRE jour : pas d'allègement", async () => {
    const d = deps({
      tachesDuJour: vi.fn(async () => [tache(1, { goalId: 1, milestoneId: 100 }), tache(3), tache(4), tache(5)]),
      preferences: vi.fn(async () => ({ currentEnergyLevel: "low", energyUpdatedDate: "2026-11-11" })),
    });
    const fil = await construireMatin("u1", AUJ, MAINTENANT, d);
    expect(fil.allegement).toBeNull();
    expect(d.allegementsDuJour).not.toHaveBeenCalled();
  });

  it("énergie low mais rien à déplacer : pas de proposition", async () => {
    const d = deps({
      tachesDuJour: vi.fn(async () => [tache(1, { goalId: 1, milestoneId: 100 })]),
      preferences: vi.fn(async () => ({ currentEnergyLevel: "low", energyUpdatedDate: AUJ })),
    });
    const fil = await construireMatin("u1", AUJ, MAINTENANT, d);
    expect(fil.allegement).toBeNull();
    expect(d.proposerAllegement).not.toHaveBeenCalled();
  });

  it("objectif oublié : listé avec une reprise de secours tout de suite, l'IA une seule fois par objectif et par jour", async () => {
    let resoudre!: (v: any) => void;
    const reprise = vi.fn(() => new Promise<any>((r) => { resoudre = r; }));
    const d = deps({ oublies: vi.fn(async () => [{ objectifId: 2, titre: "Objectif B", joursSansTache: 9 }]), reprise });

    const premier = await construireMatin("u1", AUJ, MAINTENANT, d);
    expect(premier.rienNeCloche).toBe(false);
    expect(premier.objectifsOublies).toHaveLength(1);
    const o = premier.objectifsOublies[0];
    expect(o).toMatchObject({ objectifId: 2, titre: "Objectif B", joursSansTache: 9 });
    expect(o.reprise.titre).toBe("20 min sur l'étape « Étape de Objectif B »");
    expect(o.reprise.pourquoi).toContain("Objectif B");
    expect(o.reprise.pourquoi.length).toBeGreaterThanOrEqual(25);

    resoudre({ titre: "Relancer les 3 contacts chauds", pourquoi: "L'étape « Étape de Objectif B » attend ses premiers rendez-vous.", duree: 20 });
    await new Promise((r) => setTimeout(r, 0));
    const second = await construireMatin("u1", AUJ, MAINTENANT, d);
    expect(second.objectifsOublies[0].reprise).toEqual({
      titre: "Relancer les 3 contacts chauds", pourquoi: "L'étape « Étape de Objectif B » attend ses premiers rendez-vous.",
    });
    await construireMatin("u1", AUJ, MAINTENANT, d);
    expect(reprise).toHaveBeenCalledTimes(1);
  });

  it("IA bloquée (reprise null) : le secours reste, sans nouvel appel le même jour", async () => {
    const reprise = vi.fn(async () => null);
    const d = deps({ oublies: vi.fn(async () => [{ objectifId: 1, titre: "Objectif A", joursSansTache: 8 }]), reprise });
    await construireMatin("u1", AUJ, MAINTENANT, d);
    await new Promise((r) => setTimeout(r, 0));
    const fil = await construireMatin("u1", AUJ, MAINTENANT, d);
    expect(fil.objectifsOublies[0].reprise.titre).toBe("20 min sur l'étape « Étape de Objectif A »");
    expect(reprise).toHaveBeenCalledTimes(1);
  });

  it("les tâches clés passent par les échéances (tâche liée à une échéance proche)", async () => {
    const d = deps({
      tachesDuJour: vi.fn(async () => [tache(1, { goalId: 1, milestoneId: 100 }), tache(2, { goalId: 2, milestoneId: 200 })]),
      echeances: vi.fn(async () => [{ etapeId: 100, date: AUJ }]),
    });
    const fil = await construireMatin("u1", AUJ, MAINTENANT, d);
    expect(fil.tachesCles[0].tacheId).toBe(1);
  });
});

describe("blocTachesDuBrief", () => {
  const ANCIEN = ["- Tâche 1 (task, ~30min, energy: execution)"];

  it("sans fil : exactement le bloc d'aujourd'hui", () => {
    expect(blocTachesDuBrief(null, ANCIEN)).toBe("\nTÂCHES DU JOUR :\n- Tâche 1 (task, ~30min, energy: execution)");
    expect(blocTachesDuBrief(null, [])).toBe("\nAucune tâche planifiée pour aujourd'hui.");
  });

  it("avec fil : tâches clés avec lien et pourquoi, objectifs oubliés, consigne « rien ne cloche »", () => {
    const bloc = blocTachesDuBrief({
      tachesCles: [{ tacheId: 2, titre: "Écrire l'offre", pourquoi: "Sans offre, pas de rendez-vous.", score: 50,
        lien: { objectifId: 2, objectifTitre: "Objectif B", etapeId: 200, etapeTitre: "Offre", etapeFaites: 1, etapePrevues: 3, cible: "3 clients d'ici fin décembre" } }],
      objectifsOublies: [{ objectifId: 1, titre: "Objectif A", joursSansTache: 9, reprise: { titre: "20 min sur l'étape « X »", pourquoi: "…" } }],
      allegement: null, nonRattachees: 0, rienNeCloche: false,
    }, ANCIEN);
    expect(bloc).toContain("Écrire l'offre");
    expect(bloc).toContain("Offre");
    expect(bloc).toContain("1 tâche sur 3");
    expect(bloc).toContain("Objectif B");
    expect(bloc).toContain("Sans offre, pas de rendez-vous.");
    expect(bloc).toContain("Objectif A");
    expect(bloc).toContain("9 jours");
    expect(bloc).toContain("si rien ne cloche, une seule phrase");
    expect(bloc).not.toContain("energy: execution");
  });

  const SANS_LOT4 = { tachesCles: [], objectifsOublies: [], allegement: null, nonRattachees: 0, rienNeCloche: false };

  it("le lot 4 entre au prompt : indicateurs en une ligne, pannes, réconciliation, chantiers, clôture, création", () => {
    const bloc = blocTachesDuBrief({
      ...SANS_LOT4,
      indicateurs: [{ cle: "prospection_envois_4s", libelle: "Messages envoyés", valeur: 42, precedente: 30 },
        { cle: "prospection_rdv_4s", libelle: "Rendez-vous", valeur: null, precedente: null, indisponible: "agenda non relié" }],
      pannes: [{ nom: "Veille des appels d'offres", dernierSucces: null }],
      reconciliation: [{ source: "reponses", libelle: "Léa (LinkedIn) à traiter : aucune tâche pour s'en occuper", lien: "/outreach" }],
      chantiersBloques: [{ libelle: "Être visible (JMD)", joursSansMouvement: 16, prochainPas: "Écrire le post de rentrée" }],
      cloture: [{ tacheId: 9, titre: "Refaire la plaquette", ouverteDepuis: 12 }],
      creation: { alertes: ["Rien de prévu sur Instagram (JMD) dans les 7 prochains jours."], aValider: [{ libelle: "À valider : « Rentrée »", lien: "/atelier" }] },
    }, ANCIEN);
    expect(bloc).toContain("42 envois ↑ · rdv indisponible");
    expect(bloc).toContain("Veille des appels d'offres");
    expect(bloc).toContain("Léa (LinkedIn) à traiter");
    expect(bloc).toContain("Être visible (JMD) : 16 jours sans mouvement ; prochain pas : Écrire le post de rentrée");
    expect(bloc).toContain("Refaire la plaquette (ouverte depuis 12 jours)");
    expect(bloc).toContain("Rien de prévu sur Instagram (JMD)");
    expect(bloc).toContain("À valider : « Rentrée »");
    // L'ordre de la consolidation : pannes, incohérences, chantiers bloqués, retards, nouveaux.
    const ordre = ["Veille des appels d'offres", "Léa (LinkedIn)", "Être visible (JMD)", "Refaire la plaquette", "Rien de prévu sur Instagram", "À valider : « Rentrée »"]
      .map((x) => bloc.indexOf(x));
    expect([...ordre].sort((a, b) => a - b)).toEqual(ordre);
    // L'IA ne tranche pas : la liste du vendredi est à Jeanne.
    expect(bloc).toContain("tu ne tranches pas à sa place");
  });

  it("sans signal du lot 4 : rien de plus (ni titres vides, ni indicateurs)", () => {
    const bloc = blocTachesDuBrief(SANS_LOT4, ANCIEN);
    for (const x of ["INDICATEURS", "PANNES", "À TRANCHER", "SANS SUITE", "CHANTIERS", "CRÉATION"]) expect(bloc).not.toContain(x);
  });
});
