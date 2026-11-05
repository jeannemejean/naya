import { describe, it, expect } from "vitest";
import type { ActionFaite, PropositionVue } from "@shared/agent";
import {
  etatAnnulation,
  etatProposition,
  doitInvalider,
  raisonDeErreur,
  propositionsAAjuster,
  messageDepuisHistorique,
} from "./companion-logique";

const H = 3600 * 1000;
const creee = new Date("2026-11-02T10:00:00.000Z");
const faite: ActionFaite = { actionId: 7, resume: "Tâche ajoutée", annulableJusqua: new Date(creee.getTime() + 24 * H).toISOString() };
const proposeeA = new Date("2026-11-02T10:00:00.000Z");
const prop: PropositionVue = { id: 3, resume: "Décaler", changements: [], expireA: new Date(proposeeA.getTime() + 1 * H).toISOString() };

describe("etatAnnulation", () => {
  it("annulable juste après l'action", () => {
    expect(etatAnnulation(faite, new Date(creee.getTime() + 1000))).toBe("annulable");
  });
  it("encore annulable à 24 h pile (le serveur refuse au-delà de 24 h strictement)", () => {
    expect(etatAnnulation(faite, new Date(creee.getTime() + 24 * H))).toBe("annulable");
  });
  it("expirée à 24 h + 1 s", () => {
    expect(etatAnnulation(faite, new Date(creee.getTime() + 24 * H + 1000))).toBe("expiree");
  });
  it("une date illisible est traitée comme expirée", () => {
    expect(etatAnnulation({ ...faite, annulableJusqua: "n'importe quoi" }, creee)).toBe("expiree");
  });
});

describe("etatProposition", () => {
  it("en attente juste avant 1 h", () => {
    expect(etatProposition(prop, new Date(proposeeA.getTime() + 1 * H - 1000))).toBe("en_attente");
  });
  it("expirée à 1 h pile (le serveur : maintenant >= expire_a)", () => {
    expect(etatProposition(prop, new Date(proposeeA.getTime() + 1 * H))).toBe("expiree");
  });
  it("expirée au-delà", () => {
    expect(etatProposition(prop, new Date(proposeeA.getTime() + 2 * H))).toBe("expiree");
  });
  it("une date illisible est traitée comme expirée", () => {
    expect(etatProposition({ ...prop, expireA: "" }, proposeeA)).toBe("expiree");
  });
});

describe("doitInvalider", () => {
  it("vise les tâches, projets, préférences et captures, quelle que soit la forme de la clé", () => {
    expect(doitInvalider(["/api/tasks"])).toBe(true);
    expect(doitInvalider(["/api/tasks", "2026-11-02"])).toBe(true);
    expect(doitInvalider(["/api/tasks?date=2026-11-02"])).toBe(true);
    expect(doitInvalider(["/api/projects?limit=200"])).toBe(true);
    expect(doitInvalider(["/api/projects/5/milestones"])).toBe(true);
    expect(doitInvalider(["/api/preferences"])).toBe(true);
    expect(doitInvalider(["/api/capture"])).toBe(true);
  });
  it("vise aussi la mesure, la mémoire et les déclencheurs de jalons (clés réelles des écrans)", () => {
    expect(doitInvalider(["/api/mesure/5"])).toBe(true);             // pages/mesure.tsx, aujourdhui/Capsules.tsx
    expect(doitInvalider(["/api/memory"])).toBe(true);               // strategy.tsx
    expect(doitInvalider(["/api/memory", "active"])).toBe(true);     // strategy.tsx (archivés ou non)
    expect(doitInvalider(["/api/milestone-triggers"])).toBe(true);   // strategy.tsx, quick-capture.tsx
    expect(doitInvalider(["/api/projects/5/milestones"])).toBe(true); // jalons : sous /api/projects
    expect(doitInvalider(["/api/memoryX"])).toBe(false);
  });
  it("laisse le reste", () => {
    expect(doitInvalider(["/api/companion/history"])).toBe(false);
    expect(doitInvalider(["/api/task-lists"])).toBe(false);
    expect(doitInvalider(["/api/projectsX"])).toBe(false);
    expect(doitInvalider([42])).toBe(false);
    expect(doitInvalider([])).toBe(false);
  });
});

describe("raisonDeErreur", () => {
  it("lit la raison d'un 409 levé par apiRequest", () => {
    expect(raisonDeErreur(new Error('409: {"message":"modifiee"}'), ["modifiee", "expiree"])).toBe("modifiee");
  });
  it("renvoie null pour une raison inconnue, un autre statut ou un corps illisible", () => {
    expect(raisonDeErreur(new Error('409: {"message":"autre"}'), ["modifiee"])).toBeNull();
    expect(raisonDeErreur(new Error('500: {"message":"modifiee"}'), ["modifiee"])).toBeNull();
    expect(raisonDeErreur(new Error("409: pas du json"), ["modifiee"])).toBeNull();
    expect(raisonDeErreur("bizarre", ["modifiee"])).toBeNull();
  });
});

describe("propositionsAAjuster", () => {
  const maintenant = new Date(proposeeA.getTime() + 10 * 60 * 1000);
  const p2: PropositionVue = { ...prop, id: 4 };
  const vieille: PropositionVue = { ...prop, id: 5, expireA: new Date(proposeeA.getTime() - 1000).toISOString() };
  it("garde les propositions affichées, encore en attente et pas encore traitées à l'écran", () => {
    const messages = [{ propositions: [prop, vieille] }, {}, { propositions: [p2] }];
    expect(propositionsAAjuster(messages, { 3: "validee" }, maintenant)).toEqual([4]);
  });
  it("aucune quand il n'y a rien", () => {
    expect(propositionsAAjuster([], {}, maintenant)).toEqual([]);
  });
});

describe("messageDepuisHistorique", () => {
  it("réaffiche faites, propositions et recherches depuis actions", () => {
    const m = messageDepuisHistorique({
      role: "assistant", content: "C'est fait.",
      actions: { faites: [faite], propositions: [prop], recherches: ["« offre »"] },
    });
    expect(m).toEqual({ role: "assistant", content: "C'est fait.", faites: [faite], propositions: [prop], recherches: ["« offre »"] });
  });
  it("ignore l'ancien format (tableau d'actions exécutées par le client) et les valeurs vides", () => {
    expect(messageDepuisHistorique({ role: "assistant", content: "x", actions: [{ type: "create_task", title: "t" }] }))
      .toEqual({ role: "assistant", content: "x", faites: [], propositions: [], recherches: [] });
    expect(messageDepuisHistorique({ role: "user", content: "y", actions: null }))
      .toEqual({ role: "user", content: "y", faites: [], propositions: [], recherches: [] });
  });
  it("écarte les éléments mal formés", () => {
    const m = messageDepuisHistorique({
      role: "assistant", content: "z",
      actions: { faites: [{ resume: "sans id" }, faite], propositions: [{ id: "x" }, prop], recherches: [1, "ok"] },
    });
    expect(m.faites).toEqual([faite]);
    expect(m.propositions).toEqual([prop]);
    expect(m.recherches).toEqual(["ok"]);
  });
});
