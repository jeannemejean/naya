// Mode « écrire à un tiers » de buildNayaContext (prospection) : la marque oui, la vie
// intérieure de l'utilisatrice non. `./db` et `../storage` sont mockés : aucune requête réelle.
import { describe, it, expect, vi } from "vitest";

const fiches = [{ id: 1, title: "Titre", factSummary: "FAIT", angle: "ANGLE", userAnswer: null, source: "x" }];

vi.mock("../db", () => {
  const chaine = (): any => {
    const suite: any = { then: (ok: any, ko: any) => Promise.resolve(fiches).then(ok, ko) };
    for (const m of ["from", "where", "orderBy", "limit"]) suite[m] = () => suite;
    return suite;
  };
  return { db: { select: () => chaine() }, pool: { query: vi.fn(), on: vi.fn() } };
});

const valeurs: Record<string, any> = {
  getBrandDna: { businessName: "Agence JMD", uniquePositioning: "Direction éditoriale pour la beauté" },
  getProject: { id: 7, name: "JMD", type: "service", monetizationIntent: "revenue", priorityLevel: 1 },
  getActiveGoalsForProject: [{ id: 1, title: "Signer 3 clients", successMode: "x", dueDate: null }],
  getGoalProgress: { completed: 0, total: 0 },
  getUserPreferences: { currentEnergyLevel: "low", currentEmotionalContext: "fatiguée" },
  getMilestones: [{ title: "Jalon", status: "locked" }],
  getTargetPersonas: [],
  getVeilleConstats: [
    { type: "objection", texte: "OBJECTION RELEVEE", kind: "veille_voix_client" },
    { type: "position", texte: "POSITION PERDUE", kind: "veille_serp" },
  ],
  getFondations: {
    statuts: { offre: "valide", motivations: "valide", kpis: "valide", plan: "propose" },
    offre: { nom: "OFFRE ENTREE", description: "", pourquoi: "", existe: true },
    motivations: [{ cle: "m", nom: "MOTIVATION VALIDEE", angle: "", accroches: [], preuves: [], objections: [], formats: [] }],
    kpis: [{ cle: "k", nom: "KPI SUIVI", etage: "business", definition: "", frequence: "mensuel" }],
    plan: { maturite: "demarrage", resume: "", briques: [{ cle: "seo", statut: "maintenant", raison: "", action: "PLAN NON VALIDE" }] },
  },
};
vi.mock("../storage", () => ({
  storage: new Proxy({} as any, { get: (_t, k: string) => async () => valeurs[k] }),
}));

vi.mock("./memory/retrieve", () => ({
  retrieveMemories: async () => ({
    cap: [{ content: "MEMOIRE CAP" }], founder: [{ content: "MEMOIRE FONDATRICE" }],
    reception: [], savoir: [{ content: "SAVOIR DEPOSE" }],
  }),
}));

const { buildNayaContext } = await import("./naya-context");

describe("buildNayaContext, mode tiers", () => {
  it("garde la marque et le savoir déposé", async () => {
    const c = await buildNayaContext("u1", 7, "prospect", { destinataire: "tiers" });
    expect(c).toContain("Identité business");
    expect(c).toContain("Agence JMD");
    expect(c).toContain("SAVOIR DEPOSE");
  });

  it("garde la veille du marché : les objections réelles servent les messages", async () => {
    const c = await buildNayaContext("u1", 7, "prospect", { destinataire: "tiers" });
    expect(c).toContain("Veille du marché");
    expect(c).toContain("OBJECTION RELEVEE");
    expect(c).not.toContain("POSITION PERDUE");
  });

  it("garde l'offre d'entrée et les motivations validées, sans KPI", async () => {
    const c = await buildNayaContext("u1", 7, "prospect", { destinataire: "tiers" });
    expect(c).toContain("OFFRE ENTREE");
    expect(c).toContain("MOTIVATION VALIDEE");
    expect(c).not.toContain("KPI SUIVI");
  });

  it("retire tâches, jalons, énergie, mémoire de fondatrice et revue du jour", async () => {
    const c = await buildNayaContext("u1", 7, "prospect", { destinataire: "tiers" });
    expect(c).not.toContain("Instruction absolue");
    expect(c).not.toContain("Jalons du projet");
    expect(c).not.toContain("Niveau d'énergie");
    expect(c).not.toContain("MEMOIRE FONDATRICE");
    expect(c).not.toContain("La revue du jour");
  });

  it("le mode par défaut est inchangé", async () => {
    const c = await buildNayaContext("u1", 7, "x");
    expect(c).toContain("Niveau d'énergie");
    expect(c).toContain("Instruction absolue");
    expect(c).toContain("La revue du jour");
    expect(c).toContain("OBJECTION RELEVEE");
    expect(c).toContain("POSITION PERDUE");
    expect(c).toContain("KPI SUIVI");
    expect(c).not.toContain("PLAN NON VALIDE");
  });
});
