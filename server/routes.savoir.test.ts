// Routes du Savoir de Naya : dépôt PDF, retrait, refus des doublons.
import express from "express";
import http from "node:http";
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

vi.mock("./db", () => ({
  db: { select: vi.fn(() => ({ from: () => ({ where: () => Promise.resolve([]) }) })) },
  pool: { query: vi.fn(), on: vi.fn() },
}));
vi.mock("./auth", () => ({
  setupAuth: vi.fn(async () => {}),
  isAuthenticated: (req: any, _res: any, next: any) => { req.userId = "user-1"; next(); },
  hashPassword: vi.fn(), verifyPassword: vi.fn(), generateUserId: vi.fn(), generateJWT: vi.fn(),
}));
const storageMock = { getUser: vi.fn() };
vi.mock("./storage", () => ({ storage: storageMock }));

const depot = {
  deposerDossier: vi.fn(),
  listerDossiers: vi.fn(),
  dossierExiste: vi.fn(),
  retirerDossier: vi.fn(),
};
vi.mock("./services/memory/deposer-dossier", () => ({ ...depot, perimerSouvenirs: vi.fn() }));
const extraction = { extraireTextePdf: vi.fn() };
vi.mock("./services/memory/extraire-pdf", async (orig) => ({
  ...(await orig<any>()),
  extraireTextePdf: extraction.extraireTextePdf,
}));

const { registerRoutes } = await import("./routes");

describe("routes savoir", () => {
  let server: http.Server;
  let base: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    storageMock.getUser.mockResolvedValue({ role: "owner" });
    depot.dossierExiste.mockResolvedValue(false);
    depot.deposerDossier.mockResolvedValue({ morceaux: 3, vectorises: 3, ids: [1, 2, 3] });
    extraction.extraireTextePdf.mockResolvedValue({ statut: "ok", texte: "x".repeat(300) });
    const app = express();
    app.use(express.json());
    server = await registerRoutes(app);
    await new Promise<void>((r) => server.listen(0, r));
    base = `http://127.0.0.1:${(server.address() as any).port}`;
  });
  afterAll(async () => { await new Promise<void>((r) => server?.close(() => r())); });

  function form(files: { name: string; type?: string; content?: string | Buffer }[]) {
    const fd = new FormData();
    for (const f of files) {
      fd.append("fichiers", new Blob([f.content ?? "%PDF-1.4 x"], { type: f.type ?? "application/pdf" }), f.name);
    }
    return fd;
  }
  const post = (fd: FormData) => fetch(`${base}/api/savoir/pdf`, { method: "POST", body: fd });

  it("refuse un non-propriétaire (PDF et retrait)", async () => {
    storageMock.getUser.mockResolvedValue({ role: "user" });
    expect((await post(form([{ name: "a.pdf" }]))).status).toBe(403);
    const r = await fetch(`${base}/api/savoir/dossiers`, {
      method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ titre: "a" }),
    });
    expect(r.status).toBe(403);
    expect(depot.retirerDossier).not.toHaveBeenCalled();
  });

  it("aucun fichier : 400 aucun_fichier", async () => {
    const res = await post(new FormData());
    expect(res.status).toBe(400);
    expect((await res.json()).message).toBe("aucun_fichier");
  });

  it("dépose un PDF, titre propre (accents, .PDF)", async () => {
    const res = await post(form([{ name: "Étude été.PDF" }]));
    expect(res.status).toBe(200);
    const { resultats } = await res.json();
    expect(resultats).toEqual([{ fichier: "Étude été.PDF", titre: "Étude été", statut: "depose", morceaux: 3 }]);
    expect(depot.deposerDossier).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-1", titre: "Étude été" }));
  });

  it("refuse un mimetype non PDF", async () => {
    const res = await post(form([{ name: "a.txt", type: "text/plain" }]));
    expect((await res.json()).resultats[0].statut).toBe("pas_un_pdf");
    expect(extraction.extraireTextePdf).not.toHaveBeenCalled();
  });

  it("signature invalide : statut remonté de l'extraction", async () => {
    extraction.extraireTextePdf.mockResolvedValue({ statut: "pas_un_pdf" });
    const res = await post(form([{ name: "a.pdf", content: "pas un pdf" }]));
    expect((await res.json()).resultats[0].statut).toBe("pas_un_pdf");
    expect(depot.deposerDossier).not.toHaveBeenCalled();
  });

  it("même titre déjà déposé : deja_depose, rien n'est écrit", async () => {
    depot.dossierExiste.mockResolvedValue(true);
    const res = await post(form([{ name: "a.pdf" }]));
    expect((await res.json()).resultats[0].statut).toBe("deja_depose");
    expect(depot.deposerDossier).not.toHaveBeenCalled();
  });

  it("un fichier en échec au milieu du lot n'empêche pas les autres", async () => {
    extraction.extraireTextePdf
      .mockResolvedValueOnce({ statut: "ok", texte: "x".repeat(300) })
      .mockResolvedValueOnce({ statut: "pas_de_texte" })
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ statut: "ok", texte: "y".repeat(300) });
    const res = await post(form([{ name: "a.pdf" }, { name: "b.pdf" }, { name: "c.pdf" }, { name: "d.pdf" }]));
    const { resultats } = await res.json();
    expect(resultats.map((r: any) => r.statut)).toEqual(["depose", "pas_de_texte", "illisible", "depose"]);
    expect(depot.deposerDossier).toHaveBeenCalledTimes(2);
  });

  it("fichier > 10 Mo : 400 fichier_trop_lourd, avant toute extraction", async () => {
    const gros = Buffer.alloc(10 * 1024 * 1024 + 10, 0x41);
    const res = await post(form([{ name: "gros.pdf", content: gros }]));
    expect(res.status).toBe(400);
    expect((await res.json()).message).toBe("fichier_trop_lourd");
    expect(extraction.extraireTextePdf).not.toHaveBeenCalled();
  });

  it("plus de 10 fichiers : 400 trop_de_fichiers", async () => {
    const res = await post(form(Array.from({ length: 11 }, (_, i) => ({ name: `f${i}.pdf` }))));
    expect(res.status).toBe(400);
    expect((await res.json()).message).toBe("trop_de_fichiers");
  });

  it("retrait : titre vide 400, inconnu 404, ok → retires", async () => {
    const del = (b: any) => fetch(`${base}/api/savoir/dossiers`, {
      method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify(b),
    });
    expect((await del({ titre: "  " })).status).toBe(400);
    expect((await del({})).status).toBe(400);
    depot.retirerDossier.mockResolvedValueOnce(0);
    expect((await del({ titre: "x" })).status).toBe(404);
    depot.retirerDossier.mockResolvedValueOnce(4);
    const ok = await del({ titre: "x" });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ retires: 4 });
  });

  it("retrait puis re-dépôt : autorisé (dossierExiste redit faux)", async () => {
    depot.retirerDossier.mockResolvedValue(2);
    await fetch(`${base}/api/savoir/dossiers`, {
      method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ titre: "a" }),
    });
    const res = await post(form([{ name: "a.pdf" }]));
    expect((await res.json()).resultats[0].statut).toBe("depose");
  });

  it("dépôt texte : titre déjà présent → 409 deja_depose", async () => {
    depot.dossierExiste.mockResolvedValue(true);
    const res = await fetch(`${base}/api/savoir/dossiers`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ titre: "a", contenu: "du texte" }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).message).toBe("deja_depose");
    expect(depot.deposerDossier).not.toHaveBeenCalled();
  });
});
