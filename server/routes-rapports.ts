// server/routes-rapports.ts — les rapports d'un projet CLIENT : préparer (Naya rédige le
// brouillon), relire et corriger, publier, partager par lien privé, couper le lien. La lecture
// publique (`/api/public/rapports/:jeton`) ne rend que ce qui est publié ET partagé.
import type { Express } from "express";
import { randomBytes } from "node:crypto";
import { isAuthenticated } from "./auth";
import { storage } from "./storage";
import { perimetreDemande } from "./routes-social";
import { preparerRapport, CLES_SECTIONS } from "./services/rapports/rediger";
import { SUIVIS } from "./services/rapports/donnees";
import { depsRapport } from "./services/rapports/deps";
import { routineRapportPour, KIND_RAPPORT } from "./services/rapports/routine";
import { executerUne, REGISTRE } from "./services/routines/ordonnanceur";
import { porteeDe } from "./services/connexions/portee";

const MOIS = /^\d{4}-(0[1-9]|1[0-2])$/;
const nouveauJeton = () => randomBytes(32).toString("base64url");
const cleRoutine = (projectId: number) => `project:${projectId}`;

/** Ce que l'écran de l'utilisatrice reçoit d'un rapport. */
const vue = (r: any) => ({
  mois: r.mois, statut: r.statut, sections: r.sections, donnees: r.donnees,
  partageActif: r.partageActif, lien: r.jeton ? `/rapport/${r.jeton}` : null,
  publieLe: r.publieLe, updatedAt: r.updatedAt,
});

/** Mois au plus égal au mois en cours (heure de Paris). */
function moisValide(m: unknown): m is string {
  if (typeof m !== "string" || !MOIS.test(m)) return false;
  const courant = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
  return m <= courant;
}

/** Sections modifiées : seulement les quatre textes, chacun ≤ 2000 caractères. */
export function validerSections(corps: unknown): { ok: true; sections: Record<string, string> } | { ok: false } {
  if (!corps || typeof corps !== "object") return { ok: false };
  const s: Record<string, string> = {};
  for (const [k, v] of Object.entries(corps as Record<string, unknown>)) {
    if (!(CLES_SECTIONS as string[]).includes(k) || typeof v !== "string" || v.length > 2000) return { ok: false };
    s[k] = v;
  }
  return Object.keys(s).length ? { ok: true, sections: s } : { ok: false };
}

/**
 * Ce qui sort vers le client, champ par champ : jamais la marge, les coûts variables, les
 * scores internes ni la veille brute — même si les données enregistrées en contiennent.
 */
export function projectionPublique(donnees: any, sections: any) {
  const d = donnees ?? {};
  const choisir = (o: any) => {
    if (!o) return {};
    const r: Record<string, number | null> = {};
    for (const k of SUIVIS) if (k in o) r[k] = typeof o[k] === "number" ? o[k] : null;
    return r;
  };
  const texte = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    sections: Object.fromEntries(CLES_SECTIONS.map((k) => [k, texte(sections?.[k])])),
    chiffres: d.chiffres ? { indicateurs: choisir(d.chiffres.indicateurs), evolutions: choisir(d.chiffres.evolutions) } : null,
    contenus: d.contenus ? {
      total: Number(d.contenus.total) || 0,
      meilleurs: (Array.isArray(d.contenus.meilleurs) ? d.contenus.meilleurs : []).slice(0, 3)
        .map((c: any) => ({ titre: texte(c?.titre), plateforme: texte(c?.plateforme), date: texte(c?.date) })),
    } : null,
    prospection: d.prospection ? { envoyes: Number(d.prospection.envoyes) || 0, reponses: Number(d.prospection.reponses) || 0 } : null,
  };
}

