// La proposition groupée d'un projet (séance de redémarrage) : aperçu, validation ligne par ligne,
// journal annulable. Aucune base : stockage, dépôt et écritures sont simulés.
import { describe, it, expect, vi, beforeEach } from "vitest";

const s = vi.hoisted(() => ({ getTask: vi.fn(), getProject: vi.fn(), updateProject: vi.fn(), updateTask: vi.fn() }));
const t = vi.hoisted(() => ({ creerTache: vi.fn(), modifierTache: vi.fn() }));
const rc = vi.hoisted(() => ({ creerRituelEtMaterialiser: vi.fn(), validerRituel: vi.fn(), dateLocale: (d: Date) => d.toISOString().slice(0, 10) }));
const rs = vi.hoisted(() => ({ lireRituel: vi.fn(), retirerRituel: vi.fn(), majRituel: vi.fn() }));
const es = vi.hoisted(() => ({ creerEnvoi: vi.fn(), getEnvoi: vi.fn() }));
const table = vi.hoisted(() => ({ lignes: new Map<number, any>(), suivant: 0, actions: [] as any[] }));
const d = vi.hoisted(() => ({
  ajouterAction: vi.fn(async (userId: string, outil: string, resume: string, lignes: any[]) => { const a = { id: 77, userId, outil, resume, lignes, createdAt: new Date() }; table.actions.push(a); return a; }),
  ajouterProposition: vi.fn(async (userId: string, outil: string, args: unknown, changements: unknown, empreinte: unknown, expireA: Date) => {
    const p = { id: ++table.suivant, userId, outil, arguments: JSON.parse(JSON.stringify(args)), changements, empreinte: JSON.parse(JSON.stringify(empreinte)), statut: "en_attente", resultat: null, expireA };
    table.lignes.set(p.id, p); return p;
  }),
  getProposition: vi.fn(async (id: number, userId: string) => { const p = table.lignes.get(id); return p && p.userId === userId ? { ...p } : undefined; }),
  majProposition: vi.fn(async (id: number, _u: string, patch: any) => Object.assign(table.lignes.get(id), patch)),
  reclamerProposition: vi.fn(async (id: number, userId: string, statut: string) => {
    const p = table.lignes.get(id); if (!p || p.userId !== userId || p.statut !== "en_attente") return false; p.statut = statut; return true;
  }),
}));
vi.mock("../../storage", () => ({ storage: s }));
vi.mock("../agent/depot", () => ({ depot: d }));
vi.mock("../taches/ecrire-tache", () => t);
vi.mock("../ritual-create", () => rc);
vi.mock("../ritual-store", () => rs);
vi.mock("../envois/store", () => es);
vi.mock("../memory/ranger", () => ({ lireSouvenir: vi.fn(), perimerSouvenir: vi.fn() }));

const { appliquerBilanProjet } = await import("./bilan-projet");
const { validerProposition, proposerHorsConversation } = await import("../agent/propositions");

const MAINTENANT = new Date("2026-11-25T09:00:00Z");
const tache = (o: any = {}) => ({ id: 10, userId: "u1", title: "Écrire le brief", completed: false, archivedAt: null, scheduledDate: "2026-11-10", scheduledTime: null, ...o });
const projet = { id: 4, userId: "u1", name: "Agence JMD", statusNote: "ancienne", projectStatus: "active" };
const ops = [
  { type: "cocher_tache", taskId: 10 },
  { type: "note_projet", texte: "Trois actus par jour, briefs aux marques en cours." },
  { type: "creer_creneau", titre: "Valider les actus", days: "mon,tue,wed,thu,fri", startTime: "09:00", durationMinutes: 15, intervalWeeks: 1 },
];
const proposer = (args: any, userId = "u1") => proposerHorsConversation(userId, "appliquer_bilan_projet", args, MAINTENANT, { outils: [appliquerBilanProjet] });

beforeEach(() => {
  vi.clearAllMocks(); table.lignes.clear(); table.actions.length = 0;
  s.getTask.mockImplementation(async (id: number) => (id === 10 ? tache() : undefined));
  s.getProject.mockImplementation(async (id: number, userId: string) => (id === 4 && userId === "u1" ? { ...projet } : undefined));
  s.updateProject.mockResolvedValue({ ...projet });
  t.modifierTache.mockImplementation(async (_u: string, id: number, patch: any) => ({ ok: true, avant: tache(), tache: tache({ id, ...patch, completedAt: patch.completed ? MAINTENANT : null }) }));
  rc.validerRituel.mockImplementation((b: any, jour: string) => ({ ok: true, donnees: { projectId: b.projectId, title: b.title, days: b.days, startTime: b.startTime, durationMinutes: b.durationMinutes, intervalWeeks: b.intervalWeeks ?? 1, anchorDate: jour } }));
  rc.creerRituelEtMaterialiser.mockResolvedValue({ ritual: { id: 8, title: "Valider les actus", active: true }, materialized: 5 });
});

