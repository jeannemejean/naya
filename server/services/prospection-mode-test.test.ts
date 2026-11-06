// Mode test de la prospection — logique pure + orchestration, dépendances injectées.
// Aucune base, aucun réseau : toutes les dépendances sont des fonctions simulées.
import { describe, it, expect, vi } from "vitest";
import {
  envoyerEmailTest, lireDemandeTest, estLeadTest, sansLeadsTest, briefDeTest, texteDeSecours,
  TAG_LEAD_TEST, type DepsModeTest,
} from "./prospection-mode-test";

const CAMPAGNE = {
  id: 7, userId: "u1", projectId: 3, name: "Vignerons", messageAngle: "Leur visibilité hors saison",
  offer: "Un audit de leur présence en ligne", campaignBrief: "Aider les domaines à vendre en direct",
};
const GMAIL = { via: "unipile" as const, accountId: "acc-gm", fromEmail: "jeanne@agence.fr", fromName: "Jeanne Mejean", footerAddress: "Lyon" };

function deps(over: Partial<DepsModeTest> = {}) {
  const claims: any[] = [];
  const d: DepsModeTest = {
    now: () => new Date("2026-11-05T21:30:00Z"), // hors fenêtre : le test part quand même
    getCampaign: vi.fn(async () => CAMPAGNE),
    getSteps: vi.fn(async () => [
      { id: 1, channel: "linkedin", intention: "Invitation" },
      { id: 2, channel: "email", intention: "Ouvrir sur la visibilité" },
      { id: 3, channel: "email", intention: "Relance" },
    ]),
    envoiActif: () => true,
    receptionActive: () => true,
    identite: vi.fn(async () => ({ portee: null, identite: { email: { deconnecte: false } as any, linkedin: null, signature: null } })),
    resolveSender: vi.fn(() => GMAIL),
    adressesPropres: vi.fn(async () => ["jeanne@agence.fr", "jeanne.gmail@gmail.com"]),
    emailsEnvoyesDepuis: vi.fn(async () => 3),
    adresseDeVraiProspect: vi.fn(async () => false),
    testsCreesDepuis: vi.fn(async () => 0),
    plafondQuotidien: 80,
    signature: vi.fn(async () => "Jeanne"),
    createLead: vi.fn(async (row: any) => ({ id: 42, ...row })),
    archiverLead: vi.fn(async () => 1),
    estDesinscrit: vi.fn(async () => false),
    lienDesinscription: vi.fn(() => "https://hellonaya.app/desinscription/abc"),
    iaBloquee: vi.fn(async () => false),
    rediger: vi.fn(async () => ({ subject: "Votre domaine en hiver", body: "Bonjour Claire,\n\nUne idée.\n\nC'est un sujet ?" })),
    consignes: vi.fn(async () => "Phrases courtes"),
    roleTouche: vi.fn(() => "email_ouverture" as const),
    retirerSignature: vi.fn((b: string) => b),
    envoyer: vi.fn(async () => ({ ok: true, providerId: "pm-1", threadId: "th-1" })),
    claimStore: {
      claim: vi.fn(async (k: any) => { claims.push(["claim", k]); return true; }),
      markSent: vi.fn(async (k: any, s: any) => { claims.push(["sent", k, s]); }),
      release: vi.fn(async (k: any) => { claims.push(["release", k]); }),
    },
    journaliser: vi.fn(async () => ({ id: 900 })),
    setProviderIds: vi.fn(async () => {}),
    terminerSequence: vi.fn(async () => {}),
    ...over,
  };
  return { d, claims };
}

describe("lireDemandeTest", () => {
  it("exige une adresse valide", () => {
    expect(lireDemandeTest({})).toEqual({ ok: false, code: "email_invalide" });
    expect(lireDemandeTest({ email: "pas-une-adresse" })).toEqual({ ok: false, code: "email_invalide" });
    expect(lireDemandeTest({ email: "a@b" })).toEqual({ ok: false, code: "email_invalide" });
  });
  it("nom facultatif, « Test » par défaut", () => {
    expect(lireDemandeTest({ email: " claire@exemple.fr " })).toEqual({ ok: true, demande: { nom: "Test", email: "claire@exemple.fr" } });
    expect(lireDemandeTest({ email: "claire@exemple.fr", nom: "  Claire   Dubois " })).toEqual({ ok: true, demande: { nom: "Claire Dubois", email: "claire@exemple.fr" } });
  });
});

