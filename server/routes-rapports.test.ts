// Routes des rapports client. `./storage`, `./auth`, la préparation et l'ordonnanceur mockés.
import express from "express";
import http from "node:http";
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

vi.mock("./auth", () => ({
  isAuthenticated: (req: any, _res: any, next: any) => { req.userId = "user-1"; next(); },
}));
let rapports: Record<string, any> = {};
const storageMock = {
  getProject: vi.fn(async (id: number, u: string) => {
    if (u !== "user-1") return undefined;
    if (id === 7) return { id: 7, name: "Maison X", projectKind: "client", clientName: "Maison X" };
    if (id === 5) return { id: 5, name: "Perso", projectKind: "personal" };
    return undefined;
  }),
  getRapports: vi.fn(async () => Object.values(rapports)),
  getRapport: vi.fn(async (_u: string, _p: number, m: string) => rapports[m]),
  updateRapport: vi.fn(async (_u: string, _p: number, m: string, patch: any, opts?: { siBrouillon?: boolean }) => {
    if (opts?.siBrouillon && rapports[m]?.statut !== "brouillon") return undefined;
    return (rapports[m] = { ...rapports[m], ...patch });
  }),
  deleteRapport: vi.fn(async (_u: string, _p: number, m: string) => { delete rapports[m]; return true; }),
  getRapportParJeton: vi.fn(async (j: string) => Object.values(rapports).find((r: any) => r.jeton === j)),
  getRoutineByCible: vi.fn(async () => undefined),
  getRoutineRuns: vi.fn(async () => []),
  getUserPreferences: vi.fn(async () => ({ language: "en" })),
  ensureRoutine: vi.fn(async (row: any) => ({ id: 9, ...row })),
  updateRoutine: vi.fn(async (_id: number, _u: string, p: any) => ({ id: 9, ...p })),
};
vi.mock("./storage", () => ({ storage: storageMock }));
const prep = vi.hoisted(() => ({ preparerRapport: vi.fn() }));
vi.mock("./services/rapports/rediger", async (io) => ({ ...(await io<any>()), preparerRapport: prep.preparerRapport }));
const agence = vi.hoisted(() => ({ nom: "Agence JMD" as string }));
vi.mock("./services/rapports/deps", () => ({ depsRapport: { nomAgence: async () => agence.nom } }));
vi.mock("./services/routines/ordonnanceur", () => ({ executerUne: vi.fn(async () => ({ statut: "ok" })), REGISTRE: {} }));

const { registerRapportsRoutes } = await import("./routes-rapports");
const app = express();
app.use(express.json());
registerRapportsRoutes(app);
const server = http.createServer(app);
await new Promise<void>((r) => server.listen(0, r));
const port = (server.address() as any).port;
afterAll(() => server.close());
const appel = (method: string, path: string, body?: unknown) =>
  fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });

const BROUILLON = () => ({
  userId: "user-1", projectId: 7, mois: "2026-09", statut: "brouillon", jeton: null, partageActif: false,
  sections: { synthese: "S", realise: "R", resultats: "Res", prochainesEtapes: "P" },
  donnees: {
    chiffres: { indicateurs: { ca: 12000, marge_contributive: 777, depense_acquisition: 55 }, evolutions: { ca: 0.2, marge_contributive: 0.5 } },
    contenus: { total: 3, parPlateforme: { instagram: 3 }, meilleurs: [{ titre: "T", plateforme: "instagram", date: "2026-09-10", score: 4.91 }] },
    prospection: { envoyes: 4, reponses: 1, enDiscussion: 99 }, veille: ["interne"],
  },
});
beforeEach(() => { vi.clearAllMocks(); rapports = { "2026-09": BROUILLON() }; });

