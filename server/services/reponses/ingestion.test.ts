import { describe, it, expect, vi } from "vitest";
import { traiterEvenement, normaliser, adressesPropresDepuis, type DepsIngestion, type EvenementNormalise } from "./ingestion";
import { planAcceptance } from "../sequence-signals";

const NOW = new Date("2026-11-02T10:00:00Z");

/** Base en mémoire : juste assez pour observer les effets de traiterEvenement. */
function fausseBase() {
  const lead: any = { id: 7, userId: "u1", projectId: 3, name: "Marc Dupont", company: "Acme", stage: "connection_sent", linkedinProviderId: "ACo-marc", linkedinConnectedAt: null, email: "marc@acme.fr" };
  const db = {
    leads: new Map<number, any>([[7, lead]]),
    state: { leadId: 7, status: "active", currentStep: 1, nextRunAt: new Date("2026-11-03T08:00:00Z"), delayAnchorAt: null } as any,
    conversations: [] as any[],
    messages: [] as any[],
    tasks: [] as any[],
    outreach: [{ id: 50, leadId: 7, sentAt: new Date("2026-10-30T09:00:00Z"), responseReceived: false, responseDate: null }] as any[],
    brouillonsSupprimes: 0,
    feedback: 0,
    deconnexions: [] as any[],
    reconnexions: [] as any[],
    suivis: [] as any[],
    ecrituresEtat: [] as any[],
  };
  const deps: DepsIngestion = {
    now: () => NOW,
    compteParId: vi.fn(async (id: string) => (id === "acc-li" ? { userId: "u1", projectId: null, canal: "linkedin" as const }
      : id === "acc-gm" ? { userId: "u1", projectId: null, canal: "email" as const } : null)),
    leadParFil: vi.fn(async (_u: string, ids: string[]) => (db.conversations.some((c) => ids.includes(c.providerChatId)) ? 7 : null)),
    leadParProviderId: vi.fn(async (_u: string, p: string) => (p === "ACo-marc" ? 7 : null)),
    leadParPublicId: vi.fn(async () => null),
    leadContacteParEmail: vi.fn(async (_u: string, e: string) => (e === "marc@acme.fr" ? 7 : null)),
    getLead: vi.fn(async (id: number) => db.leads.get(id)),
    updateLead: vi.fn(async (id: number, _u: string, p: any) => { Object.assign(db.leads.get(id), p); }),
    messageExiste: vi.fn(async (pm: string) => db.messages.some((m) => m.providerMessageId === pm)),
    getConversation: vi.fn(async (leadId: number, channel: string) => db.conversations.find((c) => c.leadId === leadId && c.channel === channel)),
    updateConversation: vi.fn(async (id: number, p: any) => { Object.assign(db.conversations.find((c) => c.id === id), p); }),
    ajouterMessage: vi.fn(async (row: any) => {
      if (db.messages.some((m) => m.providerMessageId === row.providerMessageId)) return false;
      db.messages.push(row); return true;
    }),
    dernierEntrantAt: vi.fn(async (cid: number) => {
      const d = db.messages.filter((m) => m.conversationId === cid && m.sens === "entrant").map((m) => m.sentAt.getTime());
      return d.length ? new Date(Math.max(...d)) : null;
    }),
    // Transaction simulée : même contrat que storage.enregistrerEntrantInbox.
    enregistrerEntrant: vi.fn(async (row: any, msg: any, plan: any) => {
      let c = db.conversations.find((x) => x.leadId === row.leadId && x.channel === row.channel);
      if (!c) { c = { id: db.conversations.length + 1, taskId: null, etatAvantReponse: null, ...row }; db.conversations.push(c); }
      if (db.messages.some((m) => m.providerMessageId === msg.providerMessageId)) return null;
      db.messages.push({ ...msg, conversationId: c.id });
      const p = plan(db.state ? { ...db.state } : undefined, { ...c });
      if (p.state) { db.ecrituresEtat.push(p.state); if (db.state.status !== "unsubscribed") Object.assign(db.state, p.state); }
      Object.assign(c, p.conv);
      return { ...c };
    }),
    attacherTache: vi.fn(async (cid: number, ancien: number | null, nouveau: number) => {
      const c = db.conversations.find((x) => x.id === cid);
      if ((c.taskId ?? null) !== ancien) return false;
      c.taskId = nouveau; return true;
    }),
    supprimerTache: vi.fn(async (id: number) => { db.tasks = db.tasks.filter((t) => t.id !== id); }),
    supprimerBrouillonsLinkedIn: vi.fn(async () => { db.brouillonsSupprimes++; }),
    dernierMessageEnvoye: vi.fn(async () => db.outreach[0]),
    updateOutreachMessage: vi.fn(async (id: number, p: any) => { Object.assign(db.outreach.find((o) => o.id === id), p); }),
    getTask: vi.fn(async (id: number) => db.tasks.find((t) => t.id === id)),
    createTask: vi.fn(async (t: any) => { const row = { id: 100 + db.tasks.length, completed: false, archivedAt: null, ...t }; db.tasks.push(row); return row; }),
    completeTask: vi.fn(async (id: number) => { db.tasks.find((t) => t.id === id).completed = true; }),
    markFeedbackReplied: vi.fn(async () => { db.feedback++; }),
    setLeadLinkedinConnected: vi.fn(async (leadId: number, at: Date) => {
      const l = db.leads.get(leadId);
      l.linkedinConnectedAt = planAcceptance(l.linkedinConnectedAt, at, db.state.status, NOW).linkedinConnectedAt;
    }),
    marquerSuivi: vi.fn(async (...a: any[]) => { db.suivis.push(a); }),
    deconnecterCompte: vi.fn(async (c: any, at: Date) => { db.deconnexions.push({ ...c, at }); }),
    reconnecterCompte: vi.fn(async (c: any) => { db.reconnexions.push({ ...c }); }),
    fuseau: vi.fn(async () => "Europe/Paris"),
    messagesConversation: vi.fn(async (cid: number) => db.messages.filter((m) => m.conversationId === cid)),
    adressesPropres: vi.fn(async () => ["jeanne@gmail.com"]),
  };
  return { db, deps, lead };
}

