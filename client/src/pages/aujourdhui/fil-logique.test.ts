import { describe, it, expect } from "vitest";
import fr from "@/locales/fr";
import en from "@/locales/en";
import type { LienFil } from "@shared/fil";
import {
  ajouter, ajustementPret, cleErreurFil, codeErreur, corpsAjustement, corpsRefaire, deplacer, etapesDeProposition,
  grouperParObjectif, objectifPeutRecevoirEtapes, renommer, supprimer, texteLien, type EtapeEditable, type PropositionFil,
  cleErreurAnnulation, texteNonRattachees, texteNonRemises,
} from "./fil-logique";
import { annulationOuverte, resumeMatin } from "./logique";
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
      matin({ rienNeCloche: true, allegement: { propositionId: 2 } }), matin({ tachesCles: [], nonRattachees: 3 }),
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
