import { describe, it, expect } from "vitest";
import {
  creerLimiteur, decisionPublication, editionRelanceValidation, lireDecision, lireReglagesValidation,
  masquerEmail, nomPublic, relecteurParId, relecteursDe, relecteursPublics, statutApresDecisions, GRACE_VALIDATION_MIN,
} from "./validation-client";

const A = { nom: "Anne", email: "anne@client.fr" };
const B = { nom: "Bruno", email: "bruno@client.fr" };
const d = (email: string, decision: string, min = 0) => ({ relecteurEmail: email, decision, createdAt: new Date(Date.UTC(2026, 10, 23, 10, min)) });

describe("statutApresDecisions", () => {
  it("règle « un » : la première validation suffit", () => {
    expect(statutApresDecisions("un", [A, B], [])).toBe("a_valider");
    expect(statutApresDecisions("un", [A, B], [d(A.email, "validee")])).toBe("validee");
  });
  it("règle « tous » : chaque relecteur doit valider", () => {
    expect(statutApresDecisions("tous", [A, B], [d(A.email, "validee")])).toBe("a_valider");
    expect(statutApresDecisions("tous", [A, B], [d(A.email, "validee"), d(B.email, "validee", 1)])).toBe("validee");
  });
  it("un refus suffit à refuser, quelle que soit la règle", () => {
    expect(statutApresDecisions("un", [A, B], [d(A.email, "validee"), d(B.email, "refusee", 1)])).toBe("refusee");
    expect(statutApresDecisions("tous", [A, B], [d(A.email, "refusee")])).toBe("refusee");
  });
  it("seule la dernière décision d'un relecteur compte ; les commentaires ne décident rien", () => {
    expect(statutApresDecisions("tous", [A], [d(A.email, "refusee"), d(A.email, "validee", 2), d(A.email, "commentaire", 3)])).toBe("validee");
  });
  it("un relecteur hors liste ne compte pas (casse ignorée)", () => {
    expect(statutApresDecisions("un", [A], [d("intrus@x.fr", "validee")])).toBe("a_valider");
    expect(statutApresDecisions("un", [A], [d("ANNE@client.fr", "validee")])).toBe("validee");
  });
  it("« tous » sans relecteur : jamais validé", () => {
    expect(statutApresDecisions("tous", [], [d(A.email, "validee")])).toBe("a_valider");
  });
});

describe("editionRelanceValidation", () => {
  const avant = { id: 1, validationStatut: "validee", body: "texte", title: "T", mediaIds: [1, 2], scheduledFor: "2026-11-24T09:00:00.000Z" };
  it("texte, médias ou date modifiés → relance", () => {
    expect(editionRelanceValidation(avant, { body: "autre" })).toBe(true);
    expect(editionRelanceValidation(avant, { mediaIds: [2, 1] })).toBe(true);
    expect(editionRelanceValidation(avant, { scheduledFor: new Date("2026-11-25T09:00:00Z") })).toBe(true);
  });
  it("même valeur (date sous une autre forme comprise) ou autre champ → rien", () => {
    expect(editionRelanceValidation(avant, { body: "texte", scheduledFor: new Date("2026-11-24T09:00:00Z"), mediaIds: [1, 2] })).toBe(false);
    expect(editionRelanceValidation(avant, { pillar: "x" })).toBe(false);
  });
  it("hors validation → jamais", () => {
    expect(editionRelanceValidation({ ...avant, validationStatut: null }, { body: "autre" })).toBe(false);
  });
  it("refusé puis modifié → repasse à valider", () => {
    expect(editionRelanceValidation({ ...avant, validationStatut: "refusee" }, { title: "Nouveau" })).toBe(true);
  });
  it("options du post (commentaire, collaborateurs, alt, format, couverture, audio, document, fil) → relance", () => {
    const v = { ...avant, premierCommentaire: "a", collaborateurs: ["x"], texteAlternatif: "alt", postFormat: "reel",
      couvertureOffsetMs: 1000, couvertureUrl: "u", nomAudio: "son", linkedinDocument: false, reelDansLeFil: true };
    for (const patch of [{ premierCommentaire: "b" }, { collaborateurs: ["x", "y"] }, { texteAlternatif: "autre" }, { postFormat: "carousel" },
      { couvertureOffsetMs: 2000 }, { couvertureUrl: "v" }, { nomAudio: "autre" }, { linkedinDocument: true }, { reelDansLeFil: false }]) {
      expect(editionRelanceValidation(v, patch)).toBe(true);
    }
    expect(editionRelanceValidation(v, { collaborateurs: ["x"], premierCommentaire: "a", reelDansLeFil: true })).toBe(false);
  });
  it("compte : en changer relance, le poser la première fois (programmation) non", () => {
    expect(editionRelanceValidation({ ...avant, socialAccountId: 3 }, { socialAccountId: 4 })).toBe(true);
    expect(editionRelanceValidation({ ...avant, socialAccountId: null }, { socialAccountId: 4 })).toBe(false);
  });
});

