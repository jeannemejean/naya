// server/routes-salves.ts — salves de prospection : lancer, suivre, arrêter. La règle vit dans
// services/prospection-salves.ts. Chaque route vérifie que la campagne ou la salve est à
// l'utilisatrice (404 sinon).
import type { Express } from "express";
import { isAuthenticated } from "./auth";
import { storage } from "./storage";
import { estLeadTest } from "./services/prospection-mode-test";
import { memeEntreprise } from "./services/prospection-entreprises";
import { hhmmToMin, localNow } from "./services/prospection-sender";
import {
  bilanDeSalve, choisirProspects, lancerSalve, lireIdsDeSalve, planifierSalve,
  RAISON_SALVE_ARRETEE, SALVE_NOMBRE_MAX, SALVE_PAR_JOUR_MAX,
} from "./services/prospection-salves";

const entierEntre = (v: unknown, min: number, max: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

export function registerSalvesRoutes(app: Express) {
  // Express 4 n'achemine pas un rejet async : sans ce garde-fou la requête pend.
  const sur = (h: (req: any, res: any) => Promise<any>) => async (req: any, res: any) => {
    try { await h(req, res); } catch (e: any) { console.error("[Salves] route :", e?.message); if (!res.headersSent) res.status(500).json({ message: "salves_failed" }); }
  };

  const campagneDe = async (req: any) => {
    const campagne = await storage.getProspectionCampaign(Number(req.params.id));
    return campagne?.userId === req.userId ? campagne : null;
  };

  app.get("/api/prospection/campaigns/:id/salves", isAuthenticated, sur(async (req, res) => {
    const campagne = await campagneDe(req);
    if (!campagne) return res.status(404).json({ message: "not_found" });
    const salves = await storage.salvesDeCampagne(campagne.id, req.userId);
    res.json(salves.map(({ salve, etats }) => ({ ...salve, ...bilanDeSalve(etats) })));
  }));

  // Le seul endroit où une salve s'ouvre : le clic de l'utilisatrice. Rien ne l'appelle tout seul.
  app.post("/api/prospection/campaigns/:id/salves", isAuthenticated, sur(async (req, res) => {
    const campagne = await campagneDe(req);
    if (!campagne) return res.status(404).json({ message: "not_found" });
    const nombre = entierEntre(req.body?.nombre, 1, SALVE_NOMBRE_MAX);
    const parJour = entierEntre(req.body?.parJour, 1, SALVE_PAR_JOUR_MAX);
    // Facultatif : la sélection « Ajouter à la séquence » au-delà de ENROLEMENT_DIRECT_MAX.
    const ids = lireIdsDeSalve(req.body?.leadIds);
    if (!nombre || !parJour || ids === null) return res.status(400).json({ message: "salve_invalide" });
    if (campagne.status !== "active") return res.status(409).json({ message: "campagne_inactive" });
    if ((await storage.getSequenceSteps(campagne.id)).length === 0) return res.status(400).json({ message: "no_sequence_defined" });

    const leads = (await storage.getLeads(req.userId)).filter((l) => l.prospectionCampaignId === campagne.id);
    const ontRepondu = await storage.prospectsAyantRepondu(req.userId, campagne.projectId ?? null);
    const prospects = await choisirProspects({
      leads, nombre, ids,
      getState: (id) => storage.getLeadSequenceState(id),
      exclure: (l) => estLeadTest(l) || ontRepondu.some((r) => memeEntreprise(l, r)),
    });

    // Mêmes heures et mêmes jours que le robot d'envoi.
    const prefs = await storage.getUserPreferences(req.userId);
    const { nowMin, dayAbbr } = localNow(prefs?.timezone || "UTC");
    const plan = planifierSalve({
      nombre: prospects.length, parJour, maintenant: new Date(), nowMin, jour: dayAbbr,
      debutMin: hhmmToMin(prefs?.workDayStart, 9 * 60),
      finMin: hhmmToMin(prefs?.workDayEnd, 18 * 60),
      joursOuvres: new Set((prefs?.workDays || "mon,tue,wed,thu,fri").split(",").map((d) => d.trim().toLowerCase())),
    });

    const r = await lancerSalve({
      prospects, plan,
      creer: () => storage.creerSalve(req.userId, campagne.id, parJour),
      enroll: (leadId, opts) => storage.enrollLead(leadId, campagne.id, req.userId, opts),
      supprimer: (id) => storage.supprimerSalve(id, req.userId),
    });
    // Moins que demandé : collègue d'un prospect qui a répondu, ou plus prêt entre-temps.
    res.json({ ...r, demandes: nombre, ecartes: Math.max(0, nombre - r.programmes) });
  }));

  // Arrêter = mettre en pause, raison visible. Ce qui est déjà parti reste parti.
  app.post("/api/prospection/salves/:id/arreter", isAuthenticated, sur(async (req, res) => {
    const leadIds = await storage.sequencesEnCoursDeSalve(Number(req.params.id), req.userId);
    for (const leadId of leadIds) await storage.suspendreSequence(leadId, RAISON_SALVE_ARRETEE);
    res.json({ arretes: leadIds.length });
  }));
}
