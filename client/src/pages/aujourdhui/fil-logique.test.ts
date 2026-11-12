import { describe, it, expect, vi } from "vitest";
import fr from "@/locales/fr";
import en from "@/locales/en";
import type { LienFil } from "@shared/fil";
import {
  ajouter, ajustementPret, cleErreurFil, codeErreur, corpsAjustement, corpsRefaire, deplacer, etapesDeProposition,
  grouperParObjectif, objectifPeutRecevoirEtapes, renommer, supprimer, texteLien, type EtapeEditable, type PropositionFil,
  cleErreurAnnulation, texteNonRattachees, texteNonRemises, chargerMatinFil,
  textePanne, detailIndicateur, joursTravaillesApres, corpsTrancher, cleErreurTrancher,
} from "./fil-logique";
import { ligneIndicateurs, type Indicateur } from "@shared/fil";
import { annulationOuverte, resumeMatin, validationIncomplete } from "./logique";
import type { MatinFil } from "@shared/fil";
// Le miroir mobile (sans traductions) doit dire exactement la même chose en français.
import * as mobile from "../../../../mobile/lib/fil-logique";

const lire = (o: any, cle: string) => cle.split(".").reduce((x, k) => x?.[k], o);
// Un t minimal sur le dictionnaire : clé pointée et interpolation {{x}}.
const tDe = (dico: any) => (cle: string, opts?: Record<string, unknown>) =>
  String(lire(dico, cle) ?? cle).replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts?.[k] ?? ""));
const t = tDe(fr);

const lien = (p: Partial<LienFil> = {}): LienFil => ({
  objectifId: 1, objectifTitre: "Signer des clients", etapeId: 10, etapeTitre: "être visible sur LinkedIn",
  etapeFaites: 3, etapePrevues: 7, cible: "3 nouveaux clients d'ici fin décembre", ...p,
});

describe("texteLien", () => {
  it("étape avec avancement, puis l'objectif par sa cible", () => {
    expect(texteLien(lien(), t)).toBe("Étape : être visible sur LinkedIn, 3 tâches sur 7 faites. Objectif : 3 nouveaux clients d'ici fin décembre");
  });
  it("sans étape : l'objectif seul (son titre quand il n'a pas de cible)", () => {
    expect(texteLien(lien({ etapeId: null, etapeTitre: null, etapeFaites: 0, etapePrevues: 0 }), t)).toBe("Objectif : 3 nouveaux clients d'ici fin décembre");
    expect(texteLien(lien({ etapeId: null, etapeTitre: null, cible: null }), t)).toBe("Objectif : Signer des clients");
  });
  it("étape sans tâche prévue : jamais « 0 sur 0 »", () => {
    const s = texteLien(lien({ etapeFaites: 0, etapePrevues: 0 }), t);
    expect(s).toBe("Étape : être visible sur LinkedIn. Objectif : 3 nouveaux clients d'ici fin décembre");
    expect(s).not.toMatch(/0 sur 0/);
  });
  it("une seule tâche faite : au singulier", () => {
    expect(texteLien(lien({ etapeFaites: 1 }), t)).toContain("1 tâche sur 7 faite.");
  });
  it("le mobile écrit le même texte que le web", () => {
    for (const l of [lien(), lien({ etapeFaites: 1 }), lien({ etapeFaites: 0, etapePrevues: 0 }),
      lien({ etapeId: null, etapeTitre: null }), lien({ etapeId: null, etapeTitre: null, cible: null })]) {
      expect(mobile.texteLien(l)).toBe(texteLien(l, t));
    }
  });
  it("en anglais aussi", () => {
    expect(texteLien(lien(), tDe(en))).toBe("Step: être visible sur LinkedIn, 3 of 7 tasks done. Goal: 3 nouveaux clients d'ici fin décembre");
  });
});

