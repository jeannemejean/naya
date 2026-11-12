// construirePromptJournee : la génération quotidienne produit les tâches de SON jour (date
// donnée), plus « la semaine à venir » répartie du lundi au vendredi, et reçoit les titres déjà
// prévus cette semaine pour ne pas les répéter. Vaut pour toutes les utilisatrices.
import { describe, it, expect, vi } from "vitest";

vi.mock("./jalons-verrouilles", () => ({ marquerTachesDesJalonsVerrouilles: vi.fn(async () => 0) }));
vi.mock("./claude", async (orig) => ({ ...(await orig<any>()), callClaudeWithContext: vi.fn() }));
vi.mock("./garde-langue", async (orig) => ({ ...(await orig<any>()), imposerLangueDuCompte: vi.fn(async () => 0), langueDuCompte: vi.fn(async () => "fr") }));
vi.mock("../db", () => ({ db: {}, pool: { query: vi.fn(), on: vi.fn() } }));
vi.mock("../storage", () => ({ storage: new Proxy({} as any, { get: () => async () => null }) }));

const { construirePromptJournee } = await import("./openai");

const base = {
  userId: "u1", brandDna: { businessName: "Lune" }, recentContent: [], recentOutreach: [], weeklyGoals: {},
  completedTasksToday: [], projectContext: { projectId: 7, projectName: "Lune" },
  activeGoals: [{ id: 1, title: "Signer 3 clients", successMode: "revenue", goalType: "revenue", dueDate: null }],
} as any;

describe("construirePromptJournee", () => {
  it("vise le jour donné : date et consigne « tâches pour CE jour », plus de semaine du lundi au vendredi", () => {
    const p = construirePromptJournee({ ...base, date: "2026-11-12", dejaPlanifieesSemaine: [] });
    expect(p).toContain("2026-11-12");
    expect(p).toContain("tâches pour CE jour");
    expect(p).not.toContain("Monday-Friday");
    expect(p).not.toContain("THE WEEK AHEAD");
    expect(p).not.toContain("spread across the week");
  });

  it("liste les titres déjà prévus cette semaine sous « ne pas répéter »", () => {
    const p = construirePromptJournee({
      ...base, date: "2026-11-13",
      dejaPlanifieesSemaine: ["Chiffrer le devis IN SCENA", "Relire la proposition Lune"],
    });
    const i = p.indexOf("déjà prévues cette semaine, ne pas répéter");
    expect(i).toBeGreaterThan(-1);
    const suite = p.slice(i);
    expect(suite).toContain("Chiffrer le devis IN SCENA");
    expect(suite).toContain("Relire la proposition Lune");
  });

  it("sans titre déjà prévu : pas de section vide", () => {
    const p = construirePromptJournee({ ...base, date: "2026-11-12", dejaPlanifieesSemaine: [] });
    expect(p).not.toContain("déjà prévues cette semaine, ne pas répéter");
  });

  it("garde les parties propres au fil conducteur", () => {
    const p = construirePromptJournee({ ...base, date: "2026-11-12", dejaPlanifieesSemaine: [], filConducteur: true });
    expect(p).toContain(`"etapeIndex": 0`);
    expect(p).toContain("never default to 0");
  });
});
