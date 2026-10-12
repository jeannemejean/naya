import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocks pour le test de garde de generateStepMessage : DB + Claude. On garde
// buildStepPrompt réel (testé en pur juste en dessous).
vi.mock("../storage", () => ({
  storage: {
    getLeadStepMessage: vi.fn(),
    upsertLeadStepMessage: vi.fn(),
    getOutreachMessages: vi.fn(),
    getProjectProof: vi.fn(async () => undefined),
    getMessageFeedback: vi.fn(async () => []),
    getLearnedRules: vi.fn(async () => []),
    getProjectProofs: vi.fn(async () => []),
    updateLead: vi.fn(async () => ({})),
    purgeUneditedLeadStepMessages: vi.fn(async () => {}),
  },
}));
vi.mock("./prospection/brief", async (io) => ({ ...(await io<any>()), genererBrief: vi.fn() }));
// Relecture IA (couche 2) : neutre par défaut, pilotée test par test.
vi.mock("./prospection/relecture", () => ({ relire: vi.fn(async () => []) }));
vi.mock("./claude", async (io) => {
  const actual = await io<any>();
  return { ...actual, callClaudeWithContext: vi.fn() };
});

import { buildStepPrompt, generateStepMessage, combineInstructions, contexteProspect, neutresDuProspect, roleDeTouche, BriefIncompletError } from "./sequence-message";
import { storage } from "../storage";
import * as claude from "./claude";
import * as relecture from "./prospection/relecture";
import * as briefMod from "./prospection/brief";

const BRIEF = {
  declencheur: { fait: "Petit Bivouac lance une collection réparable", source: "post" },
  preuveId: null, raison: "Collection en cours de lancement.", proposition: { type: "idee", contenu: "une série courte sur la réparation" },
  angles: ["la collection réparable", "une idée de série courte", "le rayon outdoor saturé", "clore proprement"],
  langue: "fr", registre: "vous", genereLe: "2026-10-12", edite: false,
};

describe("buildStepPrompt", () => {
  const base = {
    founderName: "Jeanne", projectName: "Agence JMD", intention: "Se présenter et proposer l'idée",
    lead: { name: "Fred Renaud", role: "Cofondateur", company: "Petit Bivouac" },
    audit: { angle: "le nom crée une pause", observations: "marque outdoor grenobloise" },
    brief: BRIEF as any, angle: "une idée de série courte",
  };
  it("contient la doctrine, le rôle, l'angle de la touche et le déclencheur", () => {
    const p = buildStepPrompt({ ...base, channel: "linkedin", role: "premier_message" });
    expect(p).toContain("DOCTRINE DE PROSPECTION");
    expect(p).toContain("PREMIER MESSAGE");
    expect(p).toContain("une idée de série courte");
    expect(p).toContain("Petit Bivouac lance une collection réparable");
    expect(p).toContain("Jeanne");
  });
  it("n'exige plus de question ouverte ni un ton « jamais commercial »", () => {
    const p = buildStepPrompt({ ...base, channel: "linkedin", role: "premier_message" });
    expect(p).not.toMatch(/termine par une (seule )?question ouverte/i);
    expect(p).not.toContain("jamais commercial");
  });
  it("injecte la preuve résolue et les exemples de l'utilisatrice", () => {
    const p = buildStepPrompt({ ...base, channel: "email", role: "email_ouverture", preuveTexte: "Client : ne pas nommer ce client", exemples: ["Bonjour Claire, je dirige JMD…"] });
    expect(p).toContain("PREUVE À UTILISER");
    expect(p).toContain("ne pas nommer ce client");
    expect(p).toContain("Bonjour Claire, je dirige JMD");
    expect(p).toContain('"subject"');
  });
  it("sans preuve, interdit d'en évoquer une", () => {
    const p = buildStepPrompt({ ...base, channel: "linkedin", role: "relance" });
    expect(p).toMatch(/aucune preuve/i);
  });
  it("injecte les consignes et les défauts à corriger", () => {
    const p = buildStepPrompt({ ...base, channel: "linkedin", role: "relance", instructions: "Toujours vouvoyer", defautsACorriger: [{ code: "tic", raison: "Formule d'IA : « resonner »" }] });
    expect(p).toContain("Toujours vouvoyer");
    expect(p).toContain("À CORRIGER");
    expect(p).toContain("resonner");
  });
  it("n'ajoute aucun bloc de consignes quand instructions est absent ou vide", () => {
    const p = buildStepPrompt({ ...base, channel: "linkedin", role: "relance", instructions: "  " });
    expect(p).not.toContain("CONSIGNES DE RÉDACTION");
  });
});