describe("ajuster la liste", () => {
  const depart: EtapeEditable[] = [
    { titre: "Poser l'offre", pourquoi: "Sans offre claire, rien ne convertit.", etat: "faite" },
    { titre: "Être visible sur LinkedIn", pourquoi: "Tes clients y sont.", etat: "en_cours" },
    { titre: "Relancer les contacts chauds", pourquoi: "Ils te connaissent déjà.", etat: "a_venir" },
    { titre: "Signer", pourquoi: "Le but.", etat: "a_venir" },
  ];

  it("renommer, réordonner, supprimer, ajouter : la liste part telle quelle à « ajuster »", () => {
    let l = renommer(depart, 2, "Relancer 10 contacts chauds");
    l = deplacer(l, 3, -1); // « Signer » remonte d'un cran
    l = supprimer(l, 0);
    l = ajouter(l);
    l = renommer(l, 3, "Demander des recommandations");
    const attendu = [
      depart[1],
      depart[3],
      { ...depart[2], titre: "Relancer 10 contacts chauds" },
      { titre: "Demander des recommandations", pourquoi: "", etat: "a_venir" },
    ];
    expect(l).toEqual(attendu);
    expect(corpsAjustement(l)).toEqual({ etapes: attendu });
    expect(depart[0].titre).toBe("Poser l'offre"); // jamais modifiée en place
  });

  it("« Refaire » : un seul appel qui nomme la proposition remplacée, note seulement si elle dit quelque chose", () => {
    expect(corpsRefaire(5, "  plus court ")).toEqual({ remplace: 5, note: "plus court" });
    expect(corpsRefaire(5, "   ")).toEqual({ remplace: 5 });
    expect(mobile.corpsRefaire(5, "  plus court ")).toEqual(corpsRefaire(5, "  plus court "));
    expect(mobile.corpsRefaire(5, "")).toEqual(corpsRefaire(5, ""));
  });

  it("déplacer hors des bornes ne change rien", () => {
    expect(deplacer(depart, 0, -1)).toEqual(depart);
    expect(deplacer(depart, 3, 1)).toEqual(depart);
  });

  it("prête à envoyer : 3 à 6 étapes, toutes titrées", () => {
    expect(ajustementPret(depart)).toBe(true);
    expect(ajustementPret(depart.slice(0, 2))).toBe(false);
    expect(ajustementPret(ajouter(ajouter(ajouter(depart))))).toBe(false); // 7
    expect(ajustementPret(renommer(depart, 1, "   "))).toBe(false);
  });

  it("étapes d'une proposition : lues dans ses arguments, nettoyées", () => {
    const p = { arguments: { objectifId: 1, etapes: [{ titre: "A", pourquoi: "x", etat: "faite" }, { titre: "B", etat: "zzz" }, null] } } as unknown as PropositionFil;
    expect(etapesDeProposition(p)).toEqual([
      { titre: "A", pourquoi: "x", etat: "faite" },
      { titre: "B", pourquoi: "", etat: "a_venir" },
    ]);
  });
});

describe("erreurs", () => {
  it("code lu dans l'erreur d'apiRequest (« 409: {…} »)", () => {
    expect(codeErreur(new Error('409: {"message":"ordre_etats"}'))).toBe("ordre_etats");
    expect(codeErreur(new Error('429: {"message":"ai_monthly_limit_reached"}'))).toBe("ai_monthly_limit_reached");
    expect(codeErreur(new Error("500: oups"))).toBeNull();
    expect(codeErreur("zzz")).toBeNull();
  });
  it("chaque code connu a un message en français et en anglais ; inconnu : message générique", () => {
    for (const c of ["nombre_etapes", "ordre_etats", "titre_invalide", "etat_invalide", "chaine_en_cours", "deja_en_attente",
      "generation_impossible", "objectif_inactif", "introuvable", "expiree", "deja_traitee", "ai_monthly_limit_reached"]) {
      const cle = cleErreurFil(c);
      expect(cle).not.toBe("filConducteur.erreurs.erreur");
      expect(typeof lire(fr, cle)).toBe("string");
      expect(typeof lire(en, cle)).toBe("string");
    }
    expect(cleErreurFil("zzz")).toBe("filConducteur.erreurs.erreur");
    expect(cleErreurFil(null)).toBe("filConducteur.erreurs.erreur");
    // Mobile : mêmes messages en français, lus dans la réponse axios.
    expect(mobile.messageErreurFil({ response: { status: 409, data: { message: "ordre_etats" } } })).toBe(fr.filConducteur.erreurs.ordre_etats);
    expect(mobile.messageErreurFil(new Error("réseau"))).toBe(fr.filConducteur.erreurs.erreur);
  });
});