export function registerRapportsRoutes(app: Express) {
  const projetClient = async (req: any, res: any): Promise<number | null> => {
    const p = await perimetreDemande(req.userId, req.params.projectId);
    if (!p.ok) { res.status(p.status).json({ message: p.message }); return null; }
    return p.portee;
  };
  /** Le rapport du mois, ou null (réponse déjà envoyée). */
  const rapportDe = async (req: any, res: any, projectId: number) => {
    if (!MOIS.test(String(req.params.mois))) { res.status(404).json({ message: "not_found" }); return null; }
    const r = await storage.getRapport(req.userId, projectId, req.params.mois);
    if (!r) { res.status(404).json({ message: "not_found" }); return null; }
    return r;
  };

  app.get("/api/rapports/:projectId", isAuthenticated, async (req: any, res) => {
    try {
      const projectId = await projetClient(req, res);
      if (projectId == null) return;
      const [rapports, routine] = await Promise.all([
        storage.getRapports(req.userId, projectId),
        storage.getRoutineByCible(req.userId, KIND_RAPPORT, cleRoutine(projectId)),
      ]);
      res.json({
        rapports: rapports.map(vue),
        routine: routine ? { routine, derniersPassages: await storage.getRoutineRuns(routine.id, req.userId, 3) } : null,
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/rapports/:projectId/routine", isAuthenticated, async (req: any, res) => {
    try {
      const projectId = await projetClient(req, res);
      if (projectId == null) return;
      if (typeof req.body?.actif !== "boolean") return res.status(400).json({ message: "actif_requis" });
      const r = await storage.ensureRoutine(routineRapportPour({ userId: req.userId, projectId }, new Date(), req.body.actif) as any);
      res.json(await storage.updateRoutine(r.id, req.userId, { actif: req.body.actif }));
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // « Lancer maintenant » : le rapport du mois écoulé, même exécution que la routine.
  app.post("/api/rapports/:projectId/routine/run", isAuthenticated, async (req: any, res) => {
    try {
      const projectId = await projetClient(req, res);
      if (projectId == null) return;
      const routine = await storage.ensureRoutine(routineRapportPour({ userId: req.userId, projectId }, new Date()) as any);
      const r = await executerUne(routine, REGISTRE[KIND_RAPPORT]);
      if (r.dejaEnCours) return res.status(409).json({ message: "deja_en_cours" });
      res.json(r);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/rapports/:projectId/preparer", isAuthenticated, async (req: any, res) => {
    try {
      const projectId = await projetClient(req, res);
      if (projectId == null) return;
      if (!moisValide(req.body?.mois)) return res.status(400).json({ message: "mois_invalide" });
      const r = await preparerRapport(req.userId, projectId, req.body.mois, depsRapport);
      switch (r.statut) {
        case "ok":
          // Le premier rapport installe la routine mensuelle (une pause choisie est respectée).
          await storage.ensureRoutine(routineRapportPour({ userId: req.userId, projectId }, new Date()) as any);
          return res.json(vue(r.rapport));
        case "rien": return res.status(422).json({ message: "aucune_donnee" });
        case "deja_publie": return res.status(409).json({ message: "deja_publie" });
        case "refus": return res.status(409).json({ message: "refus", raison: r.raison.resume });
        case "illisible": return res.status(502).json({ message: "redaction_illisible" });
        default: return res.status(404).json({ message: "not_found" });
      }
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/rapports/:projectId/:mois", isAuthenticated, async (req: any, res) => {
    try {
      const projectId = await projetClient(req, res);
      if (projectId == null) return;
      const r = await rapportDe(req, res, projectId);
      if (r) res.json(vue(r));
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/rapports/:projectId/:mois", isAuthenticated, async (req: any, res) => {
    try {
      const projectId = await projetClient(req, res);
      if (projectId == null) return;
      const r = await rapportDe(req, res, projectId);
      if (!r) return;
      // Ce que le client a peut-être lu ne change pas sous ses yeux : repasser en brouillon d'abord.
      if (r.statut === "publie") return res.status(409).json({ message: "deja_publie" });
      const v = validerSections(req.body?.sections);
      if (!v.ok) return res.status(400).json({ message: "sections_invalides" });
      // Condition dans la requête : publié entre-temps (autre onglet) → rien n'est écrit.
      const maj = await storage.updateRapport(req.userId, projectId, r.mois, { sections: { ...(r.sections as any), ...v.sections } }, { siBrouillon: true });
      if (!maj) return res.status(409).json({ message: "deja_publie" });
      res.json(vue(maj));
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  const action = (chemin: string, patch: (r: any) => Record<string, unknown>) =>
    app.post(`/api/rapports/:projectId/:mois/${chemin}`, isAuthenticated, async (req: any, res) => {
      try {
        const projectId = await projetClient(req, res);
        if (projectId == null) return;
        const r = await rapportDe(req, res, projectId);
        if (!r) return;
        res.json(vue(await storage.updateRapport(req.userId, projectId, r.mois, patch(r) as any)));
      } catch (e: any) {
        res.status(500).json({ message: e.message });
      }
    });
  // Republier après une correction garde le même lien (le client n'en change pas) et la date
  // de première publication.
  action("publier", (r) => ({ statut: "publie", publieLe: r.publieLe ?? new Date(), jeton: r.jeton ?? nouveauJeton(), partageActif: true }));
  action("depublier", () => ({ statut: "brouillon", partageActif: false }));
  action("couper", () => ({ partageActif: false }));
  // Nouveau lien : l'ancien meurt ; le partage ne se rouvre pas pour autant.
  action("nouveau-lien", () => ({ jeton: nouveauJeton() }));

  app.delete("/api/rapports/:projectId/:mois", isAuthenticated, async (req: any, res) => {
    try {
      const projectId = await projetClient(req, res);
      if (projectId == null) return;
      const r = await rapportDe(req, res, projectId);
      if (!r) return;
      await storage.deleteRapport(req.userId, projectId, r.mois);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Lecture PUBLIQUE, sans compte. Jeton inconnu, lien coupé ou brouillon → la même réponse.
  app.get("/api/public/rapports/:jeton", async (req: any, res) => {
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.setHeader("Cache-Control", "no-store");
    try {
      const jeton = String(req.params.jeton);
      const r = /^[A-Za-z0-9_-]{20,100}$/.test(jeton) ? await storage.getRapportParJeton(jeton) : undefined;
      if (!r || !r.partageActif || r.statut !== "publie") return res.status(404).json({ message: "indisponible" });
      const projet: any = await storage.getProject(r.projectId, r.userId);
      // Un projet redevenu perso n'a plus de rapport client à montrer.
      if (!projet || porteeDe(projet) == null) return res.status(404).json({ message: "indisponible" });
      const prefs: any = await storage.getUserPreferences(r.userId).catch(() => null);
      res.json({
        client: projet.clientName || projet.name,
        agence: await depsRapport.nomAgence(r.userId),
        mois: r.mois,
        // La page met en forme le mois et ses libellés dans la langue du compte.
        langue: prefs?.language === "en" ? "en" : "fr",
        ...projectionPublique(r.donnees, r.sections),
        publieLe: r.publieLe,
      });
    } catch {
      res.status(404).json({ message: "indisponible" });
    }
  });
}
