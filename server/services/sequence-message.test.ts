import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocks pour le test de garde de generateStepMessage : DB + Claude. On garde
// buildStepPrompt réel (testé en pur juste en dessous).
vi.mock("../storage", () => ({
  storage: {
    getLeadStepMessage: vi.fn(),
    upsertLeadStepMessage: vi.fn(),
    getOutreachMessages: vi.fn(),
  },
}));
vi.mock("./claude", async (io) => {
  const actual = await io<any>();
  return { ...actual, callClaude: vi.fn() };
});

import { buildStepPrompt, generateStepMessage, combineInstructions, contexteProspect } from "./sequence-message";
import { storage } from "../storage";
import * as claude from "./claude";

describe("buildStepPrompt", () => {
  const base = {
    founderName: "Jeanne", projectName: "Agence JMD",
    lead: { name: "Fred Renaud", role: "Cofondateur", company: "Petit Bivouac" },
    audit: { angle: "le nom crée une pause", observations: "marque outdoor grenobloise" },
  };
  it("LinkedIn : impose ≤200 caractères et la signature du prénom", () => {
    const p = buildStepPrompt({ ...base, channel: "linkedin", intention: "Invitation d'ouverture" });
    expect(p).toContain("200");
    expect(p).toContain("Jeanne");
    expect(p).toContain("Fred Renaud");
    expect(p).toContain("Invitation d'ouverture");
  });
  it("Email : demande un objet + un corps et rappelle l'intention", () => {
    const p = buildStepPrompt({ ...base, channel: "email", intention: "Email de valeur" });
    expect(p.toLowerCase()).toContain("objet");
    expect(p).toContain("Email de valeur");
  });
  it("LinkedIn : interdit d'inventer un lien/ressource et les placeholders entre crochets", () => {
    const p = buildStepPrompt({ ...base, channel: "linkedin", intention: "Invitation d'ouverture" });
    expect(p).toContain("N'invente");
    expect(p).toContain("crochets");
    expect(p).not.toMatch(/un lien personnel/i);
  });
  it("Email : interdit d'inventer un lien/ressource et les placeholders entre crochets", () => {
    const p = buildStepPrompt({ ...base, channel: "email", intention: "Email de valeur" });
    expect(p).toContain("N'invente");
    expect(p).toContain("crochets");
  });
  it("injecte les consignes de rédaction utilisateur quand fournies", () => {
    const p = buildStepPrompt({ ...base, channel: "linkedin", intention: "Invitation d'ouverture", instructions: "Jamais de tiret long. Ton direct." });
    expect(p).toContain("CONSIGNES DE RÉDACTION DE L'UTILISATEUR");
    expect(p).toContain("Jamais de tiret long. Ton direct.");
  });
  it("n'ajoute aucun bloc de consignes quand instructions est absent ou vide", () => {
    const pAbsent = buildStepPrompt({ ...base, channel: "linkedin", intention: "Invitation d'ouverture" });
    expect(pAbsent).not.toContain("CONSIGNES DE RÉDACTION DE L'UTILISATEUR");
    const pEmpty = buildStepPrompt({ ...base, channel: "linkedin", intention: "Invitation d'ouverture", instructions: "   " });
    expect(pEmpty).not.toContain("CONSIGNES DE RÉDACTION DE L'UTILISATEUR");
  });
});

describe("combineInstructions", () => {
  it("combine les deux quand global et campagne sont fournis", () => {
    expect(combineInstructions("Jamais de tiret long.", "Mentionne notre offre early-bird.")).toBe(
      "Jamais de tiret long.\nMentionne notre offre early-bird.",
    );
  });
  it("retourne uniquement le global quand la campagne est absente", () => {
    expect(combineInstructions("Jamais de tiret long.", undefined)).toBe("Jamais de tiret long.");
    expect(combineInstructions("Jamais de tiret long.", null)).toBe("Jamais de tiret long.");
    expect(combineInstructions("Jamais de tiret long.", "   ")).toBe("Jamais de tiret long.");
  });
  it("retourne uniquement la campagne quand le global est absent", () => {
    expect(combineInstructions(undefined, "Mentionne notre offre early-bird.")).toBe("Mentionne notre offre early-bird.");
    expect(combineInstructions(null, "Mentionne notre offre early-bird.")).toBe("Mentionne notre offre early-bird.");
  });
  it("retourne une chaîne vide quand ni l'un ni l'autre n'est fourni", () => {
    expect(combineInstructions(undefined, undefined)).toBe("");
    expect(combineInstructions(null, null)).toBe("");
    expect(combineInstructions("  ", "  ")).toBe("");
  });
});