const reponseLinkedIn = (over: Partial<EvenementNormalise> = {}): EvenementNormalise => ({
  kind: "message", accountId: "acc-li", providerMessageId: "msg-1", chatId: "chat-1", fromSelf: false,
  senderProviderId: "ACo-marc", body: "Avec plaisir, on s'appelle jeudi ?", sentAt: new Date("2026-11-02T09:30:00Z"), ...over,
});

describe("traiterEvenement — vraie réponse", () => {
  it("réponse LinkedIn : arrêt, conversation à traiter, tâche, stade, feedback", async () => {
    const { db, deps, lead } = fausseBase();
    await traiterEvenement(reponseLinkedIn(), deps);

    expect(db.state.status).toBe("stopped_replied");
    expect(db.state.repliedAt).toEqual(new Date("2026-11-02T09:30:00Z"));
    expect(db.state.nextRunAt).toBeNull();
    expect(db.brouillonsSupprimes).toBe(1);
    expect(db.outreach[0]).toMatchObject({ responseReceived: true, responseDate: new Date("2026-11-02T09:30:00Z") });
    expect(lead.stage).toBe("in_discussion");
    expect(db.feedback).toBe(1);

    expect(db.conversations).toHaveLength(1);
    const conv = db.conversations[0];
    expect(conv).toMatchObject({ leadId: 7, channel: "linkedin", statut: "a_traiter", nonLu: true, providerChatId: "chat-1", unipileAccountId: "acc-li" });
    expect(conv.etatAvantReponse).toMatchObject({ status: "active", currentStep: 1 });
    expect(db.messages).toEqual([expect.objectContaining({ providerMessageId: "msg-1", sens: "entrant", nature: "reponse", conversationId: conv.id })]);

    expect(db.tasks).toHaveLength(1);
    expect(db.tasks[0]).toMatchObject({
      userId: "u1", title: "Répondre à Marc Dupont (Acme) — LinkedIn", type: "outreach", category: "conversion",
      leadId: 7, projectId: 3, scheduledDate: "2026-11-02", estimatedDuration: 10, source: "reponse_prospect",
      actionData: { lien: `/outreach?onglet=reponses&conversation=${conv.id}` },
    });
    expect(conv.taskId).toBe(db.tasks[0].id);
  });

  it("R13 : l'état d'avant garde le stade d'avant (s'il est déplacé) et l'instant de la réponse", async () => {
    const { db, deps } = fausseBase();
    await traiterEvenement(reponseLinkedIn(), deps);
    expect(db.conversations[0].etatAvantReponse).toMatchObject({
      stageAvant: "connection_sent", repondueLe: "2026-11-02T09:30:00.000Z",
    });
  });

  it("R13 : stade non déplacé (déjà en discussion ou plus loin) → pas de stageAvant", async () => {
    const { db, deps, lead } = fausseBase();
    lead.stage = "proposal_sent";
    await traiterEvenement(reponseLinkedIn(), deps);
    expect(db.conversations[0].etatAvantReponse.stageAvant).toBeUndefined();
    expect(lead.stage).toBe("proposal_sent");
  });

  it("même événement deux fois : une tâche, un message", async () => {
    const { db, deps } = fausseBase();
    await traiterEvenement(reponseLinkedIn(), deps);
    await traiterEvenement(reponseLinkedIn(), deps);
    expect(db.tasks).toHaveLength(1);
    expect(db.messages).toHaveLength(1);
    expect(db.feedback).toBe(1);
  });

  it("deuxième réponse avant que Jeanne réponde : pas de seconde tâche, état d'avant gardé", async () => {
    const { db, deps } = fausseBase();
    await traiterEvenement(reponseLinkedIn(), deps);
    await traiterEvenement(reponseLinkedIn({ providerMessageId: "msg-2", body: "Ou vendredi ?", sentAt: new Date("2026-11-02T09:40:00Z") }), deps);
    expect(db.tasks).toHaveLength(1);
    expect(db.messages).toHaveLength(2);
    expect(db.conversations[0].etatAvantReponse).toMatchObject({ status: "active" });
    expect(db.state.repliedAt).toEqual(new Date("2026-11-02T09:30:00Z"));
  });

  it("une nouvelle réponse après une tâche cochée en recrée une", async () => {
    const { db, deps } = fausseBase();
    await traiterEvenement(reponseLinkedIn(), deps);
    db.tasks[0].completed = true;
    await traiterEvenement(reponseLinkedIn({ providerMessageId: "msg-2", sentAt: new Date("2026-11-02T11:00:00Z") }), deps);
    expect(db.tasks).toHaveLength(2);
    expect(db.conversations[0].taskId).toBe(db.tasks[1].id);
  });

  it("« stop » : en plus, désinscrit", async () => {
    const { db, deps } = fausseBase();
    await traiterEvenement(reponseLinkedIn({ body: "Stop" }), deps);
    expect(db.state.status).toBe("unsubscribed");
    expect(db.tasks).toHaveLength(1);
  });

  it("stade jamais reculé, no_follow jamais touché", async () => {
    for (const stage of ["proposal_sent", "signed", "no_follow", "in_discussion"]) {
      const { deps, lead } = fausseBase();
      lead.stage = stage;
      await traiterEvenement(reponseLinkedIn(), deps);
      expect(lead.stage).toBe(stage);
    }
  });

  it("réponse par email : rattachée par l'adresse, tâche « — email »", async () => {
    const { db, deps } = fausseBase();
    await traiterEvenement({
      kind: "mail", accountId: "acc-gm", providerMessageId: "mail-1", threadId: "th-1", fromSelf: false,
      senderEmail: "marc@acme.fr", subject: "Re: Acme", body: "Oui, intéressé.", sentAt: new Date("2026-11-02T09:00:00Z"),
    }, deps);
    expect(db.conversations[0]).toMatchObject({ channel: "email", providerChatId: "th-1" });
    expect(db.messages[0]).toMatchObject({ subject: "Re: Acme", nature: "reponse" });
    expect(db.tasks[0].title).toBe("Répondre à Marc Dupont (Acme) — email");
  });
});