describe("decisionPublication", () => {
  const heure = new Date("2026-11-23T10:00:00Z");
  const apres = (min: number) => new Date(heure.getTime() + min * 60_000);
  it("validation inactive ou post validé → publier", () => {
    expect(decisionPublication({ validationActive: false, statut: "a_valider", scheduledFor: heure, maintenant: heure }).action).toBe("publier");
    expect(decisionPublication({ validationActive: true, statut: "validee", scheduledFor: heure, maintenant: heure }).action).toBe("publier");
    expect(decisionPublication({ validationActive: true, statut: null, scheduledFor: heure, maintenant: heure }).action).toBe("publier");
  });
  it("à valider : attend pendant la grâce, puis échec « validation_manquante »", () => {
    expect(decisionPublication({ validationActive: true, statut: "a_valider", scheduledFor: heure, maintenant: apres(GRACE_VALIDATION_MIN - 1) }).action).toBe("attendre");
    expect(decisionPublication({ validationActive: true, statut: "a_valider", scheduledFor: heure, maintenant: apres(GRACE_VALIDATION_MIN) }))
      .toEqual({ action: "echec", raison: "validation_manquante" });
  });
  it("refusé : jamais publié, échec « validation_refusee » après la grâce", () => {
    expect(decisionPublication({ validationActive: true, statut: "refusee", scheduledFor: heure, maintenant: apres(10) }).action).toBe("attendre");
    expect(decisionPublication({ validationActive: true, statut: "refusee", scheduledFor: heure, maintenant: apres(200) }))
      .toEqual({ action: "echec", raison: "validation_refusee" });
  });
});

describe("lecture des corps", () => {
  it("réglages : emails normalisés et dédoublonnés, 10 relecteurs au plus, actif exige un relecteur", () => {
    expect(lireReglagesValidation({ actif: true, regle: "tous", relecteurs: [{ nom: " Anne ", email: "Anne@Client.fr" }, { nom: "", email: "anne@client.fr" }] }))
      .toEqual({ actif: true, regle: "tous", relecteurs: [{ nom: "Anne", email: "anne@client.fr" }] });
    expect(lireReglagesValidation({ actif: true, regle: "un", relecteurs: [] })).toBeNull();
    expect(lireReglagesValidation({ actif: false, regle: "un", relecteurs: [] })).toEqual({ actif: false, regle: "un", relecteurs: [] });
    expect(lireReglagesValidation({ actif: true, regle: "deux", relecteurs: [A] })).toBeNull();
    expect(lireReglagesValidation({ actif: true, regle: "un", relecteurs: [{ nom: "x", email: "pas-un-email" }] })).toBeNull();
    const onze = Array.from({ length: 11 }, (_, i) => ({ nom: `R${i}`, email: `r${i}@x.fr` }));
    expect(lireReglagesValidation({ actif: true, regle: "un", relecteurs: onze })).toBeNull();
  });
  it("relecteurs enregistrés relus défensivement", () => {
    expect(relecteursDe([{ nom: "", email: "A@x.fr" }, { email: 3 }, null])).toEqual([{ nom: "a@x.fr", email: "a@x.fr" }]);
    expect(relecteursDe("x")).toEqual([]);
  });
  it("décision : commentaire ≤ 2000, commentaire seul jamais vide", () => {
    expect(lireDecision({ relecteurEmail: "A@x.fr", decision: "validee" })).toEqual({ relecteurEmail: "a@x.fr", decision: "validee", commentaire: null });
    expect(lireDecision({ relecteurEmail: "a@x.fr", decision: "commentaire", commentaire: "  " })).toBeNull();
    expect(lireDecision({ relecteurEmail: "a@x.fr", decision: "refusee", commentaire: "x".repeat(2001) })).toBeNull();
    expect(lireDecision({ relecteurEmail: "a@x.fr", decision: "publier" })).toBeNull();
  });
});

describe("creerLimiteur", () => {
  it("bloque au-delà de la limite dans la fenêtre, puis rouvre", () => {
    const ok = creerLimiteur(2, 1000);
    expect(ok("t", 0)).toBe(true);
    expect(ok("t", 10)).toBe(true);
    expect(ok("t", 20)).toBe(false);
    expect(ok("autre", 20)).toBe(true);
    expect(ok("t", 1500)).toBe(true);
  });
});

describe("portail public : pas d'adresse en clair", () => {
  const idDe = (e: string) => `id-${e.length}-${e[0]}`;
  it("masquerEmail", () => {
    expect(masquerEmail("claire@domaine.fr")).toBe("c***@d***.fr");
    expect(masquerEmail("x@localhost")).toBe("x***@l***");
  });
  it("relecteursPublics : nom seul ; homonymes et sans nom départagés par l'adresse masquée", () => {
    const l = [{ nom: "Anne", email: "anne@a.fr" }, { nom: "anne", email: "anne@b.com" }, { nom: "Bruno", email: "b@c.fr" }, { nom: "d@e.fr", email: "d@e.fr" }];
    expect(relecteursPublics(l, idDe).map((r) => r.nom)).toEqual(["Anne (a***@a***.fr)", "anne (a***@b***.com)", "Bruno", "d***@e***.fr"]);
  });
  it("relecteurParId et nomPublic", () => {
    const l = [{ nom: "Anne", email: "anne@a.fr" }];
    const id = (e: string) => `h:${e}`;
    expect(relecteurParId(l, "h:anne@a.fr", id)).toEqual(l[0]);
    expect(relecteurParId(l, "anne@a.fr", id)).toBeNull();
    expect(relecteurParId(l, 3, id)).toBeNull();
    expect(nomPublic(l, "ANNE@a.fr", id)).toBe("Anne");
    expect(nomPublic(l, "parti@x.fr", id)).toBe("p***@x***.fr");
  });
});