describe("generateStepMessage — garde anti-cache-vide", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lève une erreur et ne met JAMAIS en cache un corps vide quand la réponse IA n'est pas parsable", async () => {
    (storage.getLeadStepMessage as any).mockResolvedValue(undefined); // cache miss
    (claude.callClaude as any).mockResolvedValue("désolé je n'ai pas compris");

    const lead = { id: 42, name: "Fred Renaud", role: "Cofondateur", company: "Petit Bivouac" };
    const campaign = { name: "Agence JMD", founderName: "Jeanne" };
    const step = { id: 7, channel: "linkedin", intention: "Invitation d'ouverture" };

    await expect(
      generateStepMessage("u1", { lead, campaign, step }),
    ).rejects.toThrow(/corps vide/);

    expect(storage.upsertLeadStepMessage).not.toHaveBeenCalled();
  });
});


describe("buildStepPrompt — rôles LinkedIn et textes antérieurs", () => {
  const base = {
    founderName: "Jeanne", projectName: "Agence JMD", channel: "linkedin", intention: "",
    lead: { name: "Fred Renaud", role: "Cofondateur", company: "Petit Bivouac" },
    audit: { angle: "le nom crée une pause" },
  };
  it("invitation : ≤ 300 caractères, raison personnelle, ni pitch ni question sur les besoins", () => {
    const p = buildStepPrompt({ ...base, role: "invitation" });
    expect(p).toContain("300");
    expect(p).toContain("note d'invitation");
    expect(p).toContain("AUCUN pitch");
    expect(p).toContain("AUCUNE question sur ses besoins");
  });
  it("message après acceptation : remerciement naturel, interdit de paraphraser l'invitation, une question ouverte", () => {
    const p = buildStepPrompt({ ...base, role: "message_apres_acceptation" });
    expect(p).toContain("Remercie d'avoir accepté");
    expect(p).toContain("NE RÉPÈTE NI NE PARAPHRASE la note d'invitation");
    expect(p).toContain("UNE seule question ouverte");
    expect(p).toContain("200");
  });
  it("relance : nouvel angle, sans répéter", () => {
    const p = buildStepPrompt({ ...base, role: "relance" });
    expect(p).toContain("angle NOUVEAU");
  });
  it("intègre les textes antérieurs sous un intitulé clair", () => {
    const p = buildStepPrompt({ ...base, role: "message_apres_acceptation", previousTexts: ["Bonjour Fred, ravie de vous suivre."] });
    expect(p).toContain("MESSAGES DÉJÀ RÉDIGÉS OU ENVOYÉS À CE PROSPECT");
    expect(p).toContain("ne répète ni ne paraphrase ces messages");
    expect(p).toContain("« Bonjour Fred, ravie de vous suivre. »");
  });
  it("aucun bloc de textes antérieurs quand il n'y en a pas", () => {
    expect(buildStepPrompt({ ...base, role: "invitation" })).not.toContain("MESSAGES DÉJÀ RÉDIGÉS");
  });
  it("conflit : cite le texte trop proche et exige un message radicalement différent", () => {
    const p = buildStepPrompt({ ...base, role: "relance", conflit: "Texte en conflit" });
    expect(p).toContain("« Texte en conflit »");
    expect(p).toContain("RADICALEMENT différent");
  });
  it("intention vide : utilise bodyTemplate comme trame et une intention par rôle (plus « prise de contact »)", () => {
    const p = buildStepPrompt({ ...base, role: "message_apres_acceptation", bodyTemplate: "Remercier puis parler de {{company}}" });
    expect(p).toContain("TRAME INDICATIVE");
    expect(p).toContain("Remercier puis parler de {{company}}");
    expect(p).not.toContain("INTENTION DE CETTE ÉTAPE : prise de contact");
  });
  it("intention fournie : la trame n'est pas injectée", () => {
    const p = buildStepPrompt({ ...base, intention: "Ouverture", role: "invitation", bodyTemplate: "vieux modèle" });
    expect(p).not.toContain("TRAME INDICATIVE");
  });
  it("interdit les ouvertures génériques", () => {
    const p = buildStepPrompt({ ...base, role: "invitation" });
    expect(p).toContain("« Je me permets »");
    expect(p).toContain("« J'espère que vous allez bien »");
    expect(p).toContain("« Votre parcours est inspirant »");
  });
  it("email : règles email inchangées, pas de règle d'invitation", () => {
    const p = buildStepPrompt({ ...base, channel: "email", role: "invitation" });
    expect(p).toContain("EMAIL");
    expect(p).not.toContain("NOTE D'INVITATION");
  });
});

