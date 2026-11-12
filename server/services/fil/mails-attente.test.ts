// Mails qui attendent une réponse (fil conducteur, spec §8.1). Aucun appel réseau ni base :
// la réponse Unipile vient de la fixture, `fetch` et les dépendances sont simulés.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("../linkedin", () => ({
  unipileDsn: "https://unipile.test",
  unipileHeaders: (extra: Record<string, string> = {}) => ({ "X-API-KEY": "cle-de-test", ...extra }),
  linkedinConfigured: () => true,
}));

import { listerEmailsRecus, versEmailUnipile, EMAILS_PAGES_MAX, type EmailUnipile } from "../unipile-mail";
import {
  filsEnAttente, synchroniserMailsEnAttente, correspondanceMail, estAdministratif, ligneLibre,
  type DepsMails, type CandidatsRattachement, type LigneMail,
} from "./mails-attente";

const brut = JSON.parse(readFileSync(path.join(__dirname, "__fixtures__", "unipile-emails.json"), "utf8"));
const emails: EmailUnipile[] = brut.items.map(versEmailUnipile).filter(Boolean);
const MAINTENANT = new Date("2026-11-12T08:00:00.000Z");
const PROPRES = new Set(["jeanne@agence-jmd.com"]);
const PROSPECTS = new Set(["marc@boulangerie-dupont.fr"]);
const JOUR = 24 * 3600_000;

const ids = (r: Array<{ threadId: string }>) => r.map((f) => f.threadId).sort();

describe("versEmailUnipile (forme de la doc, figée dans la fixture)", () => {
  it("lit l'expéditeur, le fil, le rôle, les destinataires et les en-têtes, sans le corps", () => {
    const m = emails.find((e) => e.id === "m-a2")!;
    expect(m).toMatchObject({
      threadId: "t-humain", role: "inbox", date: "2026-11-10T14:30:00.000Z",
      from: { email: "claire@studio-lumen.fr", nom: "Claire Martin" },
      to: ["jeanne@agence-jmd.com"], cc: [], sujet: "Re: Devis refonte site",
    });
    expect(m.headers).toEqual({ from: "Claire Martin <claire@studio-lumen.fr>", "auto-submitted": "no" });
    expect(m).not.toHaveProperty("body");
  });
  it("un élément sans id ou sans date est ignoré ; sans tableau d'en-têtes, headers vaut null", () => {
    expect(versEmailUnipile({ date: "2026-11-10T00:00:00Z" })).toBeNull();
    expect(versEmailUnipile({ id: "x" })).toBeNull();
    expect(versEmailUnipile({ id: "x", date: "2026-11-10T00:00:00Z", kind: "1_meta" })!.headers).toBeNull();
  });
});

describe("listerEmailsRecus", () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("GET /api/v1/emails avec account_id, after (ISO), limit, include_headers ; suit le cursor", async () => {
    const page1 = { ...brut, items: brut.items.slice(0, 3), cursor: "c2" };
    const page2 = { ...brut, items: brut.items.slice(3), cursor: null };
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(page1), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(page2), { status: 200 }));
    const depuis = new Date(MAINTENANT.getTime() - 14 * JOUR);
    const r = await listerEmailsRecus("acc-gmail", depuis);
    expect(r).toHaveLength(brut.items.length);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const u1 = new URL(fetchMock.mock.calls[0][0]);
    expect(u1.origin + u1.pathname).toBe("https://unipile.test/api/v1/emails");
    expect(Object.fromEntries(u1.searchParams)).toEqual({
      account_id: "acc-gmail", after: "2026-10-29T08:00:00.000Z", limit: "100", include_headers: "true",
    });
    expect(fetchMock.mock.calls[0][1].method ?? "GET").toBe("GET");
    expect(new URL(fetchMock.mock.calls[1][0]).searchParams.get("cursor")).toBe("c2");
  });
  it("un 200 au corps illisible lève aussi (jamais une page vide)", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>oups</html>", { status: 200 }));
    await expect(listerEmailsRecus("acc-gmail", MAINTENANT)).rejects.toThrow(/illisible/);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ object: "EmailList" }), { status: 200 }));
    await expect(listerEmailsRecus("acc-gmail", MAINTENANT)).rejects.toThrow(/illisible/);
  });
  it("plafond de pages atteint avec un cursor : avertissement chiffré seulement", async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ ...brut, items: brut.items.slice(0, 1), cursor: "encore" }), { status: 200 }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await listerEmailsRecus("acc-gmail", MAINTENANT);
    expect(fetchMock).toHaveBeenCalledTimes(EMAILS_PAGES_MAX);
    expect(r).toHaveLength(EMAILS_PAGES_MAX);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/tronquée à 30 pages \(30 mails lus\)/);
    expect(String(warn.mock.calls[0][0])).not.toMatch(/@|Devis/);
    warn.mockRestore();
  });
  it("une erreur HTTP lève (jamais « boîte vide » d'une boîte illisible)", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 503 }));
    await expect(listerEmailsRecus("acc-gmail", MAINTENANT)).rejects.toThrow(/http_503/);
  });
});

