// server/routes-fondations.ts — les fondations d'un projet (dossier Acquisition 360, étape 0) :
// offre d'entrée, motivations et matrice créative, arbre de KPI, plan d'acquisition ; la
// routine d'étiquetage des contenus et la couverture des angles. Toute route vérifie que le
// projet ou le contenu est à l'utilisatrice (404 sinon).
import type { Express } from "express";
import { isAuthenticated } from "./auth";
import { storage } from "./storage";
import { executerUne, REGISTRE } from "./services/routines/ordonnanceur";
import { proposerFondations } from "./services/fondations/proposer";
import { depsProposer } from "./services/fondations/deps";
import { routineEtiquetagePour } from "./services/fondations/etiquetage";
import { validerSection, statutsDe, type Motivation } from "./services/fondations/sections";
import { couverture } from "./services/fondations/couverture";
import { serieIndicateur } from "./services/mesure/calculs";
import type { Indicateur } from "./services/mesure/catalogues";
import {
  SECTIONS, BRIQUES, FORMATS_CREATIFS, ETAGES_KPI, FREQUENCES_KPI, MATURITES, STATUTS_BRIQUE,
  PLAFONDS, ANGLE_AUCUN, KIND_ETIQUETAGE, type Section,
} from "./services/fondations/catalogues";

const JOURS_COUVERTURE = 90;
const cleRoutine = (projectId: number) => `project:${projectId}`;
const idDe = (v: unknown) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

async function projetDe(req: any) {
  const id = idDe(req.params.projectId);
  return id ? (await storage.getProject(id, req.userId)) ?? null : null;
}

const CATALOGUES = {
  formats: FORMATS_CREATIFS, etages: ETAGES_KPI, frequences: FREQUENCES_KPI, maturites: MATURITES,
  statutsBrique: STATUTS_BRIQUE, briques: BRIQUES.map(({ cle, moteur, page }) => ({ cle, moteur, page: page ?? null })),
};

const motivationsDe = (f: any): Motivation[] => (Array.isArray(f?.motivations) ? f.motivations : []);