describe("traiterEvenement — messages de Jeanne", () => {
  it("fromSelf sans conversation : rien", async () => {
    const { db, deps } = fausseBase();
    await traiterEvenement(reponseLinkedIn({ fromSelf: true, providerMessageId: "moi-1" }), deps);
    expect(db.conversations).toHaveLength(0);
    expect(db.messages).toHaveLength(0);
    expect(db.state.status).toBe("active");
  });

  it("fil ne contenant que le message de Jeanne (acceptation avec note) : aucun arrêt", async () => {
    const { db, deps } = fausseBase();
    await traiterEvenement(reponseLinkedIn({ fromSelf: true, providerMessageId: "note-1", body: "Ravie d'échanger, Marc." }), deps);
    expect(db.state.status).toBe("active");
    expect(db.tasks).toHaveLength(0);
    expect(db.ecrituresEtat).toHaveLength(0);
  });

  it("Jeanne répond depuis son téléphone : conversation traitée, tâche cochée", async () => {
    const { db, deps } = fausseBase();
    await traiterEvenement(reponseLinkedIn(), deps);
    await traiterEvenement(reponseLinkedIn({ fromSelf: true, providerMessageId: "moi-1", sentAt: new Date("2026-11-02T10:00:00Z") }), deps);
    expect(db.messages[1]).toMatchObject({ sens: "sortant", nature: "nous" });
    expect(db.conversations[0].statut).toBe("traitee");
    expect(db.tasks[0].completed).toBe(true);
  });

  it("message de Jeanne plus ancien que la dernière réponse : la conversation reste à traiter", async () => {
    const { db, deps } = fausseBase();
    await traiterEvenement(reponseLinkedIn(), deps);
    await traiterEvenement(reponseLinkedIn({ fromSelf: true, providerMessageId: "moi-0", sentAt: new Date("2026-11-02T09:00:00Z") }), deps);
    expect(db.conversations[0].statut).toBe("a_traiter");
    expect(db.tasks[0].completed).toBe(false);
  });
});

