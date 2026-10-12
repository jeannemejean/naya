// server/routes-veille.ts — la veille élargie d'un projet : la liste suivie (proposée par
// Naya, validée par l'utilisatrice), les quatre routines hebdomadaires, les constats et les
// tableaux GEO et Google. Toute route vérifie que le projet, l'élément ou le constat est à elle.
import type { Express } from "express";
import { isAuthenticated } from "./auth";
import { storage } from "./storage";
import { executerUne, REGISTRE } from "./services/routines/ordonnanceur";
import { gardeDepense } from "./services/routines/garde";
import { serpConfigured } from "./services/serp";
import { callClaudeWithContext, CLAUDE_MODELS } from "./services/claude";
import { chercher } from "./services/veille/collecte";
import { moteursConfigures } from "./services/veille/moteurs-ia";
import { proposerListe } from "./services/veille/proposer";
import { routineVeillePour } from "./services/veille/executeurs";
import { validerItem, kindDuType, PLAFONDS } from "./services/veille/items";
import { normaliser } from "./services/veille/texte";
import { KINDS_VEILLE, KIND_GEO, KIND_SERP, STATUTS_CONSTAT, type KindVeille, type TypeItem } from "./services/veille/types";

const cleRoutine = (projectId: number) => `project:${projectId}`;

async function projetDe(req: any) {
  const id = Number(req.params.projectId);
  if (!Number.isInteger(id) || id <= 0) return null;
  return (await storage.getProject(id, req.userId)) ?? null;
}

/** Crée la routine du type (active) si elle n'existe pas. Une pause choisie est respectée. */
async function assurerRoutine(userId: string, projectId: number, type: string) {
  const kind = kindDuType(type);
  if (!kind) return;
  await storage.ensureRoutine(routineVeillePour(kind, { userId, projectId }, new Date()) as any);
}

const suivisDe = (items: any[], type: string) => items.filter((i) => i.type === type && i.statut === "suivi");

/** Identifiant de ressource : entier positif, sinon null (→ 404, jamais une erreur SQL). */
const idDe = (v: unknown) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

