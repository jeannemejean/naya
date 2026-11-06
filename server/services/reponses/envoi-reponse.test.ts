import { describe, it, expect, vi } from "vitest";
import { envoyerReponse, cleEnAttente, type DepsEnvoiReponse } from "./envoi-reponse";

const NOW = new Date("2026-11-02T10:00:00Z");

function monde(o: { channel?: "linkedin" | "email"; restriction?: any; deconnecte?: boolean; sansCompte?: boolean; envoiActif?: boolean } = {}) {
  const channel = o.channel ?? "linkedin";
  const conv: any = {
    id: 11, userId: "u1", projectId: null, leadId: 7, channel, unipileAccountId: channel === "linkedin" ? "acc-li" : "acc-gm",
    providerChatId: channel === "linkedin" ? "chat-1" : "thread-1", statut: "a_traiter", nonLu: false, taskId: 99,
    etatAvantReponse: null, lastMessageAt: new Date("2026-11-01T09:00:00Z"),
  };
  const messages: any[] = [
    { id: 1, conversationId: 11, providerMessageId: "m-ancien", sens: "entrant", nature: "reponse", subject: "Votre offre", body: "x", sentAt: new Date("2026-10-30T09:00:00Z") },
    { id: 2, conversationId: 11, providerMessageId: "m-nous", sens: "sortant", nature: "nous", subject: "Re: Votre offre", body: "y", sentAt: new Date("2026-10-31T09:00:00Z") },
    { id: 3, conversationId: 11, providerMessageId: "m-dernier", sens: "entrant", nature: "reponse", subject: "Re: Votre offre", body: "z", sentAt: new Date("2026-11-01T09:00:00Z") },
  ];
  const tasks = new Map<number, any>([[99, { id: 99, completed: false }]]);
  const identite: any = {
    email: o.sansCompte ? null : { fromEmail: "j@x.fr", fromName: "Jeanne", apiKeyChiffree: null, footerAddress: "", unipileAccountId: "acc-gm", deconnecte: !!o.deconnecte },
    linkedin: o.sansCompte ? null : { accountId: "acc-li", connectedAt: new Date("2026-01-01"), restriction: o.restriction ?? null, deconnecte: !!o.deconnecte },
    signature: null,
  };
  const deps: DepsEnvoiReponse = {
    now: () => NOW,
    envoiActif: () => o.envoiActif ?? true,
    getConversation: vi.fn(async (id: number, userId: string) => (id === 11 && userId === "u1" ? conv : undefined)),
    getLead: vi.fn(async () => ({ id: 7, name: "Marc Dupont", email: "marc@acme.fr" } as any)),
    estDesinscrit: vi.fn(async () => false),
    getMessages: vi.fn(async () => messages),
    identite: vi.fn(async () => ({ portee: null, identite })),
    envoyerLinkedIn: vi.fn(async () => ({ ok: true, messageId: "li-msg-1" })),
    envoyerEmail: vi.fn(async () => ({ ok: true, providerId: "gm-msg-1" })),
    journaliserTentativeLinkedIn: vi.fn(async () => {}),
    persisterRestriction: vi.fn(async () => {}),
    ajouterMessage: vi.fn(async () => true),
    finaliserEnvoi: vi.fn(async () => {}),
    supprimerMessage: vi.fn(async () => {}),
    updateConversation: vi.fn(async (_id: number, p: any) => { Object.assign(conv, p); }),
    getTask: vi.fn(async (id: number) => tasks.get(id)),
    completeTask: vi.fn(async (id: number) => { tasks.get(id).completed = true; }),
  };
  return { deps, conv, tasks, messages };
}