describe("page projet", () => {
  const objectifs = [
    { id: 1, title: "Signer", status: "active" },
    { id: 2, title: "Visible", status: "active" },
    { id: 3, title: "Vieux", status: "completed" },
  ];
  const jalons = [
    { id: 10, goalId: 1, status: "completed" }, { id: 11, goalId: 1, status: "active" },
    { id: 20, goalId: 2, status: "completed" },
    { id: 30, goalId: null, status: "unlocked" },
    { id: 40, goalId: 3, status: "completed" },
  ];

  it("étapes groupées par objectif actif ; le reste en chaîne de projet", () => {
    const g = grouperParObjectif(jalons, objectifs);
    expect(g.groupes.map((x) => [x.objectif.id, x.jalons.map((j) => j.id)])).toEqual([[1, [10, 11]], [2, [20]]]);
    expect(g.sansObjectif.map((j) => j.id)).toEqual([30, 40]);
    expect(mobile.grouperParObjectif(jalons, objectifs)).toEqual(g); // miroir mobile
  });

  it("« Proposer des étapes » : objectif actif, sans étape ouverte, sans proposition en attente", () => {
    const enAttente = [{ outil: "proposer_etapes", objectif: { id: 2, titre: "Visible", projetId: 7 } }] as unknown as PropositionFil[];
    // Le mobile décide exactement pareil.
    for (const o of objectifs) for (const p of [[], enAttente]) {
      expect(mobile.objectifPeutRecevoirEtapes(o, jalons, p as any)).toBe(objectifPeutRecevoirEtapes(o, jalons, p));
    }
    expect(objectifPeutRecevoirEtapes(objectifs[0], jalons, [])).toBe(false); // étape 11 ouverte
    expect(objectifPeutRecevoirEtapes(objectifs[1], jalons, [])).toBe(true);  // toutes franchies
    expect(objectifPeutRecevoirEtapes(objectifs[1], jalons, enAttente)).toBe(false);
    expect(objectifPeutRecevoirEtapes(objectifs[2], jalons, [])).toBe(false); // pas actif
  });
});