export function registerFondationsRoutes(app: Express) {
  app.get("/api/fondations/:projectId", isAuthenticated, async (req: any, res) => {
    try {
      const projet = await projetDe(req);
      if (!projet) return res.status(404).json({ message: "not_found" });
      const userId = req.userId as string;
      const f = await storage.getFondations(userId, projet.id);
      const depuis = new Date(Date.now() - JOURS_COUVERTURE * 86_400_000);
      const contenus = await storage.getContenusEtiquetes(userId, projet.id, depuis);
      const scores = await storage.getScoresReception(contenus.filter((c) => c.angle && c.angle !== ANGLE_AUCUN).map((c) => c.id));
      // Lecture seule : l'ouverture de la page ne crée aucune routine.
      const r = await storage.getRoutineByCible(userId, KIND_ETIQUETAGE, cleRoutine(projet.id));
      // KPI reliés au registre mensuel : leur série est calculée, jamais saisie.
      const relies = (Array.isArray(f?.kpis) ? (f!.kpis as Array<{ cle: string; source?: string }>) : []).filter((k) => k.source);
      const lignesMesure = relies.length ? await storage.getMesures(userId, projet.id, 24) : [];
      const kpiAuto = Object.fromEntries(relies.map((k) => [k.cle, serieIndicateur(lignesMesure, k.source as Indicateur)]));
      res.json({
        fondations: {
          offre: f?.offre ?? null, motivations: motivationsDe(f), kpis: Array.isArray(f?.kpis) ? f!.kpis : [],
          plan: f?.plan ?? null, kpiReleves: f?.kpiReleves ?? {}, statuts: statutsDe(f),
        },
        catalogues: CATALOGUES,
        kpiAuto,
        routine: r ? { routine: r, derniersPassages: await storage.getRoutineRuns(r.id, userId, 3) } : null,
        couverture: couverture(motivationsDe(f), contenus, scores),
        contenus: contenus.slice(0, 20),
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/fondations/:projectId/proposer", isAuthenticated, async (req: any, res) => {
    try {
      const projet = await projetDe(req);
      if (!projet) return res.status(404).json({ message: "not_found" });
      const demandees = req.body?.sections;
      if (demandees !== undefined && (!Array.isArray(demandees) || demandees.some((s: unknown) => !(SECTIONS as readonly unknown[]).includes(s)))) {
        return res.status(400).json({ message: "sections_invalides" });
      }
      const r = await proposerFondations(req.userId, projet.id, demandees as Section[] | undefined, depsProposer);
      if (r.statut === "introuvable") return res.status(404).json({ message: "not_found" });
      if (r.statut === "refus") return res.status(409).json({ message: "refus", raison: r.raison });
      if (r.statut === "vide") return res.status(422).json({ message: "proposition_vide" });
      if (r.statut === "rien") return res.json({ rien: true });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.put("/api/fondations/:projectId/sections/:section", isAuthenticated, async (req: any, res) => {
    try {
      const projet = await projetDe(req);
      const section = req.params.section as Section;
      if (!projet || !(SECTIONS as readonly string[]).includes(section)) return res.status(404).json({ message: "not_found" });
      const { valeur, statut } = req.body ?? {};
      if (statut !== undefined && statut !== "propose" && statut !== "valide") return res.status(400).json({ message: "statut_invalide" });
      const f = await storage.getFondations(req.userId, projet.id);
      const statuts = statutsDe(f);
      const patch: Record<string, unknown> = {};
      if (valeur !== undefined) {
        const v = validerSection(section, valeur);
        if (!v.ok) return res.status(400).json({ message: v.erreur });
        patch[section] = v.valeur;
      } else if (!(f as any)?.[section] || (Array.isArray((f as any)[section]) && !(f as any)[section].length)) {
        return res.status(400).json({ message: "section_vide" });
      }
      // Modifier garde le statut ; une section encore vide devient une proposition. Seul le
      // statut de CETTE section est envoyé (fusion clé par clé dans le stockage).
      const nouveau = statut ?? (statuts[section] === "vide" ? "propose" : statuts[section]);
      const maj = await storage.upsertFondations(req.userId, projet.id, { ...patch, statuts: { [section]: nouveau } } as any);
      if (section === "motivations" && nouveau === "valide") {
        await storage.ensureRoutine(routineEtiquetagePour({ userId: req.userId, projectId: projet.id }, new Date()) as any);
      }
      res.json({ statuts: statutsDe(maj) });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/fondations/:projectId/kpis/:cle/releves", isAuthenticated, async (req: any, res) => {
    try {
      const projet = await projetDe(req);
      if (!projet) return res.status(404).json({ message: "not_found" });
      const f = await storage.getFondations(req.userId, projet.id);
      const kpis = Array.isArray(f?.kpis) ? (f!.kpis as Array<{ cle: string; source?: string }>) : [];
      const kpi = kpis.find((k) => k.cle === req.params.cle);
      if (!kpi) return res.status(404).json({ message: "not_found" });
      if (kpi.source) return res.status(409).json({ message: "kpi_calcule" });
      const valeur = typeof req.body?.valeur === "number" ? req.body.valeur : Number.NaN;
      if (!Number.isFinite(valeur)) return res.status(400).json({ message: "valeur_invalide" });
      const brute = req.body?.date;
      const date = brute === undefined ? new Date() : typeof brute === "string" ? new Date(brute) : new Date(Number.NaN);
      // Une date future resterait affichée comme « dernière valeur » : refusée (un jour de marge pour les fuseaux).
      if (Number.isNaN(date.getTime()) || date.getTime() > Date.now() + 86_400_000) return res.status(400).json({ message: "date_invalide" });
      const tous = { ...((f?.kpiReleves as Record<string, Array<{ date: string; valeur: number }>>) || {}) };
      tous[req.params.cle] = [...(tous[req.params.cle] || []), { date: date.toISOString(), valeur }]
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(-PLAFONDS.relevesParKpi);
      await storage.upsertFondations(req.userId, projet.id, { kpiReleves: tous } as any);
      res.json({ releves: tous[req.params.cle] });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/fondations/:projectId/routine", isAuthenticated, async (req: any, res) => {
    try {
      const projet = await projetDe(req);
      if (!projet) return res.status(404).json({ message: "not_found" });
      if (typeof req.body?.actif !== "boolean") return res.status(400).json({ message: "actif_requis" });
      const r = await storage.ensureRoutine(routineEtiquetagePour({ userId: req.userId, projectId: projet.id }, new Date(), req.body.actif) as any);
      res.json(await storage.updateRoutine(r.id, req.userId, { actif: req.body.actif }));
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // « Lancer maintenant » : même exécution que l'ordonnanceur, sous le même verrou.
  app.post("/api/fondations/:projectId/routine/run", isAuthenticated, async (req: any, res) => {
    try {
      const projet = await projetDe(req);
      if (!projet) return res.status(404).json({ message: "not_found" });
      // Jamais activée : créée en pause ; lancer un passage n'active pas la routine.
      const routine = await storage.ensureRoutine(routineEtiquetagePour({ userId: req.userId, projectId: projet.id }, new Date(), false) as any);
      const r = await executerUne(routine, REGISTRE[KIND_ETIQUETAGE]);
      if (r.dejaEnCours) return res.status(409).json({ message: "deja_en_cours" });
      res.json(r);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/fondations/contenus/:id", isAuthenticated, async (req: any, res) => {
    try {
      const id = idDe(req.params.id);
      const c = id ? await storage.getContentById(id, req.userId) : undefined;
      if (!c) return res.status(404).json({ message: "not_found" });
      const f = c.projectId ? await storage.getFondations(req.userId, c.projectId) : undefined;
      const angle = req.body?.angle;
      if (angle !== ANGLE_AUCUN && !motivationsDe(f).some((m) => m.cle === angle)) return res.status(400).json({ message: "angle_invalide" });
      const format = req.body?.formatCreatif ?? null;
      if (format !== null && !(FORMATS_CREATIFS as readonly unknown[]).includes(format)) return res.status(400).json({ message: "format_invalide" });
      res.json(await storage.etiqueterContenuManuel(c.id, req.userId, { angle, formatCreatif: format }));
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });
}