describe("traiterEvenement — notre propre email renvoyé comme « reçu »", () => {
  it("adressé au prospect et pas envoyé par lui : traité comme un message de Jeanne, aucun arrêt", async () => {
    const { db, deps } = fausseBase();
    db.conversations.push({ id: 1, leadId: 7, channel: "email", providerChatId: "th-1", statut: "traitee", nonLu: false, taskId: null });
    await traiterEvenement({
      kind: "mail", accountId: "acc-gm", providerMessageId: "em-naya", threadId: "th-1", fromSelf: false,
      senderEmail: "jeanne@gmail.com", destinataires: ["marc@acme.fr"], body: "Bonjour Marc", sentAt: NOW,
    }, deps);
    expect(db.state.status).toBe("active");
    expect(db.tasks).toHaveLength(0);
    expect(db.messages[0]).toMatchObject({ sens: "sortant", nature: "nous" });
  });

  it("I1 : réponse à tous d'un collègue (rattachée par le fil, prospect en To) : c'est une RÉPONSE, la séquence s'arrête", async () => {
    const { db, deps } = fausseBase();
    db.conversations.push({ id: 1, leadId: 7, channel: "email", providerChatId: "th-1", statut: "traitee", nonLu: false, taskId: null, etatAvantReponse: null });
    await traiterEvenement({
      kind: "mail", accountId: "acc-gm", providerMessageId: "coll-1", threadId: "th-1", fromSelf: false,
      senderEmail: "assistante@acme.fr", destinataires: ["marc@acme.fr", "jeanne@gmail.com"],
      subject: "Re: Acme", body: "Marc est intéressé, voici ses dispos.", sentAt: new Date("2026-11-02T09:40:00Z"),
    }, deps);
    expect(db.state.status).toBe("stopped_replied");
    expect(db.conversations[0]).toMatchObject({ statut: "a_traiter", nonLu: true });
    expect(db.messages[0]).toMatchObject({ sens: "entrant", nature: "reponse" });
    expect(db.tasks).toHaveLength(1);
  });

  it("I1 : expéditeur = adresse du Gmail de Jeanne (casse/espaces différents) : c'est nous", async () => {
    const { db, deps } = fausseBase();
    db.conversations.push({ id: 1, leadId: 7, channel: "email", providerChatId: "th-1", statut: "traitee", nonLu: false, taskId: null });
    await traiterEvenement({
      kind: "mail", accountId: "acc-gm", providerMessageId: "moi-gm", threadId: "th-1", fromSelf: false,
      senderEmail: " Jeanne@Gmail.com", destinataires: ["marc@acme.fr"], body: "Relance", sentAt: NOW,
    }, deps);
    expect(db.state.status).toBe("active");
    expect(db.tasks).toHaveLength(0);
    expect(db.messages[0]).toMatchObject({ sens: "sortant", nature: "nous" });
    expect(deps.adressesPropres).toHaveBeenCalledWith({ userId: "u1", projectId: null, canal: "email" }, "acc-gm");
  });

  it("I1 : lecture des adresses propres en échec → réponse (jamais avalée)", async () => {
    const { db, deps } = fausseBase();
    db.conversations.push({ id: 1, leadId: 7, channel: "email", providerChatId: "th-1", statut: "traitee", nonLu: false, taskId: null, etatAvantReponse: null });
    deps.adressesPropres = vi.fn(async () => { throw new Error("db"); });
    await traiterEvenement({
      kind: "mail", accountId: "acc-gm", providerMessageId: "x-1", threadId: "th-1", fromSelf: false,
      senderEmail: "jeanne@gmail.com", destinataires: ["marc@acme.fr"], body: "Re", sentAt: NOW,
    }, deps);
    expect(db.state.status).toBe("stopped_replied");
  });

  it("I1 : adressesPropresDepuis — utilisatrice : expédition + Gmail ; client : senderEmail du client seulement", async () => {
    const s: any = {
      getUserPreferences: vi.fn(async () => ({ prospectionSenderEmail: "Jeanne@Agence.com" })),
      getConnexionProjet: vi.fn(async () => ({ senderEmail: "contact@client.fr" })),
    };
    const gm = vi.fn(async () => "jeanne@gmail.com");
    expect(await adressesPropresDepuis(s, { userId: "u1", projectId: null, canal: "email" }, "acc-gm", gm))
      .toEqual(["jeanne@agence.com", "jeanne@gmail.com"]);
    expect(await adressesPropresDepuis(s, { userId: "u1", projectId: 9, canal: "linkedin" }, "acc-li", gm))
      .toEqual(["contact@client.fr"]);
    expect(s.getConnexionProjet).toHaveBeenCalledWith("u1", 9);
  });

  it("écho Gmail d'une réponse envoyée depuis la boîte (autre identifiant, même texte < 10 min) : pas de doublon, conversation traitée", async () => {
    const { db, deps } = fausseBase();
    await traiterEvenement({
      kind: "mail", accountId: "acc-gm", providerMessageId: "rep-1", threadId: "th-1", fromSelf: false, senderEmail: "marc@acme.fr",
      subject: "Re: Votre offre", body: "Oui, parlons-en.", sentAt: new Date("2026-11-02T09:00:00Z"),
    }, deps);
    const conv = db.conversations[0];
    // La réponse envoyée depuis Naya, stockée avec l'id renvoyé par Unipile à l'envoi.
    db.messages.push({ conversationId: conv.id, providerMessageId: "unipile-envoi-1", sens: "sortant", nature: "nous",
      body: "Avec plaisir, mardi ?", sentAt: new Date("2026-11-02T09:55:00Z") });
    await traiterEvenement({
      kind: "mail", accountId: "acc-gm", providerMessageId: "gmail-echo-1", threadId: "th-1", fromSelf: true,
      destinataires: ["marc@acme.fr"], body: " Avec plaisir, mardi ? ", sentAt: new Date("2026-11-02T09:56:00Z"),
    }, deps);
    expect(db.messages.filter((m) => m.sens === "sortant")).toHaveLength(1);
    expect(conv.statut).toBe("traitee");
    // Même texte mais hors fenêtre : c'est un autre message, il est stocké.
    await traiterEvenement({
      kind: "mail", accountId: "acc-gm", providerMessageId: "gmail-2", threadId: "th-1", fromSelf: true,
      destinataires: ["marc@acme.fr"], body: "Avec plaisir, mardi ?", sentAt: new Date("2026-11-02T10:30:00Z"),
    }, deps);
    expect(db.messages.filter((m) => m.sens === "sortant")).toHaveLength(2);
  });
});