describe("le matin", () => {
  const cle = { tacheId: 1, titre: "Relancer Léa", pourquoi: "Elle attend ta proposition.", lien: lien(), score: 80 };
  const oubli = { objectifId: 4, titre: "Lancer le podcast", joursSansTache: 9, reprise: { titre: "20 min sur le pilote", pourquoi: "Un premier pas remet le podcast en route." } };
  const matin = (p: Partial<MatinFil> = {}): MatinFil => ({
    tachesCles: [cle], objectifsOublies: [], allegement: null, nonRattachees: 0, rienNeCloche: false, ...p,
  });

  it("la phrase unique : « Rien ne cloche », avec la première tâche clé", () => {
    const r = resumeMatin(matin({ rienNeCloche: true }));
    expect(t(r.phraseUnique!, { titre: cle.titre })).toBe("Rien ne cloche ce matin. Commence par « Relancer Léa ».");
  });

  it("le mobile montre les mêmes sections et dit la même phrase", () => {
    for (const f of [matin({ rienNeCloche: true }), matin({ objectifsOublies: [oubli] }),
      matin({ tachesCles: [], nonRattachees: 3 }),
      matin({ objectifsOublies: [oubli], allegement: { propositionId: 2 }, nonRattachees: 1 })]) {
      const web = resumeMatin(f);
      const mob = mobile.resumeMatin(f);
      expect(mob.sections).toEqual(web.sections);
      expect(mob.phraseUnique).toBe(web.phraseUnique ? t(web.phraseUnique, { titre: f.tachesCles[0]?.titre }) : null);
    }
  });

  it("tâches non rattachées et tâches non remises : une ligne, au singulier comme au pluriel, même texte sur mobile", () => {
    expect(texteNonRattachees(1, t)).toBe("1 tâche du jour n'est rattachée à aucun objectif.");
    expect(texteNonRattachees(3, t)).toBe("3 tâches du jour ne sont rattachées à aucun objectif.");
    expect(texteNonRemises(2, t)).toBe("2 tâches que tu as déplacées entre-temps restent où tu les as mises.");
    for (const n of [1, 2, 5]) {
      expect(mobile.texteNonRattachees(n)).toBe(texteNonRattachees(n, t));
      expect(mobile.texteNonRemises(n)).toBe(texteNonRemises(n, t));
      expect(typeof lire(en, n < 2 ? "filConducteur.matin.nonRattacheesUn" : "filConducteur.matin.nonRattachees")).toBe("string");
    }
  });

  it("annulation : 24 h, mêmes bornes sur mobile ; ses refus ont leur message, les autres passent par le fil", () => {
    const valideA = "2026-11-12T08:00:00.000Z";
    for (const h of ["2026-11-12T20:00:00.000Z", "2026-11-13T08:00:00.000Z"]) {
      expect(mobile.annulationOuverte(valideA, new Date(h))).toBe(annulationOuverte(valideA, new Date(h)));
    }
    for (const c of ["expiree", "deja_annulee", "modifiee"]) {
      expect(typeof lire(fr, cleErreurAnnulation(c))).toBe("string");
      expect(typeof lire(en, cleErreurAnnulation(c))).toBe("string");
      expect(mobile.messageErreurAnnulation({ response: { data: { message: c } } })).toBe(t(cleErreurAnnulation(c)));
    }
    expect(cleErreurAnnulation("introuvable")).toBe(cleErreurFil("introuvable"));
    expect(mobile.messageErreurAnnulation(new Error("réseau"))).toBe(fr.filConducteur.erreurs.erreur);
  });
});

describe("chargerMatinFil", () => {
  const rep = (status: number, corps: unknown = null) => ({ status, ok: status < 300, json: async () => corps }) as unknown as Response;

  it("hors interrupteur : un seul GET (404), puis plus aucune requête", async () => {
    const recuperer = vi.fn(async () => rep(404));
    const premier = await chargerMatinFil(undefined, recuperer);
    expect(premier).toEqual({ actif: false, fil: null });
    expect(await chargerMatinFil(premier, recuperer)).toEqual({ actif: false, fil: null });
    expect(recuperer).toHaveBeenCalledTimes(1);
  });
  it("sous interrupteur : le fil ; une erreur serveur remonte", async () => {
    const fil = { tachesCles: [], objectifsOublies: [], allegement: null, nonRattachees: 0, rienNeCloche: false };
    expect(await chargerMatinFil(undefined, async () => rep(200, fil))).toEqual({ actif: true, fil });
    expect(await chargerMatinFil({ actif: true, fil }, async () => rep(200, fil))).toEqual({ actif: true, fil });
    await expect(chargerMatinFil(undefined, async () => rep(500))).rejects.toThrow("500");
  });
});