describe("filsEnAttente (pur)", () => {
  const r = filsEnAttente(emails, PROPRES, PROSPECTS, MAINTENANT);

  it("ne garde que les fils dont le dernier message vient d'un humain qui attend Jeanne", () => {
    expect(ids(r)).toEqual(["t-facture", "t-humain"]);
  });
  it("le fil humain : dernier message de Claire (le brouillon de Jeanne ne compte pas)", () => {
    const f = r.find((x) => x.threadId === "t-humain")!;
    expect(f).toMatchObject({ expediteur: "claire@studio-lumen.fr", nom: "Claire Martin", sujet: "Devis refonte site", administratif: false });
    expect(f.dernierAt.toISOString()).toBe("2026-11-10T14:30:00.000Z");
  });

  // Les exclusions une par une (Review Focus 3) : chaque fil, seul, ne donne rien.
  const seul = (thread: string, propres = PROPRES, prospects = PROSPECTS) =>
    filsEnAttente(emails.filter((e) => e.threadId === thread), propres, prospects, MAINTENANT);
  it.each([
    ["t-noreply", "adresse noreply@"],
    ["t-notif", "adresse notifications@"],
    ["t-liste", "en-tête List-Unsubscribe"],
    ["t-auto", "Auto-Submitted ≠ no"],
    ["t-bulk", "Precedence: bulk"],
    ["t-prospect", "prospect (leads / Réponses)"],
    ["t-jeanne-dernier", "dernier message de Jeanne (envoyé)"],
    ["t-jeanne-copie", "dernier message d'une adresse de Jeanne"],
    ["t-vieux", "fil de 15 jours"],
  ])("%s exclu : %s", (thread) => {
    expect(seul(thread)).toEqual([]);
  });
  it("le même fil prospect, sans l'adresse dans les prospects, serait retenu (l'exclusion vient bien de là)", () => {
    expect(ids(seul("t-prospect", PROPRES, new Set()))).toEqual(["t-prospect"]);
  });
  it("le fil où Jeanne a répondu le serait aussi si elle n'avait pas répondu", () => {
    expect(ids(filsEnAttente(emails.filter((e) => e.id === "m-e1"), PROPRES, PROSPECTS, MAINTENANT))).toEqual(["t-jeanne-dernier"]);
  });
  it("Precedence: list exclut aussi ; mailer-daemon et newsletter aussi", () => {
    const base = emails.find((e) => e.id === "m-a2")!;
    const variante = (p: Partial<EmailUnipile>) => filsEnAttente([{ ...base, ...p }], PROPRES, PROSPECTS, MAINTENANT);
    expect(variante({ headers: { precedence: "list" } })).toEqual([]);
    expect(variante({ from: { email: "mailer-daemon@googlemail.com", nom: null } })).toEqual([]);
    expect(variante({ from: { email: "newsletter@marque.fr", nom: null } })).toEqual([]);
    expect(variante({ from: { email: "no-reply@marque.fr", nom: null } })).toEqual([]);
    expect(variante({ headers: null })).toHaveLength(1);
  });
  it("tirets bas : no_reply@, noreply_x@, do_not_reply@, mailer_daemon@ exclus", () => {
    const base = emails.find((e) => e.id === "m-a2")!;
    for (const email of ["no_reply@marque.fr", "noreply_factures@marque.fr", "do_not_reply@marque.fr", "mailer_daemon@marque.fr"]) {
      expect(filsEnAttente([{ ...base, from: { email, nom: null } }], PROPRES, PROSPECTS, MAINTENANT)).toEqual([]);
    }
    // Un prénom qui contient « no » n'est pas un robot.
    expect(filsEnAttente([{ ...base, from: { email: "noemie_r@marque.fr", nom: null } }], PROPRES, PROSPECTS, MAINTENANT)).toHaveLength(1);
  });
  it("Jeanne seulement en copie : exclu ; destinataires absents des données : jugé comme avant", () => {
    const base = emails.find((e) => e.id === "m-a2")!;
    expect(filsEnAttente([{ ...base, to: ["paul@studio-lumen.fr"], cc: ["jeanne@agence-jmd.com"] }], PROPRES, PROSPECTS, MAINTENANT)).toEqual([]);
    expect(filsEnAttente([{ ...base, to: [], cc: [] }], PROPRES, PROSPECTS, MAINTENANT)).toHaveLength(1);
    expect(filsEnAttente([{ ...base, to: ["paul@studio-lumen.fr", "JEANNE@agence-jmd.com"], cc: [] }], PROPRES, PROSPECTS, MAINTENANT)).toHaveLength(1);
  });
  it("un fil de 13 jours est encore retenu", () => {
    const base = emails.find((e) => e.id === "m-a2")!;
    const d = new Date(MAINTENANT.getTime() - 13 * JOUR).toISOString();
    expect(filsEnAttente([{ ...base, date: d }], PROPRES, PROSPECTS, MAINTENANT)).toHaveLength(1);
  });
  it("« facture » dans le sujet : administratif ; sujet débarrassé de TR:/Re:", () => {
    const f = r.find((x) => x.threadId === "t-facture")!;
    expect(f).toMatchObject({ administratif: true, sujet: "Votre Facture d'octobre", nom: "Isabelle Roux" });
  });
});