describe("routes des rapports client", () => {
  it("projet d'une autre → 404 ; projet perso → 409", async () => {
    expect((await appel("GET", "/api/rapports/8")).status).toBe(404);
    expect((await appel("POST", "/api/rapports/8/preparer", { mois: "2026-09" })).status).toBe(404);
    expect((await appel("POST", "/api/rapports/8/2026-09/publier")).status).toBe(404);
    expect((await appel("GET", "/api/rapports/5")).status).toBe(409);
    expect(storageMock.updateRapport).not.toHaveBeenCalled();
  });

  it("préparer : mois futur refusé ; aucune donnée → 422 ; ok → routine installée", async () => {
    expect((await appel("POST", "/api/rapports/7/preparer", { mois: "2099-01" })).status).toBe(400);
    prep.preparerRapport.mockResolvedValueOnce({ statut: "rien" });
    expect((await appel("POST", "/api/rapports/7/preparer", { mois: "2026-09" })).status).toBe(422);
    expect(storageMock.ensureRoutine).not.toHaveBeenCalled();
    prep.preparerRapport.mockResolvedValueOnce({ statut: "ok", rapport: BROUILLON() });
    expect((await appel("POST", "/api/rapports/7/preparer", { mois: "2026-09" })).status).toBe(200);
    expect(storageMock.ensureRoutine).toHaveBeenCalledTimes(1);
  });

  it("modifier : textes seulement ; un rapport publié ne se modifie pas", async () => {
    expect((await appel("PATCH", "/api/rapports/7/2026-09", { sections: { synthese: "Nouveau" } })).status).toBe(200);
    expect(rapports["2026-09"].sections.synthese).toBe("Nouveau");
    expect((await appel("PATCH", "/api/rapports/7/2026-09", { sections: { autre: "x" } })).status).toBe(400);
    rapports["2026-09"].statut = "publie";
    expect((await appel("PATCH", "/api/rapports/7/2026-09", { sections: { synthese: "Encore" } })).status).toBe(409);
  });

  it("publié entre la lecture et l'écriture (autre onglet) : le texte publié ne change pas", async () => {
    const lu = { ...rapports["2026-09"] };
    rapports["2026-09"].statut = "publie";
    storageMock.getRapport.mockResolvedValueOnce(lu);
    expect((await appel("PATCH", "/api/rapports/7/2026-09", { sections: { synthese: "Trop tard" } })).status).toBe(409);
    expect(rapports["2026-09"].sections.synthese).toBe("S");
  });

  it("publier, lire sans compte, couper le lien : le lien ne répond plus, de façon indistincte", async () => {
    const pub = await (await appel("POST", "/api/rapports/7/2026-09/publier")).json();
    expect(pub).toMatchObject({ statut: "publie", partageActif: true });
    const jeton = String(pub.lien).replace("/rapport/", "");
    expect(jeton.length).toBeGreaterThanOrEqual(40);

    const r = await appel("GET", `/api/public/rapports/${jeton}`);
    expect(r.status).toBe(200);
    expect(r.headers.get("x-robots-tag")).toContain("noindex");
    const j = await r.json();
    expect(j).toMatchObject({ client: "Maison X", agence: "Agence JMD", mois: "2026-09" });
    const brut = JSON.stringify(j);
    for (const interdit of ["user-1", "projectId", "jeton", "interne", "marge_contributive", "depense_acquisition", "score", "4.91", "enDiscussion", "parPlateforme"]) {
      expect(brut).not.toContain(interdit);
    }
    expect(j.chiffres.indicateurs).toEqual({ ca: 12000 });
    expect(j.contenus).toEqual({ total: 3, meilleurs: [{ titre: "T", plateforme: "instagram", date: "2026-09-10" }] });
    expect(j.prospection).toEqual({ envoyes: 4, reponses: 1 });

    await appel("POST", "/api/rapports/7/2026-09/couper");
    const coupe = await appel("GET", `/api/public/rapports/${jeton}`);
    const inconnu = await appel("GET", `/api/public/rapports/${"x".repeat(43)}`);
    expect(coupe.status).toBe(404);
    expect(await coupe.json()).toEqual(await inconnu.json());
  });

  it("nouveau lien sur un rapport coupé : le partage reste coupé ; republier garde la date de première publication", async () => {
    await appel("POST", "/api/rapports/7/2026-09/publier");
    const premiere = rapports["2026-09"].publieLe;
    await appel("POST", "/api/rapports/7/2026-09/couper");
    await appel("POST", "/api/rapports/7/2026-09/nouveau-lien");
    expect(rapports["2026-09"].partageActif).toBe(false);
    await appel("POST", "/api/rapports/7/2026-09/publier");
    expect(rapports["2026-09"].publieLe).toBe(premiere);
  });

  it("lecture publique : langue du compte, jamais un nom personnel faute de nom d'agence, et plus rien si le projet redevient perso", async () => {
    await appel("POST", "/api/rapports/7/2026-09/publier");
    const jeton = rapports["2026-09"].jeton;
    const j = await (await appel("GET", `/api/public/rapports/${jeton}`)).json();
    expect(j.langue).toBe("en");
    expect(j.libelleMois).toBeUndefined();
    agence.nom = "";
    expect((await (await appel("GET", `/api/public/rapports/${jeton}`)).json()).agence).toBe("");
    agence.nom = "Agence JMD";
    storageMock.getProject.mockResolvedValueOnce({ id: 7, name: "Maison X", projectKind: "personal" } as any);
    expect((await appel("GET", `/api/public/rapports/${jeton}`)).status).toBe(404);
  });

  it("un brouillon n'est jamais lisible publiquement, même avec un jeton ; nouveau lien → l'ancien meurt", async () => {
    await appel("POST", "/api/rapports/7/2026-09/publier");
    const ancien = rapports["2026-09"].jeton;
    await appel("POST", "/api/rapports/7/2026-09/nouveau-lien");
    expect((await appel("GET", `/api/public/rapports/${ancien}`)).status).toBe(404);
    const nouveau = rapports["2026-09"].jeton;
    expect((await appel("GET", `/api/public/rapports/${nouveau}`)).status).toBe(200);
    await appel("POST", "/api/rapports/7/2026-09/depublier");
    expect((await appel("GET", `/api/public/rapports/${nouveau}`)).status).toBe(404);
  });
});