describe("le matin sur mobile : mêmes mots que le web", () => {
  const m = mobile.TEXTES_MATIN;
  it("chaque texte du mobile est celui de fr.filConducteur.matin", () => {
    expect(m.titre).toBe(t("filConducteur.matin.titre"));
    expect(m.oublis.titre).toBe(t("filConducteur.matin.oublis.titre"));
    expect(m.oublis.ligne("Podcast", 9)).toBe(t("filConducteur.matin.oublis.ligne", { objectif: "Podcast", jours: 9 }));
    expect(m.oublis.reprise("20 min")).toBe(t("filConducteur.matin.oublis.reprise", { titre: "20 min" }));
    for (const k of ["reprendre", "enCours", "fait"] as const) expect(m.oublis[k]).toBe(t(`filConducteur.matin.oublis.${k}`));
    for (const k of ["titre", "chapo", "alleger", "pasAujourdhui", "incomplet", "fait", "annuler", "annulee"] as const) {
      expect(m.allegement[k]).toBe(t(`filConducteur.matin.allegement.${k}`));
    }
  });
  it("validation incomplète : même décision", () => {
    for (const r of [{ actionId: 1 }, { actionId: 1, echecs: [1] }, {}, null]) {
      expect(mobile.validationIncomplete(r as any)).toBe(validationIncomplete(r as any));
    }
  });
});

// ── Le lot 4 au matin (spec §8) ──────────────────────────────────────────────────────────