describe("estAdministratif", () => {
  it.each(["Facture n°12", "Relance URSSAF", "Vos impôts 2026", "Rendez-vous banque", "Contrat de prestation", "Devis signé", "Attestation", "Dossier administratif"])("%s", (s) => {
    expect(estAdministratif(s)).toBe(true);
  });
  it("un sujet ordinaire ne l'est pas ; « devis » seul non plus", () => {
    expect(estAdministratif("Devis refonte site")).toBe(false);
    expect(estAdministratif("On se voit jeudi ?")).toBe(false);
  });
});

describe("correspondanceMail", () => {
  const c: CandidatsRattachement = {
    clients: [{ id: 7, email: "contact@studio-lumen.fr", projectId: 3 }],
    projets: [{ id: 5, contact: "Paul R — paul@cabinet-r.fr" }],
    leads: [{ id: 9, email: "anne@boulangerie-dupont.fr", projectId: 2 }],
  };
  it("adresse exacte, puis domaine (client, projet, prospect)", () => {
    expect(correspondanceMail("paul@cabinet-r.fr", c, new Set())).toEqual({ projectId: 5, clientId: null, leadId: null });
    expect(correspondanceMail("claire@studio-lumen.fr", c, new Set())).toEqual({ projectId: 3, clientId: 7, leadId: null });
    expect(correspondanceMail("marc@boulangerie-dupont.fr", c, new Set())).toEqual({ projectId: 2, clientId: null, leadId: 9 });
  });
  it("jamais par un domaine de messagerie grand public ni par le domaine de Jeanne ; sinon rien", () => {
    const g: CandidatsRattachement = { clients: [{ id: 1, email: "a@gmail.com", projectId: 1 }], projets: [], leads: [] };
    expect(correspondanceMail("b@gmail.com", g, new Set())).toBeNull();
    const j: CandidatsRattachement = { clients: [{ id: 1, email: "x@agence-jmd.com", projectId: 1 }], projets: [], leads: [] };
    expect(correspondanceMail("y@agence-jmd.com", j, new Set(["agence-jmd.com"]))).toBeNull();
    expect(correspondanceMail("inconnu@ailleurs.fr", c, new Set())).toBeNull();
  });
  it("deux clients du même domaine dans deux projets : ambigu, rien", () => {
    const a: CandidatsRattachement = {
      clients: [{ id: 1, email: "a@groupe.fr", projectId: 1 }, { id: 2, email: "b@groupe.fr", projectId: 2 }], projets: [], leads: [],
    };
    expect(correspondanceMail("c@groupe.fr", a, new Set())).toBeNull();
  });
});