describe("contexteProspect", () => {
  it("expose les données propres au prospect (profil enrichi, audit, notes)", () => {
    const c = contexteProspect({
      sector: "Outdoor", notes: "Rencontré au salon",
      enrichedProfile: { linkedin: { headline: "Fondateur de Petit Bivouac", location: "Grenoble", about: "Tentes réparables", raw: { posts: [{ title: "Pourquoi on répare" }] } } },
    }, { contextePersonne: "Ancien guide", angle: "x" });
    expect(c).toContain("Fondateur de Petit Bivouac");
    expect(c).toContain("Grenoble");
    expect(c).toContain("Tentes réparables");
    expect(c).toContain("Pourquoi on répare");
    expect(c).toContain("Ancien guide");
    expect(c).toContain("Rencontré au salon");
    expect(c).not.toContain("Audit · angle");
  });
  it("vide si aucune donnée", () => {
    expect(contexteProspect({}, {})).toBe("");
  });
});

describe("generateStepMessage — messages distincts", () => {
  const lead = { id: 42, name: "Fred Renaud", role: "Cofondateur", company: "Petit Bivouac" };
  const campaign = { name: "Agence JMD", founderName: "Jeanne" };
  const steps = [
    { id: 1, channel: "linkedin", intention: "Invitation", condition: "always" },
    { id: 2, channel: "linkedin", intention: null, condition: "if_invite_accepted" },
  ];
  const invitation = "Fred, le nom Petit Bivouac crée une vraie pause dans un rayon outdoor saturé. J'aimerais suivre votre travail. Jeanne";
  const distinct = "Merci Fred. Votre collection mise sur la réparation, c'est rare. Comment vos clients l'ont-ils reçue ? Jeanne";

  beforeEach(() => {
    vi.clearAllMocks();
    (storage.getOutreachMessages as any).mockResolvedValue([]);
    (storage.getLeadStepMessage as any).mockImplementation(async (_l: number, stepId: number) =>
      stepId === 1 ? { body: invitation, subject: null, edited: false } : undefined);
  });

  it("charge le texte de l'invitation et l'injecte dans le prompt de l'étape 2", async () => {
    (claude.callClaude as any).mockResolvedValue(JSON.stringify({ body: distinct }));
    const r = await generateStepMessage("u1", { lead, campaign, step: steps[1], steps });
    expect(r).toEqual({ subject: null, body: distinct });
    const prompt = (claude.callClaude as any).mock.calls[0][0].messages[0].content;
    expect(prompt).toContain(invitation);
    expect(prompt).toContain("APRÈS ACCEPTATION");
    expect(storage.upsertLeadStepMessage).toHaveBeenCalledWith(expect.objectContaining({ stepId: 2, body: distinct }));
  });

  it("trop proche une fois : régénère UNE fois avec le texte en conflit cité, puis met en cache", async () => {
    (claude.callClaude as any)
      .mockResolvedValueOnce(JSON.stringify({ body: invitation }))
      .mockResolvedValueOnce(JSON.stringify({ body: distinct }));
    const r = await generateStepMessage("u1", { lead, campaign, step: steps[1], steps });
    expect(claude.callClaude).toHaveBeenCalledTimes(2);
    const prompt2 = (claude.callClaude as any).mock.calls[1][0].messages[0].content;
    expect(prompt2).toContain("beaucoup trop proche");
    expect(r.tropProche).toBeUndefined();
    expect(r.body).toBe(distinct);
    expect(storage.upsertLeadStepMessage).toHaveBeenCalledTimes(1);
  });

  it("toujours trop proche après régénération : signale tropProche et ne met JAMAIS en cache", async () => {
    (claude.callClaude as any).mockResolvedValue(JSON.stringify({ body: invitation }));
    const r = await generateStepMessage("u1", { lead, campaign, step: steps[1], steps });
    expect(claude.callClaude).toHaveBeenCalledTimes(2);
    expect(r.tropProche).toBe(true);
    expect(r.body).toBe(invitation);
    expect(storage.upsertLeadStepMessage).not.toHaveBeenCalled();
  });

  it("compare aussi aux messages réellement envoyés (outreach_messages), hors l'étape courante", async () => {
    (storage.getLeadStepMessage as any).mockResolvedValue(undefined);
    (storage.getOutreachMessages as any).mockResolvedValue([
      { messageType: "step_1_invitation", body: invitation, sentAt: new Date() },
      { messageType: "step_2", body: "texte de l'étape courante elle-même, ancien", sentAt: new Date() },
      { messageType: "step_1", body: "brouillon jamais parti", sentAt: null },
    ]);
    (claude.callClaude as any).mockResolvedValue(JSON.stringify({ body: distinct }));
    await generateStepMessage("u1", { lead, campaign, step: steps[1], steps });
    const prompt = (claude.callClaude as any).mock.calls[0][0].messages[0].content;
    expect(prompt).toContain(invitation);
    expect(prompt).not.toContain("texte de l'étape courante elle-même");
    expect(prompt).not.toContain("brouillon jamais parti");
  });

  it("cache trop proche (généré, non édité) : ignoré et régénéré", async () => {
    (storage.getLeadStepMessage as any).mockImplementation(async (_l: number, stepId: number) =>
      ({ body: invitation, subject: null, edited: false, stepId }));
    (claude.callClaude as any).mockResolvedValue(JSON.stringify({ body: distinct }));
    const r = await generateStepMessage("u1", { lead, campaign, step: steps[1], steps });
    expect(r.body).toBe(distinct);
    expect(claude.callClaude).toHaveBeenCalledTimes(1);
  });

  it("cache édité à la main : toujours respecté", async () => {
    (storage.getLeadStepMessage as any).mockImplementation(async (_l: number, stepId: number) =>
      ({ body: invitation, subject: null, edited: stepId === 2 }));
    const r = await generateStepMessage("u1", { lead, campaign, step: steps[1], steps });
    expect(r.body).toBe(invitation);
    expect(claude.callClaude).not.toHaveBeenCalled();
  });

  it("invitation : note jusqu'à 300 caractères conservée (pas tronquée à 200)", async () => {
    (storage.getLeadStepMessage as any).mockResolvedValue(undefined);
    const longue = `Fred, ${"votre manière de penser le bivouac réparable ".repeat(6)}`.slice(0, 280).trim();
    (claude.callClaude as any).mockResolvedValue(JSON.stringify({ body: longue }));
    const r = await generateStepMessage("u1", { lead, campaign, step: steps[0], steps });
    expect(r.body.length).toBeGreaterThan(200);
    expect(r.body.length).toBeLessThanOrEqual(300);
    const prompt = (claude.callClaude as any).mock.calls[0][0].messages[0].content;
    expect(prompt).toContain("NOTE D'INVITATION");
  });

  it("textes antérieurs fournis par l'appelant (aperçu) pris en compte", async () => {
    (storage.getLeadStepMessage as any).mockResolvedValue(undefined);
    (claude.callClaude as any).mockResolvedValue(JSON.stringify({ body: invitation }));
    const r = await generateStepMessage("u1", { lead, campaign, step: steps[1], steps, previousTexts: [invitation] });
    expect(r.tropProche).toBe(true);
    expect(storage.upsertLeadStepMessage).not.toHaveBeenCalled();
  });
});