describe("traiterEvenement — automatiques, relations, suivi, comptes", () => {
  it("absence : message stocké, nextRunAt décalé, état toujours active, pas de tâche", async () => {
    const { db, deps } = fausseBase();
    await traiterEvenement({
      kind: "mail", accountId: "acc-gm", providerMessageId: "ooo-1", fromSelf: false, senderEmail: "marc@acme.fr",
      subject: "Absence", body: "Je suis absent du bureau jusqu'au 12 novembre.", sentAt: NOW,
    }, deps);
    expect(db.state.status).toBe("active");
    expect(db.state.nextRunAt.toISOString().slice(0, 10)).toBe("2026-11-13");
    expect(db.tasks).toHaveLength(0);
    expect(db.messages[0]).toMatchObject({ nature: "absence" });
    expect(db.conversations[0]).toMatchObject({ statut: "traitee", nonLu: false });
    expect(db.feedback).toBe(0);
  });

  it("accusé : stocké, rien d'autre", async () => {
    const { db, deps } = fausseBase();
    await traiterEvenement({
      kind: "mail", accountId: "acc-gm", providerMessageId: "ack-1", fromSelf: false, senderEmail: "marc@acme.fr",
      body: "Nous avons bien reçu votre message.", headers: { "auto-submitted": "auto-replied" }, sentAt: NOW,
    }, deps);
    expect(db.messages[0]).toMatchObject({ nature: "accuse" });
    expect(db.ecrituresEtat).toHaveLength(0);
    expect(db.tasks).toHaveLength(0);
  });

  it("new_relation plus récente que l'existante : date existante gardée, stade inchangé", async () => {
    const { db, deps, lead } = fausseBase();
    lead.linkedinConnectedAt = new Date("2026-10-31T08:00:00Z");
    await traiterEvenement({ kind: "relation", accountId: "acc-li", fromSelf: false, senderProviderId: "ACo-marc", sentAt: NOW }, deps);
    expect(deps.setLeadLinkedinConnected).toHaveBeenCalledWith(7, NOW);
    expect(lead.linkedinConnectedAt).toEqual(new Date("2026-10-31T08:00:00Z"));
    expect(lead.stage).toBe("connection_sent");
    expect(db.messages).toHaveLength(0);
  });

  it("suivi : ouverture rattachée au message de l'étape du label", async () => {
    const { db, deps } = fausseBase();
    await traiterEvenement({ kind: "suivi", accountId: "acc-gm", fromSelf: false, suivi: "ouvert", label: "lead:7:step:2", sentAt: NOW }, deps);
    expect(db.suivis).toEqual([["u1", 7, 2, "openedAt", NOW]]);
    await traiterEvenement({ kind: "suivi", accountId: "acc-gm", fromSelf: false, suivi: "clic", label: "pas-a-nous", sentAt: NOW }, deps);
    expect(db.suivis).toHaveLength(1);
  });

  it("compte en erreur : déconnecté sur son canal ; CONNECTING : rien ; OK / RECONNECTED : reconnecté", async () => {
    const { db, deps } = fausseBase();
    await traiterEvenement({ kind: "compte", accountId: "acc-li", fromSelf: false, statutCompte: "CONNECTING", sentAt: NOW }, deps);
    expect(db.deconnexions).toHaveLength(0);
    expect(db.reconnexions).toHaveLength(0);
    await traiterEvenement({ kind: "compte", accountId: "acc-li", fromSelf: false, statutCompte: "CREDENTIALS", sentAt: NOW }, deps);
    expect(db.deconnexions).toEqual([{ userId: "u1", projectId: null, canal: "linkedin", at: NOW }]);
    await traiterEvenement({ kind: "compte", accountId: "acc-gm", fromSelf: false, statutCompte: "OK", sentAt: NOW }, deps);
    await traiterEvenement({ kind: "compte", accountId: "acc-li", fromSelf: false, statutCompte: "RECONNECTED", sentAt: NOW }, deps);
    expect(db.reconnexions).toEqual([{ userId: "u1", projectId: null, canal: "email" }, { userId: "u1", projectId: null, canal: "linkedin" }]);
  });

  it("compte déconnecté : ses webhooks restent rattachés (l'identifiant n'est pas retiré)", async () => {
    const { db, deps } = fausseBase();
    await traiterEvenement({ kind: "compte", accountId: "acc-li", fromSelf: false, statutCompte: "ERROR", sentAt: NOW }, deps);
    await traiterEvenement(reponseLinkedIn(), deps);
    expect(db.state.status).toBe("stopped_replied");
  });

  it("compte inconnu : aucune écriture", async () => {
    const { db, deps } = fausseBase();
    await traiterEvenement(reponseLinkedIn({ accountId: "inconnu" }), deps);
    await traiterEvenement({ kind: "compte", accountId: "inconnu", fromSelf: false, statutCompte: "ERROR", sentAt: NOW }, deps);
    expect(db.conversations).toHaveLength(0);
    expect(db.messages).toHaveLength(0);
    expect(db.deconnexions).toHaveLength(0);
    expect(deps.leadParProviderId).not.toHaveBeenCalled();
  });

  it("aucun lead : rien n'est stocké", async () => {
    const { db, deps } = fausseBase();
    await traiterEvenement({
      kind: "mail", accountId: "acc-gm", providerMessageId: "perso-1", fromSelf: false, senderEmail: "maman@famille.fr", body: "Bisous", sentAt: NOW,
    }, deps);
    expect(db.conversations).toHaveLength(0);
    expect(db.messages).toHaveLength(0);
  });
});

