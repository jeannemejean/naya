// server/routes-mesure.ts — le registre mensuel d'un projet (dossier Acquisition 360, mesure) :
// saisie, import, indicateurs calculés (MER, CAC…), bilan mensuel en routine. Toute route
// vérifie que le projet est à l'utilisatrice (404 sinon).
import type { Express } from "express";
import { isAuthenticated } from "./auth";
import { storage } from "./storage";
import { executerUne, REGISTRE } from "./services/routines/ordonnanceur";
import { CANAUX, INDICATEURS, KIND_BILAN } from "./services/mesure/catalogues";
import { indicateurs, evolutions } from "./services/mesure/calculs";
import { validerMois, moisValide, suggestionDepuisConversions } from "./services/mesure/saisie";
import { lireImport } from "./services/mesure/import";
import { routineBilanPour } from "./services/mesure/bilan";

const MAX_IMPORT = 200_000;
const cleRoutine = (projectId: number) => `project:${projectId}`;

async function projetDe(req: any) {
  const id = Number(req.params.projectId);
  if (!Number.isInteger(id) || id <= 0) return null;
  return (await storage.getProject(id, req.userId)) ?? null;
}

const assurerRoutine = (userId: string, projectId: number) =>
  storage.ensureRoutine(routineBilanPour({ userId, projectId }, new Date()) as any);

export function registerMesureRoutes(app: Express) {
  app.get("/api/mesure/:projectId", isAuthenticated, async (req: any, res) => {
    try {
      const projet = await projetDe(req);
      if (!projet) return res.status(404).json({ message: "not_found" });
      const lignes = await storage.getMesures(req.userId, projet.id, 24);
      const parInd = Object.fromEntries(INDICATEURS.map((ind) => [ind, lignes.map((l) => ({ mois: l.mois, valeur: indicateurs(l)[ind] }))]));
      // Lecture seule : l'ouverture de la page ne crée aucune routine.
      const r = await storage.getRoutineByCible(req.userId, KIND_BILAN, cleRoutine(projet.id));
      res.json({
        mois: lignes.map((l) => ({
          ...l, indicateurs: indicateurs(l),
          evolutions: Object.fromEntries(INDICATEURS.map((ind) => [ind, evolutions(parInd[ind], l.mois)])),
        })),
        catalogues: { canaux: CANAUX.map(({ cle, acquisition }) => ({ cle, acquisition })), indicateurs: INDICATEURS },
        routine: r ? { routine: r, derniersPassages: await storage.getRoutineRuns(r.id, req.userId, 3) } : null,
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/mesure/:projectId/suggestion", isAuthenticated, async (req: any, res) => {
    try {
      const projet = await projetDe(req);
      if (!projet) return res.status(404).json({ message: "not_found" });
      if (!moisValide(req.query.mois)) return res.status(400).json({ message: "mois_invalide" });
      const conversions = await storage.getBrandConversionsWithCredits(projet.id);
      res.json({ suggestion: suggestionDepuisConversions(conversions as any, req.query.mois as string) });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.put("/api/mesure/:projectId/mois/:mois", isAuthenticated, async (req: any, res) => {
    try {
      const projet = await projetDe(req);
      if (!projet) return res.status(404).json({ message: "not_found" });
      if (!moisValide(req.params.mois)) return res.status(400).json({ message: "mois_invalide" });
      const v = validerMois(req.body);
      if (!v.ok) return res.status(400).json({ message: v.erreur });
      const ligne = await storage.upsertMesure(req.userId, projet.id, req.params.mois, { ...v.valeur, source: "manuel" });
      await assurerRoutine(req.userId, projet.id);
      res.json(ligne);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/mesure/:projectId/mois/:mois", isAuthenticated, async (req: any, res) => {
    try {
      const projet = await projetDe(req);
      if (!projet) return res.status(404).json({ message: "not_found" });
      const ok = /^\d{4}-\d{2}$/.test(req.params.mois) && (await storage.deleteMesure(req.userId, projet.id, req.params.mois));
      if (!ok) return res.status(404).json({ message: "not_found" });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Sans `confirmer` : aperçu (rien n'est écrit). Avec : les lignes valides remplacent leurs mois.
  app.post("/api/mesure/:projectId/import", isAuthenticated, async (req: any, res) => {
    try {
      const projet = await projetDe(req);
      if (!projet) return res.status(404).json({ message: "not_found" });
      const texte = req.body?.texte;
      if (typeof texte !== "string" || texte.length > MAX_IMPORT) return res.status(400).json({ message: "texte_invalide" });
      const r = lireImport(texte);
      if (req.body?.confirmer !== true) return res.json(r);
      if (!r.lignes.length) return res.status(400).json({ message: "aucune_ligne", erreurs: r.erreurs });
      for (const l of r.lignes) await storage.upsertMesure(req.userId, projet.id, l.mois, { ...l.valeur, source: "import" });
      await assurerRoutine(req.userId, projet.id);
      res.json({ ecrits: r.lignes.length, erreurs: r.erreurs });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/mesure/:projectId/routine", isAuthenticated, async (req: any, res) => {
    try {
      const projet = await projetDe(req);
      if (!projet) return res.status(404).json({ message: "not_found" });
      if (typeof req.body?.actif !== "boolean") return res.status(400).json({ message: "actif_requis" });
      const r = await storage.ensureRoutine(routineBilanPour({ userId: req.userId, projectId: projet.id }, new Date(), req.body.actif) as any);
      res.json(await storage.updateRoutine(r.id, req.userId, { actif: req.body.actif }));
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/mesure/:projectId/routine/run", isAuthenticated, async (req: any, res) => {
    try {
      const projet = await projetDe(req);
      if (!projet) return res.status(404).json({ message: "not_found" });
      const routine = await storage.ensureRoutine(routineBilanPour({ userId: req.userId, projectId: projet.id }, new Date(), false) as any);
      const r = await executerUne(routine, REGISTRE[KIND_BILAN]);
      if (r.dejaEnCours) return res.status(409).json({ message: "deja_en_cours" });
      res.json(r);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });
}