describe("roleDeTouche", () => {
  it("lit le rôle porté par l'étape", () => {
    expect(roleDeTouche([{ channel: "email", role: "cloture" }] as any, 0)).toBe("cloture");
  });
  it("déduit le rôle des séquences anciennes", () => {
    const steps = [
      { channel: "linkedin", condition: "always" },
      { channel: "email", condition: "if_invite_not_accepted" },
      { channel: "linkedin", condition: "if_invite_accepted" },
      { channel: "email", condition: "if_not_opened" },
      { channel: "linkedin", condition: "if_invite_accepted" },
    ] as any;
    expect([0, 1, 2, 3, 4].map((i) => roleDeTouche(steps, i))).toEqual(["invitation", "email_ouverture", "premier_message", "relance", "relance"]);
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
    (claude.callClaudeWithContext as any).mockResolvedValue("désolé je n'ai pas compris");

    const lead = { id: 42, name: "Fred Renaud", role: "Cofondateur", company: "Petit Bivouac", prospectBrief: BRIEF };
    const campaign = { name: "Agence JMD", founderName: "Jeanne" };
    const step = { id: 7, channel: "linkedin", intention: "Invitation d'ouverture" };

    await expect(
      generateStepMessage("u1", { lead, campaign, step }),
    ).rejects.toThrow(/corps vide/);

    expect(storage.upsertLeadStepMessage).not.toHaveBeenCalled();
  });
});


