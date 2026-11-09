import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  validerRelance, refuserRelance, reformulerRelance, vueRelances, relancesAuRequalifier, titreRelance, type DepsRelance,
} from "./relance";
import { relancesDe, avecRelances, estEtatAvant, type DecisionRelance } from "./relance-etat";
import { planEntrant } from "./ingestion";

// Lundi 9 novembre 2026, 10:00 à Paris. Le prospect a répondu le vendredi 6.
const NOW = new Date("2026-11-09T09:00:00Z");
const REPONDU = new Date("2026-11-06T15:00:00Z");
const PREFS = { timezone: "Europe/Paris", workDays: "mon,tue,wed,thu,fri" };

const msg = (o: Partial<any> = {}) => ({
  id: 31, conversationId: 11, providerMessageId: "p31", sens: "entrant", nature: "reponse", subject: "Re: Votre site",
  body: "Merci, pas le moment. On se reparle début 2027 !", sentAt: REPONDU, createdAt: REPONDU, ...o,
}) as any;

/** Un faux stockage en mémoire, avec une réservation atomique comme en SQL. */
function monde(o: { messages?: any[]; etat?: any; sequence?: string | null; tacheRefusee?: boolean } = {}) {
  const conv: any = { id: 11, userId: "u1", leadId: 7, channel: "email", projectId: null, etatAvantReponse: o.etat ?? null };
  const taches = new Map<number, any>();
  let prochainId = 100;
  const decisions = () => relancesDe(conv.etatAvantReponse);
  const poser = (k: number, d: DecisionRelance | null) => {
    const r = { ...decisions() };
    if (d) r[String(k)] = d; else delete r[String(k)];
    conv.etatAvantReponse = { ...(conv.etatAvantReponse ?? {}), relances: r };
  };
  const envoyer = vi.fn();
  const deps = {
    now: () => NOW,
    getConversation: vi.fn(async (id: number, u: string) => (id === 11 && u === "u1" ? { ...conv } : undefined)),
    getMessages: vi.fn(async () => o.messages ?? [msg()]),
    getLead: vi.fn(async () => ({ id: 7, name: "Claire Martin", company: "Acme", projectId: null } as any)),
    getPrefs: vi.fn(async () => PREFS),
    getTask: vi.fn(async (id: number) => taches.get(id)),
    reserver: vi.fn(async (_c: number, k: number, now: Date) => {
      const d = decisions()[String(k)];
      if (d && !(d.statut === "en_cours" && Date.parse(d.le) < now.getTime() - 5 * 60_000)) return false;
      poser(k, { statut: "en_cours", le: now.toISOString() });
      return true;
    }),
    ecrire: vi.fn(async (_c: number, k: number, d: DecisionRelance | null) => { poser(k, d); }),
    refuser: vi.fn(async (_c: number, k: number, now: Date) => {
      const d = decisions()[String(k)];
      if (d && (d.statut === "validee" || d.statut === "en_cours")) return false;
      poser(k, { statut: "refusee", le: now.toISOString() });
      return true;
    }),
    creerTache: vi.fn(async (userId: string, donnees: any) => {
      if (o.tacheRefusee) return { ok: false as const, status: 400, message: "Saturday is not one of your work days." };
      // Laisse la main : deux validations simultanées s'entrelacent vraiment.
      await new Promise((r) => setTimeout(r, 5));
      const t = { id: prochainId++, userId, completed: false, archivedAt: null, ...donnees };
      taches.set(t.id, t);
      return { ok: true as const, tache: t };
    }),
    rediger: vi.fn(async () => "Bonjour Claire,\n\nVous m'aviez dit de revenir vers vous début 2027.\n\nOn en parle 15 minutes ?"),
    etatSequence: vi.fn(async () => (o.sequence === null ? undefined : ({ status: o.sequence ?? "stopped_replied" } as any))),
    arreterSequence: vi.fn(async () => undefined),
  };
  return { conv, taches, deps: deps as typeof deps & DepsRelance, envoyer };
}