describe("marquage des prospects test", () => {
  it("estLeadTest lit leads.tags", () => {
    expect(estLeadTest({ tags: [TAG_LEAD_TEST] })).toBe(true);
    expect(estLeadTest({ tags: ["autre"] })).toBe(false);
    expect(estLeadTest({ tags: null })).toBe(false);
    expect(estLeadTest(undefined)).toBe(false);
  });
  it("sansLeadsTest retire les prospects test", () => {
    expect(sansLeadsTest([{ id: 1, tags: [TAG_LEAD_TEST] }, { id: 2, tags: null }]).map((l) => l.id)).toEqual([2]);
  });
});

describe("briefDeTest / texteDeSecours", () => {
  it("brief tiré de la campagne seule, actionnable (déclencheur présent)", () => {
    const b = briefDeTest(CAMPAGNE);
    expect(b.declencheur?.fait).toBe("Leur visibilité hors saison");
    expect(b.declencheur?.source).toBe("mode_test");
    expect(b.preuveId).toBeNull();
    expect(b.proposition.contenu).toBe("Un audit de leur présence en ligne");
  });
  it("brief sur une campagne vide : un déclencheur quand même", () => {
    expect(briefDeTest({}).declencheur?.fait).toBe("Premier contact");
  });
  it("texte de secours en français, tutoiement, avec le prénom", () => {
    const s = texteDeSecours("Claire Dubois", "Vignerons");
    expect(s.subject).toBeTruthy();
    expect(s.body).toMatch(/^Bonjour Claire,/);
    expect(s.body).toContain("« Vignerons »");
    expect(s.body).toContain("onglet Réponses");
  });
});