describe("synchroniserMailsEnAttente", () => {
  function monde(o: { compte?: string | null; mails?: EmailUnipile[]; jourOff?: string; threadsProspects?: string[] } = {}) {
    const lignes = new Map<string, LigneMail>();
    const taches: any[] = [];
    const rattacheur = vi.fn(async () => ({ goalId: 11, milestoneId: null }));
    const deps: DepsMails = {
      compteEmail: vi.fn(async () => (o.compte === undefined ? "acc-gmail" : o.compte)),
      listerEmails: vi.fn(async () => o.mails ?? emails),
      adressesPropres: vi.fn(async () => new Set(PROPRES)),
      adressesProspects: vi.fn(async () => new Set(PROSPECTS)),
      threadsProspects: vi.fn(async () => new Set(o.threadsProspects ?? [])),
      threadsConnus: vi.fn(async (_u, t: string[]) => t.filter((x) => lignes.has(x)).map((x) => ({ ...lignes.get(x)! }))),
      // Même règle que l'upsert SQL : ligne absente, ou sans tâche et périmée.
      reserver: vi.fn(async (_u, l, maintenant: Date) => {
        if (!ligneLibre(lignes.get(l.threadId), maintenant)) return false;
        lignes.set(l.threadId, { threadId: l.threadId, taskId: null, createdAt: maintenant });
        return true;
      }),
      liberer: vi.fn(async (_u, t) => { if (lignes.get(t)?.taskId == null) lignes.delete(t); }),
      tacheDuFil: vi.fn(async (_u, t: string) => taches.find((x) => x.actionData?.mail?.threadId === t)?.id ?? null),
      lierTache: vi.fn(async (_u, t, id) => { lignes.get(t)!.taskId = id; }),
      candidats: vi.fn(async () => ({ clients: [{ id: 7, email: "contact@studio-lumen.fr", projectId: 3 }], projets: [], leads: [] })),
      rattacheur: vi.fn(() => rattacheur),
      premierJourTravaille: vi.fn(async (_u, j: string) => (j === o.jourOff ? "2026-11-13" : j)),
      creerTache: vi.fn(async (_u, d) => { const t = { id: 100 + taches.length, completed: false, ...d }; taches.push(t); return { ok: true as const, tache: t }; }),
    };
    return { deps, lignes, taches, rattacheur };
  }

  it("crée « Répondre à {nom} : {sujet} », +2 jours, rattachée au client du domaine ; +7 si administratif", async () => {
    const { deps, taches, lignes, rattacheur } = monde();
    expect(await synchroniserMailsEnAttente("u1", MAINTENANT, deps)).toEqual({ creees: 2 });
    const claire = taches.find((t) => t.title.includes("Claire"));
    expect(claire).toMatchObject({
      title: "Répondre à Claire Martin : Devis refonte site",
      projectId: 3, clientId: 7, leadId: null, goalId: 11, milestoneId: null,
      scheduledDate: "2026-11-12", completed: false, source: "fil_mail",
    });
    expect(claire.dueDate.toISOString()).toBe(new Date(MAINTENANT.getTime() + 2 * JOUR).toISOString());
    const facture = taches.find((t) => t.title.includes("Isabelle"));
    expect(facture.title).toBe("Répondre à Isabelle Roux : Votre Facture d'octobre");
    expect(facture.dueDate.toISOString()).toBe(new Date(MAINTENANT.getTime() + 7 * JOUR).toISOString());
    // Pas de correspondance : sans projet, et le rattachement n'est pas demandé.
    expect(facture).toMatchObject({ projectId: null, clientId: null, leadId: null });
    expect(facture).not.toHaveProperty("goalId");
    // Un rattacheur par passage, appelé seulement quand il y a une correspondance.
    expect(deps.rattacheur).toHaveBeenCalledTimes(1);
    expect(rattacheur).toHaveBeenCalledTimes(1);
    expect(rattacheur).toHaveBeenCalledWith({ projectId: 3, leadId: null });
    expect(lignes.get("t-humain")!.taskId).toBe(claire.id);
    expect(deps.listerEmails).toHaveBeenCalledWith("acc-gmail", new Date(MAINTENANT.getTime() - 14 * JOUR));
  });

  it("deuxième passage : 0 création ; tâche cochée puis troisième passage : 0 création", async () => {
    const { deps, taches } = monde();
    await synchroniserMailsEnAttente("u1", MAINTENANT, deps);
    expect(await synchroniserMailsEnAttente("u1", new Date(MAINTENANT.getTime() + JOUR), deps)).toEqual({ creees: 0 });
    taches.forEach((t) => { t.completed = true; });
    expect(await synchroniserMailsEnAttente("u1", new Date(MAINTENANT.getTime() + 2 * JOUR), deps)).toEqual({ creees: 0 });
    expect(taches).toHaveLength(2);
  });

  it("tâche supprimée : la ligne reste, le fil ne revient pas", async () => {
    const { deps, taches } = monde();
    await synchroniserMailsEnAttente("u1", MAINTENANT, deps);
    taches.length = 0;
    expect(await synchroniserMailsEnAttente("u1", MAINTENANT, deps)).toEqual({ creees: 0 });
  });

  it("un fil déjà suivi dans « Réponses » (inbox_conversations) : aucune tâche, même d'une adresse inconnue", async () => {
    const { deps, taches } = monde({ threadsProspects: ["t-humain"] });
    expect(await synchroniserMailsEnAttente("u1", MAINTENANT, deps)).toEqual({ creees: 1 });
    expect(taches.map((t) => t.title)).toEqual(["Répondre à Isabelle Roux : Votre Facture d'octobre"]);
  });

  it("compte Gmail Unipile absent ou déconnecté (nul) : {creees: 0}, sans erreur ni lecture", async () => {
    const { deps } = monde({ compte: null });
    await expect(synchroniserMailsEnAttente("u1", MAINTENANT, deps)).resolves.toEqual({ creees: 0 });
    expect(deps.listerEmails).not.toHaveBeenCalled();
  });

  it("création refusée : la réservation est rendue, le fil sera repris au passage suivant", async () => {
    const { deps, lignes } = monde();
    (deps.creerTache as any).mockResolvedValueOnce({ ok: false, status: 400, message: "x" });
    expect((await synchroniserMailsEnAttente("u1", MAINTENANT, deps)).creees).toBe(1);
    expect(lignes.size).toBe(1);
    expect((await synchroniserMailsEnAttente("u1", MAINTENANT, deps)).creees).toBe(1);
    expect(lignes.size).toBe(2);
  });

  it("lierTache échoue après création : la ligne reste, 0 création au passage suivant, ni 2 h après (lien réparé)", async () => {
    const { deps, taches, lignes } = monde();
    (deps.lierTache as any).mockRejectedValueOnce(new Error("base indisponible"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await synchroniserMailsEnAttente("u1", MAINTENANT, deps)).toEqual({ creees: 2 });
    err.mockRestore();
    expect(deps.liberer).not.toHaveBeenCalled();
    expect(lignes.size).toBe(2);
    expect(await synchroniserMailsEnAttente("u1", MAINTENANT, deps)).toEqual({ creees: 0 });
    expect(await synchroniserMailsEnAttente("u1", new Date(MAINTENANT.getTime() + 2 * 3600_000), deps)).toEqual({ creees: 0 });
    expect(taches).toHaveLength(2);
    expect(Array.from(lignes.values()).every((l) => l.taskId != null)).toBe(true);
  });

  it("creerTache lève : la réservation est rendue, le fil est repris au passage suivant", async () => {
    const { deps, lignes, taches } = monde();
    (deps.creerTache as any).mockRejectedValueOnce(new Error("panne"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await synchroniserMailsEnAttente("u1", MAINTENANT, deps)).creees).toBe(1);
    err.mockRestore();
    expect(deps.liberer).toHaveBeenCalledTimes(1);
    expect(lignes.size).toBe(1);
    expect((await synchroniserMailsEnAttente("u1", MAINTENANT, deps)).creees).toBe(1);
    expect(taches).toHaveLength(2);
  });

  it("réservation sans tâche : prise pendant 1 h, libre après (passage interrompu)", async () => {
    const { deps, lignes, taches } = monde();
    const pose = (l: LigneMail) => lignes.set(l.threadId, l);
    pose({ threadId: "t-humain", taskId: null, createdAt: new Date(MAINTENANT.getTime() - 30 * 60_000) });
    pose({ threadId: "t-facture", taskId: null, createdAt: new Date(MAINTENANT.getTime() - 61 * 60_000) });
    expect(await synchroniserMailsEnAttente("u1", MAINTENANT, deps)).toEqual({ creees: 1 });
    expect(taches.map((t) => t.actionData.mail.threadId)).toEqual(["t-facture"]);
    expect(lignes.get("t-humain")!.taskId).toBeNull();
  });

  it("ligneLibre : une ligne avec tâche n'est jamais libre, même très ancienne", () => {
    const vieux = new Date(MAINTENANT.getTime() - 30 * JOUR);
    expect(ligneLibre(undefined, MAINTENANT)).toBe(true);
    expect(ligneLibre({ threadId: "t", taskId: 5, createdAt: vieux }, MAINTENANT)).toBe(false);
    expect(ligneLibre({ threadId: "t", taskId: null, createdAt: vieux }, MAINTENANT)).toBe(true);
    expect(ligneLibre({ threadId: "t", taskId: null, createdAt: new Date(MAINTENANT.getTime() - 59 * 60_000) }, MAINTENANT)).toBe(false);
    expect(ligneLibre({ threadId: "t", taskId: null, createdAt: null }, MAINTENANT)).toBe(false);
  });

  it("jour non travaillé : posée au premier jour travaillé", async () => {
    const { deps, taches } = monde({ jourOff: "2026-11-12" });
    await synchroniserMailsEnAttente("u1", MAINTENANT, deps);
    expect(taches.every((t) => t.scheduledDate === "2026-11-13")).toBe(true);
  });

  it("au plus PLAFOND tâches par passage, les plus récentes d'abord ; le reste au passage suivant", async () => {
    const base = emails.find((e) => e.id === "m-a2")!;
    const mails = Array.from({ length: 13 }, (_, i) => ({
      ...base, id: `x${i}`, threadId: `tx${i}`, date: new Date(MAINTENANT.getTime() - (i + 1) * 3600_000).toISOString(),
      from: { email: `p${i}@exemple.fr`, nom: `P${i}` },
    }));
    const { deps, taches } = monde({ mails });
    expect(await synchroniserMailsEnAttente("u1", MAINTENANT, deps)).toEqual({ creees: 10 });
    expect(taches[0].title).toContain("P0");
    expect(await synchroniserMailsEnAttente("u1", MAINTENANT, deps)).toEqual({ creees: 3 });
  });
});