describe("vueRelances — la proposition sous la réponse", () => {
  it("propose la date lue dans le texte nouveau de la réponse", async () => {
    const { conv, deps } = monde();
    const v = await vueRelances(conv, [msg()], PREFS, deps);
    expect(v.parMessage[31]).toEqual({ statut: "proposee", date: "2027-01-04" });
    expect(v.prete).toBeNull();
  });

  it("jamais pour une date qui n'est que dans la citation de notre email", async () => {
    const { conv, deps } = monde();
    const cite = msg({
      body: "Merci, je regarde ça.\n\nLe ven. 6 nov. 2026 à 10:12, Jeanne <j@x.fr> a écrit :\n> Revenez vers moi début 2027 si besoin, on se reparle en septembre.",
    });
    const v = await vueRelances(conv, [cite], PREFS, deps);
    expect(v.parMessage[31]).toBeUndefined();
  });

  it("ni pour un message que nous avons envoyé, une absence ou un accusé", async () => {
    const { conv, deps } = monde();
    const v = await vueRelances(conv, [
      msg({ id: 1, sens: "sortant", nature: "nous" }), msg({ id: 2, nature: "absence" }), msg({ id: 3, nature: "accuse" }),
    ], PREFS, deps);
    expect(v.parMessage).toEqual({});
  });

  it("la date doit être à venir au moment où on la regarde", async () => {
    const { conv, deps } = monde();
    const ancien = msg({ body: "Revenez vers moi dans 2 jours.", sentAt: new Date("2026-10-01T09:00:00Z") });
    expect((await vueRelances(conv, [ancien], PREFS, deps)).parMessage).toEqual({});
  });

  it("« Non merci » : plus jamais proposée pour ce message", async () => {
    const { conv, deps } = monde();
    expect(await refuserRelance("u1", 11, 31, deps)).toEqual({ ok: true });
    expect(deps.refuser).toHaveBeenCalledWith(11, 31, NOW);
    expect(relancesDe(conv.etatAvantReponse)["31"]).toMatchObject({ statut: "refusee" });
    expect((await vueRelances(conv, [msg()], PREFS, deps)).parMessage).toEqual({});
    // Une validation après refus n'est pas possible (la décision existe).
    expect(await validerRelance("u1", 11, 31, null, deps)).toMatchObject({ ok: false, raison: "refusee" });
    expect(deps.creerTache).not.toHaveBeenCalled();
  });

  it("« Non merci » ne défait jamais une relance validée", async () => {
    const { deps } = monde();
    await validerRelance("u1", 11, 31, null, deps);
    expect(await refuserRelance("u1", 11, 31, deps)).toEqual({ ok: false, status: 409, raison: "deja_validee" });
  });
});