describe("traiterEvenement — robustesse (revue)", () => {
  it("création de tâche en échec : la réponse reste enregistrée, à traiter, séquence arrêtée", async () => {
    const { db, deps } = fausseBase();
    (deps.createTask as any).mockRejectedValueOnce(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await traiterEvenement(reponseLinkedIn(), deps);
    expect(db.state.status).toBe("stopped_replied");
    expect(db.conversations[0]).toMatchObject({ statut: "a_traiter", nonLu: true, taskId: null });
    expect(db.conversations[0].etatAvantReponse).toMatchObject({ status: "active" });
    expect(db.messages).toHaveLength(1);
    expect(db.feedback).toBe(1); // les suites indépendantes continuent
  });

  it("deux réponses simultanées : la tâche perdante est supprimée (une seule tâche)", async () => {
    const { db, deps } = fausseBase();
    (deps.attacherTache as any).mockImplementationOnce(async () => false);
    await traiterEvenement(reponseLinkedIn(), deps);
    expect(deps.supprimerTache).toHaveBeenCalledWith(100);
    expect(db.tasks).toHaveLength(0);
  });

  const chatExistant = (db: any) =>
    db.conversations.push({ id: 1, leadId: 7, channel: "linkedin", providerChatId: "chat-1", statut: "traitee", nonLu: false, taskId: null });

  it("identifiant stocké dans un autre format, absent des participants : c'est une RÉPONSE (jamais avalée)", async () => {
    const { db, deps } = fausseBase();
    chatExistant(db);
    // Stocké « ACo-marc », le webhook parle d'« ACw-marc » (Sales Nav) : aucune preuve que ce n'est pas lui.
    await traiterEvenement(reponseLinkedIn({ senderProviderId: "ACw-marc", participants: ["ACw-marc", "ACw-jeanne"] }), deps);
    expect(db.state.status).toBe("stopped_replied");
    expect(db.messages[0]).toMatchObject({ sens: "entrant", nature: "reponse" });
    expect(db.tasks).toHaveLength(1);
  });

  it("sans participants dans le payload : réponse aussi", async () => {
    const { db, deps } = fausseBase();
    chatExistant(db);
    await traiterEvenement(reponseLinkedIn({ senderProviderId: "ACw-marc" }), deps);
    expect(db.state.status).toBe("stopped_replied");
  });

  it("identifiant stocké présent parmi les participants et expéditeur différent : c'est Jeanne", async () => {
    const { db, deps } = fausseBase();
    chatExistant(db);
    await traiterEvenement(reponseLinkedIn({ senderProviderId: "ACo-jeanne", participants: ["ACo-marc", "ACo-jeanne"] }), deps);
    expect(db.state.status).toBe("active");
    expect(db.tasks).toHaveLength(0);
    expect(db.messages[0]).toMatchObject({ sens: "sortant", nature: "nous" });
  });

  it("is_sender (fromSelf) : c'est Jeanne", async () => {
    const { db, deps } = fausseBase();
    chatExistant(db);
    await traiterEvenement(reponseLinkedIn({ fromSelf: true, senderProviderId: "ACw-marc" }), deps);
    expect(db.state.status).toBe("active");
    expect(db.messages[0]).toMatchObject({ sens: "sortant" });
  });
});

describe("normaliser", () => {
  it("message LinkedIn reçu", () => {
    const e = normaliser({
      event: "message_received", account_id: "acc-li", account_info: { type: "LINKEDIN", user_id: "ACo-jeanne" },
      chat_id: "chat-1", message_id: "msg-1", message: "Bonjour", timestamp: "2026-11-02T09:30:00.000Z",
      sender: { attendee_provider_id: "ACo-marc", attendee_profile_url: "https://www.linkedin.com/in/marc-dupont/" },
      attendees: [{ attendee_provider_id: "ACo-jeanne" }, { attendee_provider_id: "ACo-marc" }],
    });
    expect(e).toMatchObject({ kind: "message", accountId: "acc-li", providerMessageId: "msg-1", chatId: "chat-1", fromSelf: false, senderProviderId: "ACo-marc", senderPublicId: "marc-dupont", body: "Bonjour", participants: ["ACo-jeanne", "ACo-marc"] });
    expect(e!.sentAt.toISOString()).toBe("2026-11-02T09:30:00.000Z");
  });

  it("message LinkedIn envoyé par Jeanne : fromSelf, l'interlocuteur est l'autre participant", () => {
    const e = normaliser({
      event: "message_received", account_id: "acc-li", account_info: { user_id: "ACo-jeanne" }, chat_id: "c", message_id: "m",
      message: "Hello", timestamp: "2026-11-02T09:30:00Z", sender: { attendee_provider_id: "ACo-jeanne" },
      attendees: [{ attendee_provider_id: "ACo-jeanne" }, { attendee_provider_id: "ACo-marc", attendee_profile_url: "https://www.linkedin.com/in/marc" }],
    });
    expect(e).toMatchObject({ fromSelf: true, senderProviderId: "ACo-marc", senderPublicId: "marc" });
  });

  it("email reçu : texte brut, adresse en minuscules, fil et réponse à", () => {
    const e = normaliser({
      event: "mail_received", account_id: "acc-gm", email_id: "em-1", provider_id: "gm-1", message_id: "<x@mail>", thread_id: "th-1",
      date: "2026-11-02T09:00:00Z", from_attendee: { identifier: " Marc@Acme.fr " }, to_attendees: [{ identifier: "jeanne@gmail.com" }],
      subject: "Re: Acme", body: "<p>Oui</p>", body_plain: "Oui", folders: ["INBOX"], in_reply_to: { message_id: "<y@mail>", id: "em-0" },
      headers: [{ name: "Auto-Submitted", value: "auto-replied" }],
    });
    expect(e).toMatchObject({ kind: "mail", providerMessageId: "em-1", threadId: "th-1", fromSelf: false, senderEmail: "marc@acme.fr", body: "Oui", subject: "Re: Acme", destinataires: ["jeanne@gmail.com"] });
    expect(e!.inReplyTo).toEqual(["em-0", "<y@mail>"]);
    expect(e!.headers).toEqual({ "auto-submitted": "auto-replied" });
  });

  it("email envoyé (dossier Envoyés) : fromSelf, interlocuteur = destinataire ; HTML sans citation", () => {
    const e = normaliser({
      event: "mail_received", account_id: "acc-gm", email_id: "em-2", date: "2026-11-02T09:00:00Z", role: "sent",
      from_attendee: { identifier: "jeanne@gmail.com" }, to_attendees: [{ identifier: "marc@acme.fr" }],
      body: "<div>Merci&nbsp;Marc</div><blockquote>vieux texte</blockquote>",
    });
    expect(e).toMatchObject({ fromSelf: true, senderEmail: "marc@acme.fr", body: "Merci Marc" });
  });

  it("is_sender présent : fromSelf même si les identifiants diffèrent", () => {
    const e = normaliser({
      event: "message_received", account_id: "acc-li", account_info: { user_id: "urn-x" }, chat_id: "c", message_id: "m",
      message: "Hello", is_sender: true, sender: { attendee_provider_id: "ACo-jeanne" },
      attendees: [{ attendee_provider_id: "ACo-marc" }],
    });
    expect(e).toMatchObject({ fromSelf: true, senderProviderId: "ACo-marc" });
  });

  it("relation, suivi, statut de compte ; inconnus → null", () => {
    expect(normaliser({ event: "new_relation", account_id: "acc-li", user_provider_id: "ACo-marc", user_public_identifier: "marc" }))
      .toMatchObject({ kind: "relation", senderProviderId: "ACo-marc", senderPublicId: "marc", fromSelf: false });
    expect(normaliser({ event: "mail_opened", account_id: "acc-gm", label: "lead:7:step:2", date: "2026-11-02T09:00:00Z" }))
      .toMatchObject({ kind: "suivi", suivi: "ouvert", label: "lead:7:step:2" });
    expect(normaliser({ event: "mail_link_clicked", account_id: "acc-gm", label: "lead:7:step:2" })).toMatchObject({ suivi: "clic" });
    expect(normaliser({ AccountStatus: { account_id: "acc-li", account_type: "LINKEDIN", message: "CREDENTIALS" } }))
      .toMatchObject({ kind: "compte", accountId: "acc-li", statutCompte: "CREDENTIALS" });
    expect(normaliser({ event: "message_reaction", account_id: "a" })).toBeNull();
    expect(normaliser({ event: "message_received" })).toBeNull();
    expect(normaliser(null)).toBeNull();
    expect(normaliser("texte")).toBeNull();
  });
});