describe("le lot 4 au matin", () => {
  const MAINTENANT = new Date("2026-11-13T08:00:00.000Z");

  it("une panne dit son nom et son dernier passage réussi, ou qu'il n'y en a pas", () => {
    const nom = "Veille des appels d'offres";
    expect(textePanne({ nom, dernierSucces: "2026-11-12T22:00:00.000Z" }, MAINTENANT, t))
      .toBe("Veille des appels d'offres : dernier passage réussi il y a 10 h.");
    expect(textePanne({ nom, dernierSucces: "2026-11-10T07:00:00.000Z" }, MAINTENANT, t))
      .toBe("Veille des appels d'offres : dernier passage réussi il y a 3 jours.");
    expect(textePanne({ nom, dernierSucces: "2026-11-13T07:30:00.000Z" }, MAINTENANT, t))
      .toBe("Veille des appels d'offres : dernier passage réussi il y a moins d'une heure.");
    expect(textePanne({ nom, dernierSucces: null }, MAINTENANT, t))
      .toBe("Veille des appels d'offres : aucun passage réussi depuis le début du suivi.");
    // Une date illisible : on ne dit pas « il y a NaN jours ».
    expect(textePanne({ nom, dernierSucces: "n'importe quoi" }, MAINTENANT, t)).toBe(textePanne({ nom, dernierSucces: null }, MAINTENANT, t));
  });

  it("le détail d'un indicateur : sa valeur et son sens, la valeur précédente, ou « indisponible » avec la raison", () => {
    expect(detailIndicateur({ cle: "prospection_envois_4s", libelle: "Messages envoyés", valeur: 42, precedente: 30 }, t))
      .toEqual({ valeur: "42 ↑", avant: "avant : 30" });
    expect(detailIndicateur({ cle: "pipeline_signes", libelle: "Clients signés", valeur: "1 / 2", precedente: null }, t))
      .toEqual({ valeur: "1 / 2", avant: null });
    expect(detailIndicateur({ cle: "prospection_rdv_4s", libelle: "Rendez-vous", valeur: null, precedente: 2, indisponible: "agenda non relié" }, t))
      .toEqual({ valeur: "indisponible (agenda non relié)", avant: "avant : 2" });
    // Jamais un chiffre inventé : sans valeur, c'est « indisponible », même sans raison.
    expect(detailIndicateur({ cle: "x", libelle: "X", valeur: null, precedente: null }, t)).toEqual({ valeur: "indisponible", avant: null });
  });

  it("déplacer : les prochains jours ouvrés, le lendemain ouvré d'abord (vendredi → lundi)", () => {
    expect(joursTravaillesApres("2026-11-13", 3)).toEqual(["2026-11-16", "2026-11-17", "2026-11-18"]);
    expect(joursTravaillesApres("2026-11-11", 2)).toEqual(["2026-11-12", "2026-11-13"]);
    expect(joursTravaillesApres("2026-11-14", 1)).toEqual(["2026-11-16"]); // samedi
  });

  it("le corps de POST /api/fil/trancher : la date seulement pour « déplacer »", () => {
    expect(corpsTrancher(9, "faire")).toEqual({ tacheId: 9, geste: "faire" });
    expect(corpsTrancher(9, "abandonner", "2026-11-16")).toEqual({ tacheId: 9, geste: "abandonner" });
    expect(corpsTrancher(9, "deplacer", "2026-11-16")).toEqual({ tacheId: 9, geste: "deplacer", date: "2026-11-16" });
  });

  it("les refus de trancher ont leur message, en français et en anglais ; les autres passent par le fil", () => {
    for (const c of ["deja_tranchee", "date_passee", "task_not_found"]) {
      expect(typeof lire(fr, cleErreurTrancher(c))).toBe("string");
      expect(typeof lire(en, cleErreurTrancher(c))).toBe("string");
    }
    expect(cleErreurTrancher("autre")).toBe(cleErreurFil("autre"));
  });

  describe("le mobile dit la même chose", () => {
    const ind: Indicateur[] = [
      { cle: "prospection_envois_4s", libelle: "Messages envoyés", valeur: 42, precedente: 30 },
      { cle: "prospection_reponses_4s", libelle: "Réponses", valeur: 5, precedente: 5 },
      { cle: "prospection_rdv_4s", libelle: "Rendez-vous", valeur: null, precedente: 1, indisponible: "agenda non relié" },
      { cle: "pipeline_signes", libelle: "Clients signés", valeur: "1 / 2", precedente: "0 / 2" },
      { cle: "audience_abonnes_7", libelle: "Abonnés Instagram JMD", valeur: 1200, precedente: 1250 },
      { cle: "audience_posts_4s_7", libelle: "Posts publiés Instagram JMD (4 sem.)", valeur: 8, precedente: 6 },
      { cle: "ao_a_venir", libelle: "Appels d'offres à venir", valeur: 3, precedente: null },
    ];

    it("ligneIndicateurs : même ligne, même coupe à 140 caractères", () => {
      expect(mobile.ligneIndicateurs(ind)).toBe(ligneIndicateurs(ind));
      const long = Array.from({ length: 30 }, (_, i) => ({ ...ind[0], valeur: 1000 + i }));
      expect(mobile.ligneIndicateurs(long)).toBe(ligneIndicateurs(long));
      expect(mobile.ligneIndicateurs([])).toBe("");
    });

    it("le détail, les pannes, les jours ouvrés et les refus", () => {
      for (const i of ind) expect(mobile.detailIndicateur(i)).toEqual(detailIndicateur(i, t));
      for (const d of [null, "2026-11-12T22:00:00.000Z", "2026-11-10T07:00:00.000Z", "2026-11-13T07:30:00.000Z"]) {
        expect(mobile.textePanne({ nom: "Envoi de prospection", dernierSucces: d }, MAINTENANT)).toBe(textePanne({ nom: "Envoi de prospection", dernierSucces: d }, MAINTENANT, t));
      }
      expect(mobile.joursTravaillesApres("2026-11-13", 5)).toEqual(joursTravaillesApres("2026-11-13", 5));
      expect(mobile.corpsTrancher(9, "deplacer", "2026-11-16")).toEqual(corpsTrancher(9, "deplacer", "2026-11-16"));
      for (const c of ["deja_tranchee", "date_passee", "task_not_found"]) {
        expect(mobile.messageErreurTrancher({ response: { data: { message: c } } })).toBe(t(cleErreurTrancher(c)));
      }
      expect(mobile.messageErreurTrancher(new Error("réseau"))).toBe(fr.filConducteur.erreurs.erreur);
    });

    it("un lien du matin mène à l'écran mobile qui le montre, sinon au web", () => {
      expect(mobile.routeMobileDuLien("/outreach?onglet=reponses&conversation=31")).toBe("/conversation/31");
      expect(mobile.routeMobileDuLien("/outreach")).toBe("/prospection");
      expect(mobile.routeMobileDuLien("/atelier?semaine=2026-11-09")).toBe("/(tabs)/content");
      expect(mobile.routeMobileDuLien("/planning")).toBe("/(tabs)/calendar");
      expect(mobile.routeMobileDuLien("/appels-offres")).toBeNull();
      expect(mobile.routeMobileDuLien("/campaigns")).toBeNull();
    });

    it("mêmes sections, dans le même ordre, pour chaque jour de fixture", () => {
      const base: MatinFil = { tachesCles: [], objectifsOublies: [], allegement: null, nonRattachees: 0, rienNeCloche: false };
      const fixtures: MatinFil[] = [
        { ...base, pannes: [{ nom: "Revue du matin", dernierSucces: null }], chantiersBloques: [{ libelle: "A", joursSansMouvement: 15, prochainPas: "B" }] },
        { ...base, cloture: [{ tacheId: 1, titre: "Plaquette", ouverteDepuis: 9 }], creation: { alertes: ["x"], aValider: [{ libelle: "y", lien: "/atelier" }] } },
        { ...base, reconciliation: [{ source: "mails", libelle: "Mail", lien: "/planning" }], indicateurs: ind },
        { ...base, rienNeCloche: true, indicateurs: ind },
      ];
      for (const f of fixtures) {
        const web = resumeMatin(f), mob = mobile.resumeMatin(f);
        expect(mob.sections).toEqual(web.sections);
        expect(mob.indicateurs).toBe(web.indicateurs);
      }
    });

    it("chaque texte du lot 4 sur mobile est celui de fr.filConducteur.matin", () => {
      const m = mobile.TEXTES_MATIN;
      for (const k of ["titre", "voirDetail", "masquerDetail"] as const) expect(m.indicateurs[k]).toBe(t(`filConducteur.matin.indicateurs.${k}`));
      expect(m.pannes.titre).toBe(t("filConducteur.matin.pannes.titre"));
      expect(m.reconciliation.titre).toBe(t("filConducteur.matin.reconciliation.titre"));
      expect(m.reconciliation.chapo).toBe(t("filConducteur.matin.reconciliation.chapo"));
      expect(m.chantiers.titre).toBe(t("filConducteur.matin.chantiers.titre"));
      expect(m.chantiers.ligne("Être visible (JMD)", 16)).toBe(t("filConducteur.matin.chantiers.ligne", { libelle: "Être visible (JMD)", jours: 16 }));
      expect(m.chantiers.prochainPas("Écrire le post")).toBe(t("filConducteur.matin.chantiers.prochainPas", { pas: "Écrire le post" }));
      for (const k of ["titre", "chapo", "faire", "deplacer", "abandonner", "valider", "retour", "enCours", "faite", "deplacee", "abandonnee"] as const) {
        expect(m.cloture[k]).toBe(t(`filConducteur.matin.cloture.${k}`));
      }
      expect(m.cloture.ouverteDepuis(12)).toBe(t("filConducteur.matin.cloture.ouverteDepuis", { n: 12 }));
      expect(m.creation.alertesTitre).toBe(t("filConducteur.matin.creation.alertesTitre"));
      expect(m.creation.aValiderTitre).toBe(t("filConducteur.matin.creation.aValiderTitre"));
    });
  });

  it("chaque clé du lot 4 existe aussi en anglais", () => {
    const cles = (o: any, pre = ""): string[] => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? cles(v, `${pre}${k}.`) : [`${pre}${k}`]));
    for (const bloc of ["indicateurs", "pannes", "reconciliation", "chantiers", "cloture", "creation"]) {
      expect(cles((en as any).filConducteur.matin[bloc])).toEqual(cles((fr as any).filConducteur.matin[bloc]));
    }
  });
});