describe("envoyerReponse", () => {
  it.each(["linkedin", "email"] as const)("%s : prospect désinscrit (ou sur « ne plus contacter ») → desinscrit, rien envoyé ni réservé", async (channel) => {
    const { deps } = monde({ channel });
    (deps.estDesinscrit as any).mockResolvedValue(true);
    expect(await envoyerReponse(11, "u1", "Bonjour", deps)).toEqual({ ok: false, raison: "desinscrit" });
    expect(deps.estDesinscrit).toHaveBeenCalledWith(7, "u1");
    expect(deps.envoyerLinkedIn).not.toHaveBeenCalled();
    expect(deps.envoyerEmail).not.toHaveBeenCalled();
    expect(deps.ajouterMessage).not.toHaveBeenCalled();
  });

  it("désinscription illisible : refus par prudence", async () => {
    const { deps } = monde();
    (deps.estDesinscrit as any).mockRejectedValue(new Error("db"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await envoyerReponse(11, "u1", "Bonjour", deps)).toEqual({ ok: false, raison: "desinscrit" });
    expect(deps.envoyerLinkedIn).not.toHaveBeenCalled();
  });

  it("kill-switch coupé : envoi_coupe, rien envoyé ni écrit", async () => {
    const { deps } = monde({ envoiActif: false });
    expect(await envoyerReponse(11, "u1", "Bonjour", deps)).toEqual({ ok: false, raison: "envoi_coupe" });
    expect(deps.envoyerLinkedIn).not.toHaveBeenCalled();
    expect(deps.envoyerEmail).not.toHaveBeenCalled();
    expect(deps.journaliserTentativeLinkedIn).not.toHaveBeenCalled();
    expect(deps.updateConversation).not.toHaveBeenCalled();
  });

  it("LinkedIn restreint : compte_restreint, rien envoyé", async () => {
    const { deps } = monde({ restriction: { restrictedAt: new Date("2026-10-30") } });
    expect(await envoyerReponse(11, "u1", "Bonjour", deps)).toEqual({ ok: false, raison: "compte_restreint" });
    expect(deps.envoyerLinkedIn).not.toHaveBeenCalled();
    expect(deps.journaliserTentativeLinkedIn).not.toHaveBeenCalled();
  });

  it("compte déconnecte : compte_deconnecte ; aucun compte : compte_absent", async () => {
    const a = monde({ deconnecte: true });
    expect(await envoyerReponse(11, "u1", "Bonjour", a.deps)).toEqual({ ok: false, raison: "compte_deconnecte" });
    const b = monde({ sansCompte: true });
    expect(await envoyerReponse(11, "u1", "Bonjour", b.deps)).toEqual({ ok: false, raison: "compte_absent" });
    expect(a.deps.envoyerLinkedIn).not.toHaveBeenCalled();
    expect(b.deps.envoyerLinkedIn).not.toHaveBeenCalled();
  });

  it("le compte du périmètre n'est plus celui qui porte la conversation : compte_absent", async () => {
    const { deps, conv } = monde();
    conv.unipileAccountId = "acc-ancien";
    expect(await envoyerReponse(11, "u1", "Bonjour", deps)).toEqual({ ok: false, raison: "compte_absent" });
    expect(deps.envoyerLinkedIn).not.toHaveBeenCalled();
  });

  it("LinkedIn, plafond hebdomadaire atteint : envoyé quand même (aucune garde de plafond) et compté", async () => {
    const { deps } = monde();
    expect(await envoyerReponse(11, "u1", "  Avec plaisir, mardi ?  ", deps)).toEqual({ ok: true });
    expect(deps.envoyerLinkedIn).toHaveBeenCalledWith({ accountId: "acc-li", chatId: "chat-1", text: "Avec plaisir, mardi ?" });
    expect(deps.journaliserTentativeLinkedIn).toHaveBeenCalledWith("u1", 7, true, null, null);
  });

  it("LinkedIn, signal de restriction au retour : tentative comptée, compte mis en pause, compte_restreint", async () => {
    const { deps, conv } = monde();
    (deps.envoyerLinkedIn as any).mockResolvedValueOnce({ ok: false, error: "http_403 account restricted" });
    expect(await envoyerReponse(11, "u1", "Bonjour", deps)).toEqual({ ok: false, raison: "compte_restreint" });
    expect(deps.journaliserTentativeLinkedIn).toHaveBeenCalledWith("u1", 7, false, "http_403 account restricted", null);
    expect(deps.persisterRestriction).toHaveBeenCalledWith("u1", null, "http_403 account restricted");
    expect(conv.statut).toBe("a_traiter");
  });

  it("LinkedIn, échec ordinaire : echec, tentative comptée, conversation inchangée", async () => {
    const { deps, conv } = monde();
    (deps.envoyerLinkedIn as any).mockResolvedValueOnce({ ok: false, error: "http_500 boom" });
    expect(await envoyerReponse(11, "u1", "Bonjour", deps)).toEqual({ ok: false, raison: "echec" });
    expect(deps.journaliserTentativeLinkedIn).toHaveBeenCalledWith("u1", 7, false, "http_500 boom", null);
    expect(deps.persisterRestriction).not.toHaveBeenCalled();
    expect(conv.statut).toBe("a_traiter");
    expect(deps.supprimerMessage).toHaveBeenCalledWith(cleEnAttente(11, "Bonjour", NOW)); // réservation retirée
    expect(deps.finaliserEnvoi).not.toHaveBeenCalled();
  });

  it("email : même fil (reply_to = dernier entrant), objet « Re: … », depuis le compte Gmail du périmètre", async () => {
    const { deps } = monde({ channel: "email" });
    expect(await envoyerReponse(11, "u1", "Bonjour Marc,\nOui.", deps)).toEqual({ ok: true });
    const arg = (deps.envoyerEmail as any).mock.calls[0][0];
    expect(arg.accountId).toBe("acc-gm");
    expect(arg.to).toBe("marc@acme.fr");
    expect(arg.replyToProviderId).toBe("m-dernier");
    expect(arg.subject).toBe("Re: Votre offre");
    expect(arg.body).toContain("Bonjour Marc,<br>Oui.");
    expect(deps.journaliserTentativeLinkedIn).not.toHaveBeenCalled();
  });

  it("succès : réservation « en_attente » AVANT l'appel, finalisée avec l'id réel, conversation traitée, tâche cochée", async () => {
    const { deps, conv, tasks } = monde();
    const cle = cleEnAttente(11, "Avec plaisir", NOW);
    expect(cle).toMatch(/^pending:11:[0-9a-f]{64}:\d+$/);
    (deps.envoyerLinkedIn as any).mockImplementationOnce(async () => {
      // La réservation est déjà en base quand le fournisseur est appelé.
      expect(deps.ajouterMessage).toHaveBeenCalledWith(expect.objectContaining({
        conversationId: 11, providerMessageId: cle, sens: "sortant", nature: "en_attente", body: "Avec plaisir", sentAt: NOW,
      }));
      return { ok: true, messageId: "li-msg-1" };
    });
    expect(await envoyerReponse(11, "u1", "Avec plaisir", deps)).toEqual({ ok: true });
    expect(deps.finaliserEnvoi).toHaveBeenCalledWith(cle, "li-msg-1", NOW);
    expect(deps.supprimerMessage).not.toHaveBeenCalled();
    expect(conv.statut).toBe("traitee");
    expect(conv.nonLu).toBe(false);
    expect(conv.lastMessageAt).toEqual(NOW);
    expect(tasks.get(99).completed).toBe(true);
  });

  it("texte vide : echec sans rien envoyer ; conversation d'un autre : introuvable", async () => {
    const { deps } = monde();
    expect(await envoyerReponse(11, "u1", "   ", deps)).toEqual({ ok: false, raison: "texte_vide" });
    expect(await envoyerReponse(11, "u2", "Bonjour", deps)).toEqual({ ok: false, raison: "introuvable" });
    expect(deps.envoyerLinkedIn).not.toHaveBeenCalled();
  });

  it("double clic : le second envoi simultané est refusé (envoi_en_cours)", async () => {
    const { deps } = monde();
    let lacher!: () => void;
    (deps.envoyerLinkedIn as any).mockImplementationOnce(() => new Promise((r) => { lacher = () => r({ ok: true, messageId: "a" }); }));
    const premier = envoyerReponse(11, "u1", "Bonjour", deps);
    await vi.waitFor(() => expect(deps.envoyerLinkedIn).toHaveBeenCalledTimes(1));
    expect(await envoyerReponse(11, "u1", "Bonjour", deps)).toEqual({ ok: false, raison: "envoi_en_cours" });
    lacher();
    expect(await premier).toEqual({ ok: true });
    expect(deps.envoyerLinkedIn).toHaveBeenCalledTimes(1);
  });

  it("une écriture après l'envoi qui échoue ne transforme pas le succès en échec (pas de renvoi)", async () => {
    const { deps } = monde();
    (deps.finaliserEnvoi as any).mockRejectedValueOnce(new Error("db down"));
    expect(await envoyerReponse(11, "u1", "Bonjour", deps)).toEqual({ ok: true });
  });

  it("même texte déjà parti il y a moins de 2 minutes : deja_envoye, rien envoyé", async () => {
    const { deps, messages } = monde();
    messages.push({ id: 4, conversationId: 11, providerMessageId: "li-x", sens: "sortant", nature: "nous", subject: null,
      body: " Bonjour ", sentAt: new Date(NOW.getTime() - 60_000), createdAt: new Date(NOW.getTime() - 60_000) });
    expect(await envoyerReponse(11, "u1", "Bonjour", deps)).toEqual({ ok: false, raison: "deja_envoye" });
    expect(deps.envoyerLinkedIn).not.toHaveBeenCalled();
    expect(deps.ajouterMessage).not.toHaveBeenCalled();
  });

  it("même texte il y a plus de 2 minutes : renvoyé", async () => {
    const { deps, messages } = monde();
    messages.push({ id: 4, conversationId: 11, providerMessageId: "li-x", sens: "sortant", nature: "nous", subject: null,
      body: "Bonjour", sentAt: new Date(NOW.getTime() - 3 * 60_000), createdAt: new Date(NOW.getTime() - 3 * 60_000) });
    expect(await envoyerReponse(11, "u1", "Bonjour", deps)).toEqual({ ok: true });
  });

  it("requête concurrente (autre instance) : la réservation bute sur l'unicité → deja_envoye, rien envoyé", async () => {
    const { deps } = monde({ channel: "email" });
    (deps.ajouterMessage as any).mockResolvedValueOnce(false);
    expect(await envoyerReponse(11, "u1", "Bonjour", deps)).toEqual({ ok: false, raison: "deja_envoye" });
    expect(deps.envoyerEmail).not.toHaveBeenCalled();
  });

  it("email refusé par le fournisseur : réservation retirée", async () => {
    const { deps } = monde({ channel: "email" });
    (deps.envoyerEmail as any).mockResolvedValueOnce({ ok: false, error: "http_500" });
    expect(await envoyerReponse(11, "u1", "Bonjour", deps)).toEqual({ ok: false, raison: "echec" });
    expect(deps.supprimerMessage).toHaveBeenCalledWith(cleEnAttente(11, "Bonjour", NOW));
  });

  it("plus de 8000 caractères : texte_trop_long, rien envoyé", async () => {
    const { deps } = monde();
    expect(await envoyerReponse(11, "u1", "a".repeat(8001), deps)).toEqual({ ok: false, raison: "texte_trop_long" });
    expect(await envoyerReponse(11, "u1", "a".repeat(8000), deps)).toEqual({ ok: true });
    expect(deps.envoyerLinkedIn).toHaveBeenCalledTimes(1);
  });
});