describe("appliquer_bilan_projet", () => {
  it("aperçu : un changement par opération, sélectionnable, valable 7 jours", async () => {
    const p: any = await proposer({ projectId: 4, operations: ops });
    expect(p.changements).toHaveLength(3);
    expect(p.selectionnable).toBe(true);
    expect(new Date(p.expireA).getTime() - MAINTENANT.getTime()).toBe(7 * 86_400_000);
  });
  it("validation de la sélection [0,2] : seules les opérations 0 et 2 appliquées et journalisées", async () => {
    const p: any = await proposer({ projectId: 4, operations: ops });
    const r = await validerProposition("u1", p.id, MAINTENANT, { outils: [appliquerBilanProjet], lignes: [0, 2] });
    expect(r).toMatchObject({ ok: true, actionId: 77 });
    expect(t.modifierTache).toHaveBeenCalledTimes(1);
    expect(s.updateProject).not.toHaveBeenCalled();
    expect(rc.creerRituelEtMaterialiser).toHaveBeenCalledTimes(1);
    expect(table.actions[0].lignes.map((l: any) => l.table)).toEqual(["tasks", "recurring_rituals"]);
  });
  it("sans sélection : tout est appliqué", async () => {
    const p: any = await proposer({ projectId: 4, operations: ops });
    await validerProposition("u1", p.id, MAINTENANT, { outils: [appliquerBilanProjet] });
    expect(s.updateProject).toHaveBeenCalledWith(4, "u1", { statusNote: "Trois actus par jour, briefs aux marques en cours." });
    expect(table.actions[0].lignes).toHaveLength(3);
  });
  it("tâche cochée à la main entre l'aperçu et la validation : expirée, rien n'est fait", async () => {
    const p: any = await proposer({ projectId: 4, operations: ops });
    s.getTask.mockImplementation(async () => tache({ completed: true }));
    expect(await validerProposition("u1", p.id, MAINTENANT, { outils: [appliquerBilanProjet] })).toEqual({ ok: false, raison: "expiree" });
    expect(t.modifierTache).not.toHaveBeenCalled();
  });
  it("projet d'une autre : refusé à l'aperçu", async () => {
    expect(await proposer({ projectId: 4, operations: ops }, "u2")).toEqual({ erreur: "projet_introuvable" });
  });
  it("tâche d'un autre projet ou d'une autre : refusée à l'aperçu", async () => {
    expect(await proposer({ projectId: 4, operations: [{ type: "cocher_tache", taskId: 99 }] })).toEqual({ erreur: "tache_introuvable" });
  });
  it("archiver : écrit archivedAt, journalisé", async () => {
    s.updateTask.mockResolvedValue(tache({ archivedAt: MAINTENANT }));
    const p: any = await proposer({ projectId: 4, operations: [{ type: "archiver_tache", taskId: 10 }] });
    await validerProposition("u1", p.id, MAINTENANT, { outils: [appliquerBilanProjet] });
    expect(s.updateTask).toHaveBeenCalledWith(10, { archivedAt: MAINTENANT });
    expect(table.actions[0].lignes[0]).toMatchObject({ table: "tasks", id: 10, avant: { archivedAt: null } });
  });
  it("envoi : créé avec relance, journalisé", async () => {
    es.creerEnvoi.mockResolvedValue({ id: 3, marque: "Sézane", objet: "Campagne", statut: "envoye" });
    const p: any = await proposer({ projectId: 4, operations: [{ type: "creer_envoi", marque: "Sézane", objet: "Campagne", envoyeLe: "2026-11-20", prochaineRelance: "2026-11-27" }] });
    await validerProposition("u1", p.id, MAINTENANT, { outils: [appliquerBilanProjet] });
    expect(es.creerEnvoi).toHaveBeenCalledWith("u1", expect.objectContaining({ projectId: 4, marque: "Sézane", prochaineRelance: "2026-11-27", statut: "envoye" }));
    expect(table.actions[0].lignes[0]).toMatchObject({ table: "envois", id: 3, avant: null });
  });
});