describe("buildStepPrompt — textes antérieurs", () => {
  const base = {
    founderName: "Jeanne", projectName: "Agence JMD", channel: "linkedin", intention: "", role: "relance" as const,
    lead: { name: "Fred Renaud", role: "Cofondateur", company: "Petit Bivouac" }, audit: {}, brief: BRIEF as any, angle: "x",
  };
  it("intègre les textes antérieurs sous un intitulé clair", () => {
    const p = buildStepPrompt({ ...base, previousTexts: ["Premier texte envoyé"] });
    expect(p).toContain("MESSAGES DÉJÀ RÉDIGÉS OU ENVOYÉS");
    expect(p).toContain("Premier texte envoyé");
  });
  it("aucun bloc de textes antérieurs quand il n'y en a pas", () => {
    expect(buildStepPrompt(base)).not.toContain("MESSAGES DÉJÀ RÉDIGÉS");
  });
  it("conflit : cite le texte trop proche et exige un message radicalement différent", () => {
    const p = buildStepPrompt({ ...base, conflit: "Texte en conflit" });
    expect(p).toContain("beaucoup trop proche");
    expect(p).toContain("RADICALEMENT");
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
  const lead = { id: 42, name: "Fred Renaud", role: "Cofondateur", company: "Petit Bivouac", prospectBrief: BRIEF };
  const campaign = { name: "Agence JMD", founderName: "Jeanne" };
  const steps = [
    { id: 1, channel: "linkedin", intention: "Invitation", condition: "always" },
    { id: 2, channel: "linkedin", intention: null, condition: "if_invite_accepted" },
  ];
  const invitation = "Fred, le nom Petit Bivouac crée une vraie pause dans un rayon outdoor saturé. J'aimerais suivre votre travail. Jeanne";
  const distinct = "Merci Fred. Je dirige JMD, on accompagne des marques outdoor sur leurs contenus. Votre collection réparable m'a donné une idée de série courte. Je vous l'envoie ? Jeanne";

  beforeEach(() => {
    vi.clearAllMocks();
    (storage.getOutreachMessages as any).mockResolvedValue([]);
    (storage.getLeadStepMessage as any).mockImplementation(async (_l: number, stepId: number) =>
      stepId === 1 ? { body: invitation, subject: null, edited: false } : undefined);
  });

  it("charge le texte de l'invitation et l'injecte dans le prompt de l'étape 2", async () => {
    (claude.callClaudeWithContext as any).mockResolvedValue(JSON.stringify({ body: distinct }));
    const r = await generateStepMessage("u1", { lead, campaign, step: steps[1], steps });
    expect(r).toEqual({ subject: null, body: distinct });
    const prompt = (claude.callClaudeWithContext as any).mock.calls[0][0].userMessage;
    expect(prompt).toContain(invitation);
    expect(prompt).toContain("PREMIER MESSAGE");
    expect(storage.upsertLeadStepMessage).toHaveBeenCalledWith(expect.objectContaining({ stepId: 2, body: distinct }));
  });

  it("trop proche une fois : régénère UNE fois avec le texte en conflit cité, puis met en cache", async () => {
    (claude.callClaudeWithContext as any)
      .mockResolvedValueOnce(JSON.stringify({ body: invitation }))
      .mockResolvedValueOnce(JSON.stringify({ body: distinct }));
    const r = await generateStepMessage("u1", { lead, campaign, step: steps[1], steps });
    expect(claude.callClaudeWithContext).toHaveBeenCalledTimes(2);
    const prompt2 = (claude.callClaudeWithContext as any).mock.calls[1][0].userMessage;
    expect(prompt2).toContain("beaucoup trop proche");
    expect(r.tropProche).toBeUndefined();
    expect(r.body).toBe(distinct);
    expect(storage.upsertLeadStepMessage).toHaveBeenCalledTimes(1);
  });

  it("toujours trop proche après régénération : signale tropProche et ne met JAMAIS en cache", async () => {
    (claude.callClaudeWithContext as any).mockResolvedValue(JSON.stringify({ body: invitation }));
    const r = await generateStepMessage("u1", { lead, campaign, step: steps[1], steps });
    expect(claude.callClaudeWithContext).toHaveBeenCalledTimes(2);
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
    (claude.callClaudeWithContext as any).mockResolvedValue(JSON.stringify({ body: distinct }));
    await generateStepMessage("u1", { lead, campaign, step: steps[1], steps });
    const prompt = (claude.callClaudeWithContext as any).mock.calls[0][0].userMessage;
    expect(prompt).toContain(invitation);
    expect(prompt).not.toContain("texte de l'étape courante elle-même");
    expect(prompt).not.toContain("brouillon jamais parti");
  });

  it("cache trop proche (généré, non édité) : ignoré et régénéré", async () => {
    (storage.getLeadStepMessage as any).mockImplementation(async (_l: number, stepId: number) =>
      ({ body: invitation, subject: null, edited: false, stepId }));
    (claude.callClaudeWithContext as any).mockResolvedValue(JSON.stringify({ body: distinct }));
    const r = await generateStepMessage("u1", { lead, campaign, step: steps[1], steps });
    expect(r.body).toBe(distinct);
    expect(claude.callClaudeWithContext).toHaveBeenCalledTimes(1);
  });

  it("cache édité à la main : toujours respecté", async () => {
    (storage.getLeadStepMessage as any).mockImplementation(async (_l: number, stepId: number) =>
      ({ body: invitation, subject: null, edited: stepId === 2 }));
    const r = await generateStepMessage("u1", { lead, campaign, step: steps[1], steps });
    expect(r.body).toBe(invitation);
    expect(claude.callClaudeWithContext).not.toHaveBeenCalled();
  });

  it("invitation : note jusqu'à 300 caractères conservée (pas tronquée à 200)", async () => {
    (storage.getLeadStepMessage as any).mockResolvedValue(undefined);
    const longue = `Fred, ${"votre manière de penser le bivouac réparable ".repeat(6)}`.slice(0, 280).trim();
    (claude.callClaudeWithContext as any).mockResolvedValue(JSON.stringify({ body: longue }));
    const r = await generateStepMessage("u1", { lead, campaign, step: steps[0], steps });
    expect(r.body.length).toBeGreaterThan(200);
    expect(r.body.length).toBeLessThanOrEqual(300);
    const prompt = (claude.callClaudeWithContext as any).mock.calls[0][0].userMessage;
    expect(prompt).toContain("NOTE D'INVITATION");
  });

  it("branche opposée exclue : l'étape if_invite_not_accepted ne se compare pas au message if_invite_accepted", async () => {
    const branches = [
      { id: 1, channel: "linkedin", intention: "Invitation", condition: "always" },
      { id: 2, channel: "linkedin", intention: null, condition: "if_invite_accepted" },
      { id: 3, channel: "email", intention: "Email si pas accepté", condition: "if_invite_not_accepted" },
    ];
    (storage.getLeadStepMessage as any).mockImplementation(async (_l: number, stepId: number) =>
      stepId === 1 ? { body: invitation, edited: false } : stepId === 2 ? { body: "TEXTE BRANCHE ACCEPTEE", edited: false } : undefined);
    (claude.callClaudeWithContext as any).mockResolvedValue(JSON.stringify({ subject: "Objet", body: distinct }));
    await generateStepMessage("u1", { lead, campaign, step: branches[2], steps: branches });
    const prompt = (claude.callClaudeWithContext as any).mock.calls[0][0].userMessage;
    expect(prompt).toContain(invitation);
    expect(prompt).not.toContain("TEXTE BRANCHE ACCEPTEE");
  });

  it("deux messages courts qui ne partagent que noms/entreprise/signature ne sont pas bloqués", async () => {
    const leadM = { id: 43, name: "Marie Dupont", role: "Gérante", company: "Lumen Concept Store", prospectBrief: BRIEF,
      enrichedProfile: { linkedin: { location: "Lyon" } } };
    (storage.getLeadStepMessage as any).mockImplementation(async (_l: number, stepId: number) =>
      stepId === 1 ? { body: "Bonjour Marie Dupont, votre boutique Lumen Concept Store Lyon m'intrigue. Jeanne Méjean", edited: false } : undefined);
    (claude.callClaudeWithContext as any).mockResolvedValue(JSON.stringify({ body: "Bonjour Marie Dupont, une question sur Lumen Concept Store Lyon : la saison ? Jeanne Méjean" }));
    const r = await generateStepMessage("u1", { lead: leadM, campaign, step: steps[1], steps, senderLastName: "Méjean" });
    expect(r.tropProche).toBeUndefined();
    expect(claude.callClaudeWithContext).toHaveBeenCalledTimes(1);
    expect(storage.upsertLeadStepMessage).toHaveBeenCalledTimes(1);
  });

  it("textes antérieurs fournis par l'appelant (aperçu) pris en compte", async () => {
    (storage.getLeadStepMessage as any).mockResolvedValue(undefined);
    (claude.callClaudeWithContext as any).mockResolvedValue(JSON.stringify({ body: invitation }));
    const r = await generateStepMessage("u1", { lead, campaign, step: steps[1], steps, previousTexts: [invitation] });
    expect(r.tropProche).toBe(true);
    expect(storage.upsertLeadStepMessage).not.toHaveBeenCalled();
  });
});

describe("generateStepMessage — brief et contrôle qualité", () => {
  const lead = { id: 42, name: "Fred Renaud", role: "Cofondateur", company: "Petit Bivouac", prospectBrief: BRIEF };
  const campaign = { name: "Agence JMD", founderName: "Jeanne", projectId: 7 };
  const steps = [{ id: 1, channel: "linkedin", intention: "Invitation", condition: "always", role: "invitation" }];
  const bon = "Fred, la collection réparable de Petit Bivouac m'a parlé : je dirige JMD, on accompagne des marques outdoor. Au plaisir d'échanger. Jeanne";
  const mauvais = "Fred, la façon dont votre marque pense le bivouac m'a frappée. Comment pensez-vous l'équilibre entre héritage et renouveau ? Jeanne";

  beforeEach(() => {
    vi.clearAllMocks();
    (storage.getOutreachMessages as any).mockResolvedValue([]);
    (storage.getLeadStepMessage as any).mockResolvedValue(undefined);
    (storage.getMessageFeedback as any).mockResolvedValue([]);
    (storage.getLearnedRules as any).mockResolvedValue([]);
    (relecture.relire as any).mockResolvedValue([]);
  });

  it("sans brief actionnable ni cache : aucun appel IA de rédaction, BriefIncompletError", async () => {
    (briefMod.genererBrief as any).mockResolvedValue({ ...BRIEF, declencheur: null });
    await expect(generateStepMessage("u1", { lead: { ...lead, prospectBrief: null }, campaign, step: steps[0], steps }))
      .rejects.toBeInstanceOf(BriefIncompletError);
    expect(claude.callClaudeWithContext).not.toHaveBeenCalled();
  });

  it("sans brief, un message édité à la main est quand même servi", async () => {
    (storage.getLeadStepMessage as any).mockResolvedValue({ body: "écrit par Jeanne", subject: null, edited: true });
    const r = await generateStepMessage("u1", { lead: { ...lead, prospectBrief: null }, campaign, step: steps[0], steps });
    expect(r.body).toBe("écrit par Jeanne");
  });

  it("un message qui viole la doctrine est réécrit une fois avec les raisons", async () => {
    (claude.callClaudeWithContext as any)
      .mockResolvedValueOnce(JSON.stringify({ body: mauvais }))
      .mockResolvedValueOnce(JSON.stringify({ body: bon }));
    const r = await generateStepMessage("u1", { lead, campaign, step: steps[0], steps });
    expect(r.body).toBe(bon);
    expect(r.aRevoir).toBeUndefined();
    const prompt2 = (claude.callClaudeWithContext as any).mock.calls[1][0].userMessage;
    expect(prompt2).toContain("À CORRIGER");
    expect(storage.upsertLeadStepMessage).toHaveBeenCalledWith(expect.objectContaining({ body: bon, qualite: "ok" }));
  });

  it("toujours fautif après réécriture : mis en cache « à revoir » avec ses défauts", async () => {
    (claude.callClaudeWithContext as any).mockResolvedValue(JSON.stringify({ body: mauvais }));
    const r = await generateStepMessage("u1", { lead, campaign, step: steps[0], steps });
    expect(claude.callClaudeWithContext).toHaveBeenCalledTimes(2);
    expect(r.aRevoir).toBe(true);
    expect(r.defauts?.map((d) => d.code)).toContain("question_reflexion");
    expect(storage.upsertLeadStepMessage).toHaveBeenCalledWith(expect.objectContaining({ qualite: "a_revoir" }));
  });

  it("les défauts de la relecture IA comptent aussi", async () => {
    (claude.callClaudeWithContext as any).mockResolvedValue(JSON.stringify({ body: bon }));
    (relecture.relire as any).mockResolvedValue([{ code: "relecture", raison: "Le déclencheur n'est pas utilisé." }]);
    const r = await generateStepMessage("u1", { lead, campaign, step: steps[0], steps });
    expect(r.aRevoir).toBe(true);
    expect(r.defauts?.[0].raison).toContain("déclencheur");
  });

  it("un cache « à revoir » non édité est resservi avec son drapeau, sans nouvel appel", async () => {
    (storage.getLeadStepMessage as any).mockResolvedValue({ body: mauvais, subject: null, edited: false, qualite: "a_revoir", defauts: [{ code: "tic", raison: "x" }] });
    const r = await generateStepMessage("u1", { lead, campaign, step: steps[0], steps });
    expect(r.aRevoir).toBe(true);
    expect(claude.callClaudeWithContext).not.toHaveBeenCalled();
  });

  it("rédige en mode tiers, avec les exemples et les règles apprises du projet", async () => {
    (storage.getMessageFeedback as any).mockResolvedValue([
      { id: 1, role: "invitation", action: "modifie", original: "o", final: "EXEMPLE DE JEANNE", aRepondu: null },
    ]);
    (storage.getLearnedRules as any).mockResolvedValue([{ id: 1, texte: "REGLE APPRISE", statut: "acceptee" }]);
    (claude.callClaudeWithContext as any).mockResolvedValue(JSON.stringify({ body: bon }));
    await generateStepMessage("u1", { lead, campaign, step: steps[0], steps });
    const appel = (claude.callClaudeWithContext as any).mock.calls[0][0];
    expect(appel.destinataire).toBe("tiers");
    expect(appel.userMessage).toContain("EXEMPLE DE JEANNE");
    expect(appel.userMessage).toContain("REGLE APPRISE");
    expect(storage.getMessageFeedback).toHaveBeenCalledWith("u1", 7, expect.objectContaining({ role: "invitation" }));
  });

  it("une preuve non validée n'est jamais injectée", async () => {
    (storage.getProjectProof as any).mockResolvedValue({ id: 4, projectId: 7, status: "proposed", clientLabel: "SECRET", whatWasDone: "x", citable: true });
    (claude.callClaudeWithContext as any).mockResolvedValue(JSON.stringify({ body: bon }));
    await generateStepMessage("u1", { lead: { ...lead, prospectBrief: { ...BRIEF, preuveId: 4 } }, campaign, step: steps[0], steps });
    expect((claude.callClaudeWithContext as any).mock.calls[0][0].userMessage).not.toContain("SECRET");
  });
});

describe("generateStepMessage — prospects sans brief (antérieurs) et notes", () => {
  const campaign = { id: 5, name: "Agence JMD", founderName: "Jeanne", projectId: 7 };
  const steps = [{ id: 1, channel: "linkedin", intention: "Invitation", condition: "always", role: "invitation" }];
  const bon = "Fred, la collection réparable de Petit Bivouac m'a parlé : je dirige JMD, on accompagne des marques outdoor. Au plaisir d'échanger. Jeanne";
  const ancien = { id: 42, name: "Fred Renaud", role: "Cofondateur", company: "Petit Bivouac", prospectBrief: null, auditNotes: "{}" };

  beforeEach(() => {
    vi.clearAllMocks();
    (storage.getOutreachMessages as any).mockResolvedValue([]);
    (storage.getMessageFeedback as any).mockResolvedValue([]);
    (storage.getLearnedRules as any).mockResolvedValue([]);
    (relecture.relire as any).mockResolvedValue([]);
  });

  it("un vieux message en cache n'est PAS servi sans brief : le brief est créé, le cache non édité purgé, le message réécrit", async () => {
    (storage.getLeadStepMessage as any).mockResolvedValue({ body: "vieux texte sans déclencheur", subject: null, edited: false, qualite: "ok" });
    (briefMod.genererBrief as any).mockResolvedValue(BRIEF);
    (claude.callClaudeWithContext as any).mockResolvedValue(JSON.stringify({ body: bon }));
    const r = await generateStepMessage("u1", { lead: { ...ancien }, campaign, step: steps[0], steps });
    expect(r.body).toBe(bon);
    expect(storage.updateLead).toHaveBeenCalledWith(42, "u1", expect.objectContaining({ prospectBrief: expect.objectContaining({ declencheur: BRIEF.declencheur }) }));
    expect(storage.purgeUneditedLeadStepMessages).toHaveBeenCalledWith(42);
  });

  it("brief créé sans déclencheur : rien n'est servi ni rédigé", async () => {
    (storage.getLeadStepMessage as any).mockResolvedValue({ body: "vieux texte", subject: null, edited: false, qualite: "ok" });
    (briefMod.genererBrief as any).mockResolvedValue({ ...BRIEF, declencheur: null });
    await expect(generateStepMessage("u1", { lead: { ...ancien }, campaign, step: steps[0], steps })).rejects.toBeInstanceOf(BriefIncompletError);
    expect(claude.callClaudeWithContext).not.toHaveBeenCalled();
  });

  it("une note ajoutée sur la fiche devient le déclencheur au passage suivant", async () => {
    (storage.getLeadStepMessage as any).mockResolvedValue(undefined);
    (claude.callClaudeWithContext as any).mockResolvedValue(JSON.stringify({ body: bon }));
    const lead = { ...ancien, notes: "Vue au salon Outdoor Days", prospectBrief: { ...BRIEF, declencheur: null } };
    const r = await generateStepMessage("u1", { lead, campaign, step: steps[0], steps });
    expect(r.body).toBe(bon);
    expect(storage.updateLead).toHaveBeenCalledWith(42, "u1", expect.objectContaining({
      prospectBrief: expect.objectContaining({ declencheur: expect.objectContaining({ fait: "Vue au salon Outdoor Days", source: "note" }) }),
    }));
    expect((claude.callClaudeWithContext as any).mock.calls[0][0].userMessage).toContain("Vue au salon Outdoor Days");
    expect(briefMod.genererBrief).not.toHaveBeenCalled();
  });

  it("un message ÉDITÉ reste servi même sans brief", async () => {
    (storage.getLeadStepMessage as any).mockResolvedValue({ body: "écrit par Jeanne", subject: null, edited: true });
    const r = await generateStepMessage("u1", { lead: { ...ancien }, campaign, step: steps[0], steps });
    expect(r.body).toBe("écrit par Jeanne");
    expect(briefMod.genererBrief).not.toHaveBeenCalled();
  });
});

describe("neutresDuProspect", () => {
  it("nom complet et ses parties, entreprise, ville, expéditrice", () => {
    const n = neutresDuProspect(
      { name: "Marie Dupont", company: "Lumen Concept Store", enrichedProfile: { linkedin: { location: "Lyon, Auvergne-Rhône-Alpes" } } },
      ["Jeanne", "Méjean", null],
    );
    expect(n).toEqual(expect.arrayContaining(["Marie Dupont", "Marie", "Dupont", "Lumen Concept Store", "Lyon", "Jeanne", "Méjean"]));
    expect(n).not.toContain("");
  });
});