describe("validerRelance", () => {
  it("crée UNE tâche datée, liée à la conversation, avec le message déjà rédigé — sans rien envoyer", async () => {
    const { conv, deps, taches } = monde();
    const r = await validerRelance("u1", 11, 31, null, deps);
    expect(r).toEqual({ ok: true, taskId: 100, date: "2027-01-04" });
    expect(deps.creerTache).toHaveBeenCalledTimes(1);
    const [userId, donnees] = deps.creerTache.mock.calls[0] as any;
    expect(userId).toBe("u1");
    expect(donnees).toMatchObject({
      title: "Relancer Claire (Acme)", type: "outreach", category: "conversion", leadId: 7,
      scheduledDate: "2027-01-04", source: "relance_prospect",
      actionData: {
        lien: "/outreach?onglet=reponses&conversation=11",
        relance: { conversationId: 11, messageId: 31, date: "2027-01-04", canal: "email" },
      },
    });
    expect(donnees.actionData.relance.texte).toMatch(/^Bonjour Claire,\n\n/);
    // Rédigé avec la phrase du prospect, pour la citer.
    expect(deps.rediger).toHaveBeenCalledWith("u1", 11, { date: "2027-01-04", extrait: "Merci, pas le moment. On se reparle début 2027 !" });
    expect(relancesDe(conv.etatAvantReponse)["31"]).toMatchObject({ statut: "validee", taskId: 100, date: "2027-01-04" });
    expect(taches.size).toBe(1);
  });

  it("double clic (deux requêtes simultanées) : une seule tâche", async () => {
    const { deps, taches } = monde();
    const [a, b] = await Promise.all([
      validerRelance("u1", 11, 31, null, deps), validerRelance("u1", 11, 31, null, deps),
    ]);
    expect(taches.size).toBe(1);
    expect(deps.creerTache).toHaveBeenCalledTimes(1);
    expect(deps.rediger).toHaveBeenCalledTimes(1);
    expect([a, b].filter((x) => x.ok)).toHaveLength(1);
    expect([a, b].find((x) => !x.ok)).toMatchObject({ ok: false, status: 409, raison: "en_cours" });
    // Un troisième clic, après coup : la même tâche, rien de recréé.
    expect(await validerRelance("u1", 11, 31, null, deps)).toMatchObject({ ok: true, taskId: 100, deja: true });
    expect(taches.size).toBe(1);
  });

  it("« Changer la date » : la date choisie, si c'est un jour travaillé à venir", async () => {
    const { deps } = monde();
    expect(await validerRelance("u1", 11, 31, "2027-01-09", deps)).toMatchObject({ ok: false, raison: "jour_non_travaille" }); // samedi
    expect(await validerRelance("u1", 11, 31, "2026-11-09", deps)).toMatchObject({ ok: false, raison: "date_passee" });
    expect(await validerRelance("u1", 11, 31, "2027-02-30", deps)).toMatchObject({ ok: false, raison: "date_invalide" });
    expect(await validerRelance("u1", 11, 31, "2027-02-03", deps)).toMatchObject({ ok: true, date: "2027-02-03" });
    expect(deps.creerTache).toHaveBeenCalledTimes(1);
  });

  it("sans date lisible ni date choisie : rien", async () => {
    const { deps } = monde({ messages: [msg({ body: "Merci, on verra." })] });
    expect(await validerRelance("u1", 11, 31, null, deps)).toMatchObject({ ok: false, raison: "pas_de_date" });
    expect(deps.reserver).not.toHaveBeenCalled();
  });

  it("une conversation d'un autre compte, ou un message qui n'est pas une réponse : 404", async () => {
    const { deps } = monde({ messages: [msg({ nature: "absence" })] });
    expect(await validerRelance("u2", 11, 31, null, deps)).toMatchObject({ ok: false, status: 404 });
    expect(await validerRelance("u1", 11, 31, null, deps)).toMatchObject({ ok: false, status: 404 });
  });

  it("échec de rédaction ou tâche refusée : la réservation est libérée, on peut réessayer", async () => {
    const m1 = monde();
    m1.deps.rediger.mockRejectedValueOnce(new Error("IA indisponible"));
    await expect(validerRelance("u1", 11, 31, null, m1.deps)).rejects.toThrow("IA indisponible");
    expect(relancesDe(m1.conv.etatAvantReponse)["31"]).toBeUndefined();
    expect(await validerRelance("u1", 11, 31, null, m1.deps)).toMatchObject({ ok: true });

    const m2 = monde({ tacheRefusee: true });
    expect(await validerRelance("u1", 11, 31, null, m2.deps)).toMatchObject({ ok: false, status: 400 });
    expect(relancesDe(m2.conv.etatAvantReponse)["31"]).toBeUndefined();
  });

  it("la séquence reste à l'arrêt : une séquence encore en marche est arrêtée, une séquence arrêtée n'est pas touchée", async () => {
    const actif = monde({ sequence: "active" });
    await validerRelance("u1", 11, 31, null, actif.deps);
    expect(actif.deps.arreterSequence).toHaveBeenCalledWith(7);
    const arrete = monde({ sequence: "stopped_replied" });
    await validerRelance("u1", 11, 31, null, arrete.deps);
    expect(arrete.deps.arreterSequence).not.toHaveBeenCalled();
  });

  it("le jour venu, le brouillon est prêt pour « Ta réponse » ; avant, seulement annoncé", async () => {
    const { conv, deps, taches } = monde();
    await validerRelance("u1", 11, 31, null, deps);
    const avant = await vueRelances(conv, [msg()], PREFS, deps);
    expect(avant.parMessage[31]).toEqual({ statut: "validee", date: "2027-01-04", taskId: 100, faite: false });
    expect(avant.prete).toBeNull();
    const jourJ = await vueRelances(conv, [msg()], PREFS, { ...deps, now: () => new Date("2027-01-04T08:00:00Z") });
    expect(jourJ.prete).toEqual({ taskId: 100, messageId: 31, date: "2027-01-04", texte: taches.get(100).actionData.relance.texte });
    // Tâche cochée : plus rien à préremplir.
    taches.get(100).completed = true;
    const fait = await vueRelances(conv, [msg()], PREFS, { ...deps, now: () => new Date("2027-01-05T08:00:00Z") });
    expect(fait.prete).toBeNull();
    expect(fait.parMessage[31]).toMatchObject({ faite: true });
    // Tâche supprimée du planning : plus rien.
    taches.delete(100);
    expect((await vueRelances(conv, [msg()], PREFS, deps)).parMessage).toEqual({});
  });

  it("« Proposer une autre version » : rédige seulement, pour la date de la tâche", async () => {
    const { deps } = monde();
    expect(await reformulerRelance("u1", 11, 31, deps)).toEqual({ ok: false, status: 409 });
    await validerRelance("u1", 11, 31, null, deps);
    deps.rediger.mockResolvedValueOnce("Autre version");
    expect(await reformulerRelance("u1", 11, 31, deps)).toEqual({ ok: true, texte: "Autre version" });
    expect(deps.creerTache).toHaveBeenCalledTimes(1);
  });

  it("titre sans entreprise", () => {
    expect(titreRelance({ name: "Marc", company: null })).toBe("Relancer Marc");
  });
});

