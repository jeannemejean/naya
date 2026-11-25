// La séance de redémarrage : démarrer, suivre la proposition du projet courant, avancer, terminer.
// Dépôt en mémoire, propositions simulées : aucune base.
import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("../../db", () => ({ db: {} }));
const { demarrerSeance, synchroniser, passerProjet, rattacherProposition, seanceActivePour, vueSeance } = await import("./seance");

const M = new Date("2026-11-25T09:00:00Z");
const bilan = { depuis: "2026-11-10T00:00:00.000Z", projets: [
  { projectId: 2, nom: "Agence", statut: "active", priorite: 1, noteActuelle: null, tachesEnRetard: [], derniereTacheFaite: null, postsPrevus: 0, postsPublies: 0, creneaux: [], envoisEnCours: [] },
  { projectId: 4, nom: "Boutique", statut: "active", priorite: 2, noteActuelle: null, tachesEnRetard: [], derniereTacheFaite: null, postsPrevus: 0, postsPublies: 0, creneaux: [], envoisEnCours: [] },
] };

let lignes: any[]; let props: Map<number, any>;
const deps = () => ({
  enCours: vi.fn(async (userId: string) => lignes.find((l) => l.userId === userId && l.statut === "en_cours")),
  creer: vi.fn(async (v: any) => { const l = { id: lignes.length + 1, ...v }; lignes.push(l); return l; }),
  maj: vi.fn(async (id: number, userId: string, patch: any) => { const l = lignes.find((x) => x.id === id && x.userId === userId); Object.assign(l, patch); return l; }),
  derniereActivite: vi.fn(async () => new Date("2026-11-10T00:00:00Z")),
  bilan: vi.fn(async () => bilan),
  proposition: vi.fn(async (id: number, userId: string) => { const p = props.get(id); return p && p.userId === userId ? p : undefined; }),
  evaluer: vi.fn(async () => ({ depuis: bilan.depuis, parReseau: [], limites: [] })),
});

beforeEach(() => { lignes = []; props = new Map(); });

describe("séance de redémarrage", () => {
  it("interrupteur : seulement les ids de SEANCE_REDEMARRAGE_USERS", () => {
    expect(seanceActivePour("u1", { SEANCE_REDEMARRAGE_USERS: "u1, u3" } as any)).toBe(true);
    expect(seanceActivePour("u2", { SEANCE_REDEMARRAGE_USERS: "u1" } as any)).toBe(false);
    expect(seanceActivePour("u1", {} as any)).toBe(false);
  });
  it("démarrer deux fois : la même séance, premier projet en cours", async () => {
    const d = deps();
    const a = await demarrerSeance("u1", M, d);
    const b = await demarrerSeance("u1", M, d);
    expect(b.id).toBe(a.id);
    expect(d.creer).toHaveBeenCalledTimes(1);
    expect(a.projetCourant).toBe(2);
    expect(a.projets).toEqual([{ projectId: 2, etat: "en_cours" }, { projectId: 4, etat: "a_faire" }]);
  });
  it("proposition du projet 1 validée : on passe au projet 2", async () => {
    const d = deps();
    const s = await demarrerSeance("u1", M, d);
    await rattacherProposition(s, 31, d);
    props.set(31, { id: 31, userId: "u1", statut: "validee" });
    const apres = await synchroniser("u1", M, d);
    expect(apres.seance!.projetCourant).toBe(4);
    expect(apres.seance!.projets).toEqual([{ projectId: 2, etat: "fait", propositionId: 31 }, { projectId: 4, etat: "en_cours" }]);
    expect(apres.termineeMaintenant).toBe(false);
  });
  it("interrompue puis reprise : même projet, même proposition en attente", async () => {
    const d = deps();
    const s = await demarrerSeance("u1", M, d);
    await rattacherProposition(s, 31, d);
    props.set(31, { id: 31, userId: "u1", statut: "en_attente", resume: "Agence : 2 changements", changements: [], expireA: "2026-12-02T09:00:00.000Z" });
    const r = await synchroniser("u1", new Date("2026-11-26T09:00:00Z"), d);
    expect(r.seance!.projetCourant).toBe(2);
    expect(r.propositionEnAttente?.id).toBe(31);
  });
  it("proposition expirée ou annulée : le projet reste en cours, sans proposition", async () => {
    const d = deps();
    const s = await demarrerSeance("u1", M, d);
    await rattacherProposition(s, 31, d);
    props.set(31, { id: 31, userId: "u1", statut: "expiree" });
    const r = await synchroniser("u1", M, d);
    expect(r.seance!.projets[0]).toEqual({ projectId: 2, etat: "en_cours" });
    expect(r.propositionEnAttente).toBeUndefined();
  });
  it("tous les projets faits ou passés : terminée, évaluation stockée", async () => {
    const d = deps();
    await demarrerSeance("u1", M, d);
    await passerProjet("u1", M, d);
    const r = await passerProjet("u1", M, d);
    expect(r.termineeMaintenant).toBe(true);
    expect(lignes[0]).toMatchObject({ statut: "terminee", evaluation: { parReseau: [], limites: [] } });
    expect(d.evaluer).toHaveBeenCalledWith("u1", new Date(bilan.depuis), M);
  });
  it("vue : position et nom du projet courant", async () => {
    const d = deps();
    const s = await demarrerSeance("u1", M, d);
    expect(vueSeance(s)).toMatchObject({ id: s.id, position: 1, total: 2, projetCourant: { projectId: 2, nom: "Agence" } });
  });
});