export function registerVeilleRoutes(app: Express) {
  app.get("/api/veille/:projectId", isAuthenticated, async (req: any, res) => {
    try {
      const projet = await projetDe(req);
      if (!projet) return res.status(404).json({ message: "not_found" });
      const userId = req.userId as string;
      const [items, constats, geo, serp] = await Promise.all([
        storage.getVeilleItems(userId, projet.id),
        storage.getVeilleConstats(userId, projet.id, { limite: 40, statuts: ["nouveau", "vu"] }),
        storage.getDerniersReleves(userId, projet.id, KIND_GEO),
        storage.getDerniersReleves(userId, projet.id, KIND_SERP),
      ]);
      // Lecture seule : l'ouverture de la page ne crée aucune routine (aucune dépense possible).
      const routines: Record<string, unknown> = {};
      for (const kind of KINDS_VEILLE) {
        const r = await storage.getRoutineByCible(userId, kind, cleRoutine(projet.id));
        routines[kind] = r ? { routine: r, derniersPassages: await storage.getRoutineRuns(r.id, userId, 3) } : null;
      }
      res.json({
        items, constats, routines,
        tableaux: {
          geo: geo.map((r: any) => {
            const [, moteur, itemId] = String(r.cle).split(":");
            const a = r.donnees?.analyse || {};
            return { itemId: Number(itemId), moteur, citee: !!a.citee, position: a.position ?? null, concurrentsCites: a.concurrentsCites || [], date: r.createdAt };
          }),
          serp: serp.map((r: any) => ({
            itemId: Number(String(r.cle).split(":")[1]), position: r.donnees?.positions?.marque ?? null, date: r.createdAt,
          })),
        },
        fournisseurs: { recherche: serpConfigured(), ia: moteursConfigures() },
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/veille/:projectId/proposer", isAuthenticated, async (req: any, res) => {
    try {
      const projet = await projetDe(req);
      if (!projet) return res.status(404).json({ message: "not_found" });
      const r = await proposerListe(req.userId, projet.id, {
        storage: storage as any,
        garde: gardeDepense,
        serpConfigure: serpConfigured,
        chercher,
        ia: (userId, projectId, prompt) => callClaudeWithContext({
          userId, projectId, userMessage: prompt, model: CLAUDE_MODELS.smart, max_tokens: 1500,
        }),
      });
      if (r.statut === "introuvable") return res.status(404).json({ message: "not_found" });
      if (r.statut === "refus") return res.status(409).json({ message: "refus", raison: r.raison });
      if (r.statut === "vide") return res.status(422).json({ message: "proposition_vide" });
      res.json({ crees: r.crees });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/veille/:projectId/items", isAuthenticated, async (req: any, res) => {
    try {
      const projet = await projetDe(req);
      if (!projet) return res.status(404).json({ message: "not_found" });
      const v = validerItem(req.body);
      if (!v.ok) return res.status(400).json({ message: v.erreur });
      const { type, libelle, valeur } = v.valeur as { type: TypeItem; libelle: string; valeur?: Record<string, unknown> };
      const existants = await storage.getVeilleItems(req.userId, projet.id);
      // Le plafond porte sur ce qui est suivi : des propositions en attente ne bloquent pas un ajout.
      if (suivisDe(existants, type).length >= PLAFONDS[type]) return res.status(409).json({ message: "plafond" });
      const doublon = existants.find((e) => e.type === type && normaliser(e.libelle) === normaliser(libelle));
      if (doublon && doublon.statut !== "ecarte" && doublon.statut !== "propose") return res.status(409).json({ message: "deja_present" });
      if (doublon) {
        // Écarté ou proposé : on le reprend, avec ce qui vient d'être saisi (un site, par exemple).
        const repris = await storage.updateVeilleItem(doublon.id, req.userId, { libelle, statut: "suivi", ...(valeur ? { valeur } : {}) } as any);
        await assurerRoutine(req.userId, projet.id, type);
        return res.json(repris);
      }
      // Ajouté à la main = choisi : suivi d'emblée.
      const [cree] = await storage.createVeilleItems([{
        userId: req.userId, projectId: projet.id, type, libelle, valeur: valeur ?? null, statut: "suivi", source: "manuel",
      }]);
      await assurerRoutine(req.userId, projet.id, type);
      res.status(201).json(cree);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/veille/items/:id", isAuthenticated, async (req: any, res) => {
    try {
      const id = idDe(req.params.id);
      const item = id ? await storage.getVeilleItem(id, req.userId) : undefined;
      if (!item) return res.status(404).json({ message: "not_found" });
      const v = validerItem(req.body, { partiel: true });
      if (!v.ok) return res.status(400).json({ message: v.erreur });
      if (v.valeur.statut === "suivi" && item.statut !== "suivi") {
        const suivisDuType = (await storage.getVeilleItems(req.userId, item.projectId))
          .filter((i) => i.type === item.type && i.statut === "suivi" && i.id !== item.id);
        if (suivisDuType.length >= PLAFONDS[item.type as TypeItem]) return res.status(409).json({ message: "plafond" });
      }
      const maj = await storage.updateVeilleItem(item.id, req.userId, v.valeur as any);
      if (maj?.statut === "suivi") await assurerRoutine(req.userId, item.projectId, item.type);
      res.json(maj);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/veille/items/:id", isAuthenticated, async (req: any, res) => {
    try {
      const id = idDe(req.params.id);
      const ok = id ? await storage.deleteVeilleItem(id, req.userId) : false;
      if (!ok) return res.status(404).json({ message: "not_found" });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  const kindDe = (req: any): KindVeille | null =>
    (KINDS_VEILLE as readonly string[]).includes(req.params.kind) ? (req.params.kind as KindVeille) : null;

  app.patch("/api/veille/:projectId/routines/:kind", isAuthenticated, async (req: any, res) => {
    try {
      const projet = await projetDe(req);
      const kind = kindDe(req);
      if (!projet || !kind) return res.status(404).json({ message: "not_found" });
      if (typeof req.body?.actif !== "boolean") return res.status(400).json({ message: "actif_requis" });
      const r = await storage.ensureRoutine(routineVeillePour(kind, { userId: req.userId, projectId: projet.id }, new Date(), req.body.actif) as any);
      res.json(await storage.updateRoutine(r.id, req.userId, { actif: req.body.actif }));
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // « Lancer maintenant » : même exécution que l'ordonnanceur, sous le même verrou.
  app.post("/api/veille/:projectId/routines/:kind/run", isAuthenticated, async (req: any, res) => {
    try {
      const projet = await projetDe(req);
      const kind = kindDe(req);
      if (!projet || !kind) return res.status(404).json({ message: "not_found" });
      // Une veille jamais activée est créée en pause : lancer un passage n'active pas la routine.
      const routine = await storage.ensureRoutine(routineVeillePour(kind, { userId: req.userId, projectId: projet.id }, new Date(), false) as any);
      const r = await executerUne(routine, REGISTRE[kind]);
      if (r.dejaEnCours) return res.status(409).json({ message: "deja_en_cours" });
      res.json(r);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/veille/constats/:id", isAuthenticated, async (req: any, res) => {
    try {
      const id = idDe(req.params.id);
      if (!id) return res.status(404).json({ message: "not_found" });
      if (!(STATUTS_CONSTAT as readonly string[]).includes(req.body?.statut)) return res.status(400).json({ message: "statut_invalide" });
      const c = await storage.updateVeilleConstat(id, req.userId, { statut: req.body.statut });
      if (!c) return res.status(404).json({ message: "not_found" });
      res.json(c);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });
}