describe("rien n'est jamais envoyé", () => {
  it("le module des relances n'importe aucun chemin d'envoi", () => {
    const src = readFileSync(path.join(__dirname, "relance.ts"), "utf8");
    expect(src).not.toMatch(/unipile|envoi-reponse|envoyerReponse|sendEmail|sendLinkedIn|prospection-sender/);
    // Ses dépendances ne comportent aucune fonction d'envoi.
    const { deps } = monde();
    expect(Object.keys(deps).some((k) => /envoy|send/i.test(k))).toBe(false);
  });
});

describe("« Ce n'était pas une vraie réponse » et relances", () => {
  const etatAvecRelances = (relances: Record<string, DecisionRelance>) => ({ status: "active", currentStep: 1, nextRunAt: null, delayAnchorAt: null, relances });
  const depsRequal = (taches: Record<number, any>) => ({
    getTask: vi.fn(async (id: number) => taches[id]), supprimerTache: vi.fn(async () => undefined),
    ecrire: vi.fn(async () => undefined), now: () => NOW,
  });

  it("la relance du message requalifié est annulée et sa tâche retirée ; la séquence peut reprendre", async () => {
    const d = depsRequal({ 100: { id: 100, completed: false } });
    const conv = { id: 11, etatAvantReponse: etatAvecRelances({ "31": { statut: "validee", le: "x", taskId: 100 } }) };
    expect(await relancesAuRequalifier(conv, 31, d)).toBe(false);
    expect(d.supprimerTache).toHaveBeenCalledWith(100);
    expect(d.ecrire).toHaveBeenCalledWith(11, 31, expect.objectContaining({ statut: "annulee" }));
  });

  it("une relance validée sur un AUTRE message garde la séquence à l'arrêt", async () => {
    const d = depsRequal({ 100: { id: 100, completed: false } });
    const conv = { id: 11, etatAvantReponse: etatAvecRelances({ "20": { statut: "validee", le: "x", taskId: 100 } }) };
    expect(await relancesAuRequalifier(conv, 31, d)).toBe(true);
    expect(d.supprimerTache).not.toHaveBeenCalled();
  });

  it("une relance déjà faite ne retient plus rien", async () => {
    const d = depsRequal({ 100: { id: 100, completed: true } });
    const conv = { id: 11, etatAvantReponse: etatAvecRelances({ "20": { statut: "validee", le: "x", taskId: 100 } }) };
    expect(await relancesAuRequalifier(conv, 31, d)).toBe(false);
  });
});

describe("relances rangées dans etat_avant_reponse, sans migration", () => {
  it("un jsonb qui ne porte que des relances n'est pas un état d'avant", () => {
    expect(estEtatAvant({ relances: { "31": { statut: "refusee", le: "x" } } })).toBe(false);
    expect(estEtatAvant({ status: "active", currentStep: 0, nextRunAt: null, delayAnchorAt: null })).toBe(true);
    expect(estEtatAvant(null)).toBe(false);
    expect(avecRelances({ relances: { "1": { statut: "refusee", le: "x" } } }, { status: "a" })).toEqual({ status: "a", relances: { "1": { statut: "refusee", le: "x" } } });
    expect(avecRelances(null, { status: "a" })).toEqual({ status: "a" });
  });

  it("l'ingestion d'une réponse sauvegarde l'état d'avant SANS perdre les décisions de relance", () => {
    const relances = { "31": { statut: "refusee", le: "x" } };
    const plan = planEntrant({ nature: "reponse", retourLe: null, desinscription: false }, { sentAt: NOW, accountId: "acc" }, null, "identified");
    const state: any = { status: "active", currentStep: 2, nextRunAt: new Date("2026-11-12T08:00:00Z"), delayAnchorAt: null };
    const r = plan(state, { id: 11, accountId: "acc", unipileAccountId: "acc", providerChatId: "f", lastMessageAt: null, etatAvantReponse: { relances } } as any);
    expect(r.conv.etatAvantReponse).toMatchObject({ status: "active", currentStep: 2, relances });
    expect(r.state).toMatchObject({ status: "stopped_replied" });
    // Un vrai état d'avant déjà sauvegardé n'est jamais écrasé.
    const r2 = plan(state, { id: 11, unipileAccountId: "acc", providerChatId: "f", lastMessageAt: null, etatAvantReponse: { status: "paused", currentStep: 1, nextRunAt: null, delayAnchorAt: null } } as any);
    expect(r2.conv.etatAvantReponse).toBeUndefined();
  });
});