describe("envoyerEmailTest", () => {
  it("crée un prospect test, rédige avec le vrai rédacteur, envoie tout de suite et termine la séquence", async () => {
    const { d, claims } = deps();
    const r = await envoyerEmailTest(d, "u1", 7, { nom: "Claire", email: "claire@exemple.fr" });
    expect(r).toEqual({ ok: true, leadId: 42, subject: "Votre domaine en hiver", body: "Bonjour Claire,\n\nUne idée.\n\nC'est un sujet ?", secours: false });

    expect(d.createLead).toHaveBeenCalledWith(expect.objectContaining({
      userId: "u1", projectId: 3, prospectionCampaignId: 7, name: "Claire", email: "claire@exemple.fr",
      tags: [TAG_LEAD_TEST], stage: "connection_sent",
    }));
    // Pas de validation, pas d'audit : rien de tel n'est posé sur le prospect.
    const row = (d.createLead as any).mock.calls[0][0];
    expect(row.validatedAt).toBeUndefined();
    expect(row.auditNotes).toBeUndefined();

    // Rédacteur réel : première touche EMAIL de la séquence, brief de la campagne, rang 0.
    const a = (d.rediger as any).mock.calls[0][1];
    expect(a.canal).toBe("email");
    expect(a.rang).toBe(0);
    expect(a.intention).toBe("Ouvrir sur la visibilité");
    expect(a.brief.declencheur.source).toBe("mode_test");
    expect(a.founderName).toBe("Jeanne");
    expect(a.instructions).toBe("Phrases courtes");
    expect(d.roleTouche).toHaveBeenCalledWith(expect.any(Array), 1);

    // Même chemin d'envoi que le worker : étape 1, lien de désinscription.
    expect(d.envoyer).toHaveBeenCalledWith(GMAIL, expect.objectContaining({
      to: "claire@exemple.fr", toName: "Claire", leadId: 42, stepOrder: 1,
      lienDesinscription: "https://hellonaya.app/desinscription/abc",
    }));
    // Journalisé comme un vrai envoi (rattachement des réponses + plafond quotidien).
    expect(d.journaliser).toHaveBeenCalledWith(expect.objectContaining({
      userId: "u1", leadId: 42, platform: "email", messageType: "step_1", sentAt: expect.any(Date),
    }));
    expect(d.setProviderIds).toHaveBeenCalledWith(900, "pm-1", "th-1");
    // Étape 1 réservée puis marquée envoyée ; séquence terminée d'emblée.
    expect(claims.map((c) => c[0])).toEqual(["claim", "sent"]);
    expect(claims[0][1]).toEqual({ leadId: 42, campaignId: 7, stepOrder: 1, userId: "u1", channel: "email" });
    expect(d.terminerSequence).toHaveBeenCalledWith(42, 7, "u1", expect.any(Date));
    expect(d.archiverLead).not.toHaveBeenCalled();
  });

  it("rédaction en échec : texte de secours, le test part quand même", async () => {
    const { d } = deps({ rediger: vi.fn(async () => { throw new Error("brief"); }) });
    const r = await envoyerEmailTest(d, "u1", 7, { email: "claire@exemple.fr" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.secours).toBe(true);
    expect(r.body).toMatch(/^Bonjour Test,/);
    expect(d.envoyer).toHaveBeenCalled();
    expect(d.terminerSequence).toHaveBeenCalled();
  });

  it("IA bloquée : texte de secours sans appel au rédacteur", async () => {
    const { d } = deps({ iaBloquee: vi.fn(async () => true) });
    const r = await envoyerEmailTest(d, "u1", 7, { email: "claire@exemple.fr" });
    expect(r.ok && r.secours).toBe(true);
    expect(d.rediger).not.toHaveBeenCalled();
  });

  it("sujet vide du rédacteur : sujet de secours, corps rédigé gardé", async () => {
    const { d } = deps({ rediger: vi.fn(async () => ({ subject: null, body: "Bonjour,\n\nTexte." })) });
    const r = await envoyerEmailTest(d, "u1", 7, { email: "claire@exemple.fr" });
    expect(r.ok && r.body).toBe("Bonjour,\n\nTexte.");
    expect(r.ok && r.subject).toBe("Email de test de ta prospection");
  });

  it("campagne d'une autre utilisatrice : 404, rien créé", async () => {
    const { d } = deps({ getCampaign: vi.fn(async () => ({ ...CAMPAGNE, userId: "u2" })) });
    expect(await envoyerEmailTest(d, "u1", 7, { email: "claire@exemple.fr" })).toEqual({ ok: false, status: 404, code: "introuvable" });
    expect(d.createLead).not.toHaveBeenCalled();
  });

  it("adresse invalide : 400 avant toute lecture", async () => {
    const { d } = deps();
    expect(await envoyerEmailTest(d, "u1", 7, { email: "x" })).toEqual({ ok: false, status: 400, code: "email_invalide" });
    expect(d.getCampaign).not.toHaveBeenCalled();
  });

  it.each([
    ["envoi désactivé", { envoiActif: () => false }, 409, "envoi_desactive"],
    ["Gmail déconnecté", { identite: vi.fn(async () => ({ portee: null, identite: { email: { deconnecte: true } as any, linkedin: null, signature: null } })) }, 409, "gmail_deconnecte"],
    ["client sans signature", { identite: vi.fn(async () => ({ portee: 5, identite: { email: null, linkedin: null, signature: null } })) }, 409, "signature_client_manquante"],
    ["aucun expéditeur", { resolveSender: vi.fn(() => null) }, 409, "pas_d_expediteur"],
    ["réception hors ligne (Gmail)", { receptionActive: () => false }, 409, "reception_hors_ligne"],
    ["plafond atteint", { emailsEnvoyesDepuis: vi.fn(async () => 80) }, 429, "quota_atteint"],
    ["plafond illisible", { emailsEnvoyesDepuis: vi.fn(async () => { throw new Error("db"); }) }, 503, "quota_illisible"],
    ["adresse d'un vrai prospect", { adresseDeVraiProspect: vi.fn(async () => true) }, 409, "adresse_prospect"],
    ["lecture des vrais prospects en échec", { adresseDeVraiProspect: vi.fn(async () => { throw new Error("db"); }) }, 409, "adresse_prospect"],
    ["5 tests sur 24 h", { testsCreesDepuis: vi.fn(async () => 5) }, 429, "quota_test_atteint"],
    ["compte des tests illisible", { testsCreesDepuis: vi.fn(async () => { throw new Error("db"); }) }, 503, "quota_illisible"],
  ] as const)("%s : refus clair, aucun prospect créé", async (_l, over, status, code) => {
    const { d } = deps(over as any);
    expect(await envoyerEmailTest(d, "u1", 7, { email: "claire@exemple.fr" })).toEqual({ ok: false, status, code });
    expect(d.createLead).not.toHaveBeenCalled();
    expect(d.envoyer).not.toHaveBeenCalled();
  });

  it("SendGrid sans réception Unipile : l'envoi part quand même (même règle que le worker)", async () => {
    const sg = { via: "sendgrid" as const, apiKey: "k", fromEmail: "jeanne@agence.fr", fromName: "Jeanne", footerAddress: "" };
    const { d } = deps({ resolveSender: vi.fn(() => sg), receptionActive: () => false });
    const r = await envoyerEmailTest(d, "u1", 7, { email: "claire@exemple.fr" });
    expect(r.ok).toBe(true);
  });

  it("adresse de l'utilisatrice elle-même : refus (sa réponse serait prise pour la sienne)", async () => {
    const { d } = deps();
    expect(await envoyerEmailTest(d, "u1", 7, { email: " Jeanne.Gmail@gmail.com" })).toEqual({ ok: false, status: 400, code: "adresse_propre" });
    expect(await envoyerEmailTest(d, "u1", 7, { email: "jeanne@agence.fr" })).toEqual({ ok: false, status: 400, code: "adresse_propre" });
    expect(d.createLead).not.toHaveBeenCalled();
  });

  it("adresse désinscrite : prospect archivé, rien envoyé", async () => {
    const { d } = deps({ estDesinscrit: vi.fn(async () => true) });
    expect(await envoyerEmailTest(d, "u1", 7, { email: "claire@exemple.fr" })).toEqual({ ok: false, status: 409, code: "desinscrit" });
    expect(d.archiverLead).toHaveBeenCalledWith(42, "u1");
    expect(d.envoyer).not.toHaveBeenCalled();
  });

  it("Gmail sans lien de désinscription : prospect archivé, rien envoyé", async () => {
    const { d } = deps({ lienDesinscription: vi.fn(() => null) });
    expect(await envoyerEmailTest(d, "u1", 7, { email: "claire@exemple.fr" })).toEqual({ ok: false, status: 503, code: "lien_desinscription_manquant" });
    expect(d.archiverLead).toHaveBeenCalled();
    expect(d.envoyer).not.toHaveBeenCalled();
  });

  it("fournisseur en erreur : réservation libérée, prospect archivé, séquence non écrite", async () => {
    const { d, claims } = deps({ envoyer: vi.fn(async () => ({ ok: false, providerId: null, threadId: null })) });
    expect(await envoyerEmailTest(d, "u1", 7, { email: "claire@exemple.fr" })).toEqual({ ok: false, status: 502, code: "echec_envoi" });
    expect(claims.map((c) => c[0])).toEqual(["claim", "release"]);
    expect(d.journaliser).not.toHaveBeenCalled();
    expect(d.terminerSequence).not.toHaveBeenCalled();
    expect(d.archiverLead).toHaveBeenCalledWith(42, "u1");
  });

  it("adresse d'un vrai prospect : vérifiée normalisée, avec l'utilisatrice", async () => {
    const { d } = deps();
    await envoyerEmailTest(d, "u1", 7, { email: " Claire@Exemple.FR " });
    expect(d.adresseDeVraiProspect).toHaveBeenCalledWith("u1", "claire@exemple.fr");
    expect(d.testsCreesDepuis).toHaveBeenCalledWith("u1", new Date("2026-11-04T21:30:00Z"));
  });

  it("4 tests sur 24 h : le 5e passe", async () => {
    const { d } = deps({ testsCreesDepuis: vi.fn(async () => 4) });
    expect((await envoyerEmailTest(d, "u1", 7, { email: "claire@exemple.fr" })).ok).toBe(true);
  });

  it("exception pendant l'envoi : réservation GARDÉE, prospect archivé, echec_envoi", async () => {
    const { d, claims } = deps({ envoyer: vi.fn(async () => { throw new Error("réseau"); }) });
    expect(await envoyerEmailTest(d, "u1", 7, { email: "claire@exemple.fr" })).toEqual({ ok: false, status: 502, code: "echec_envoi" });
    expect(claims.map((c) => c[0])).toEqual(["claim"]); // ni libérée ni marquée : jamais renvoyée dans le doute
    expect(d.archiverLead).toHaveBeenCalledWith(42, "u1");
    expect(d.terminerSequence).not.toHaveBeenCalled();
  });

  it("journal en échec après l'envoi : le test reste un succès, la séquence est terminée", async () => {
    const { d } = deps({ journaliser: vi.fn(async () => { throw new Error("db"); }) });
    const r = await envoyerEmailTest(d, "u1", 7, { email: "claire@exemple.fr" });
    expect(r.ok).toBe(true);
    expect(d.terminerSequence).toHaveBeenCalled();
  });
});
