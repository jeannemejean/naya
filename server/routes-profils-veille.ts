// server/routes-profils-veille.ts — profils de veille : administration (rôle owner) et
// « Ce qui marche dans ton secteur » côté utilisatrice. Toute route utilisatrice vérifie que
// le projet ou la tendance est à elle (404 sinon, jamais une erreur SQL).
import type { Express } from "express";
import { isAuthenticated } from "./auth";
import { storage } from "./storage";
import { stockageProfils as s } from "./services/profils-veille/stockage";
import { estOuvertPour, depsCollecte, depsAnalyse } from "./services/profils-veille/deps";
import { collecterProfil } from "./services/profils-veille/collecte";
import { lancerAnalyse } from "./services/profils-veille/analyse";
import { placerTachesProductionPosts } from "./services/campagne/placement";
import {
  REGLES, STRUCTURES, ACCROCHES, normaliserCompteInstagram, creneauTendance, moisDe, semaineDe,
  semaineAnalysee, tendanceVisible, libelleFormat, type TypeMedia, type Structure,
} from "@shared/profils-veille";

const idDe = (v: unknown) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const STATUTS_PROFIL = ["propose", "actif", "en_pause", "archive"];
const STATUTS_COMPTE = ["propose", "suivi", "ecarte"];
const STATUTS_TENDANCE_UTILISATRICE = ["vu", "garde", "ecarte"];
/** content.postFormat attendu par l'atelier pour chaque type de média. */
const FORMAT_POST: Record<TypeMedia, string> = { image: "feed_image", carrousel: "carousel", reel: "reel", video: "feed_video", texte: "text", document: "carousel" };
const TYPE_CONTENU: Record<TypeMedia, string> = { image: "image", carrousel: "carousel", reel: "video", video: "video", texte: "text", document: "carousel" };

async function estOwner(req: any) { return (await storage.getUser(req.userId))?.role === "owner"; }

function compteDe(plateforme: unknown, saisie: unknown) {
  if (plateforme !== "instagram" || typeof saisie !== "string") return null; // lots 2 et 3 : tiktok, linkedin
  return normaliserCompteInstagram(saisie);
}

export function registerProfilsVeilleRoutes(app: Express) {
  // Express 4 n'achemine pas un rejet async : sans ce garde-fou la requête pend.
  const sur = (h: (req: any, res: any) => Promise<any>) => async (req: any, res: any) => {
    try { await h(req, res); } catch (e: any) { console.error("[ProfilsVeille] route :", e?.message); if (!res.headersSent) res.status(500).json({ message: "profils_veille_failed" }); }
  };
  // ─── Utilisatrice ────────────────────────────────────────────────────────────
  app.get("/api/profils-veille/projet/:projectId", isAuthenticated, async (req: any, res) => {
    try {
      const pid = idDe(req.params.projectId);
      const projet = pid ? await storage.getProject(pid, req.userId) : undefined;
      if (!projet) return res.status(404).json({ message: "not_found" });
      const [rattachement, catalogue, tendances, ouvert] = await Promise.all([
        s.rattachementDuProjet(req.userId, projet.id), s.catalogueActif(), s.tendancesDuProjet(req.userId, projet.id), estOuvertPour(req.userId),
      ]);
      const maintenant = new Date();
      res.json({
        ouvert,
        rattachement: rattachement ?? null,
        catalogue: catalogue.map((c: any) => ({ id: c.id, nom: c.nom, description: c.description })),
        tendances: ouvert ? tendances.filter((t: any) => tendanceVisible(t, maintenant)).map((t: any) => ({ ...t, libelle: libelleFormat(t.typeMedia as TypeMedia, t.structure as Structure) })) : [],
      });
    } catch (e: any) {
      console.error("[ProfilsVeille] lecture projet :", e?.message);
      res.status(500).json({ message: "profils_veille_read_failed" });
    }
  });

  app.post("/api/profils-veille/projet/:projectId/profil", isAuthenticated, sur(async (req: any, res) => {
    const pid = idDe(req.params.projectId);
    const projet = pid ? await storage.getProject(pid, req.userId) : undefined;
    if (!projet) return res.status(404).json({ message: "not_found" });
    const profilId = idDe(req.body?.profilId);
    if (!profilId || !(await s.catalogueActif()).some((c: any) => c.id === profilId)) return res.status(400).json({ message: "profil_invalide" });
    await s.choisirProfil(req.userId, projet.id, profilId);
    res.json({ ok: true });
  }));

  app.post("/api/profils-veille/projet/:projectId/refuser", isAuthenticated, sur(async (req: any, res) => {
    const pid = idDe(req.params.projectId);
    const projet = pid ? await storage.getProject(pid, req.userId) : undefined;
    if (!projet) return res.status(404).json({ message: "not_found" });
    await s.refuserRattachement(req.userId, projet.id);
    res.json({ ok: true });
  }));

  app.post("/api/profils-veille/projet/:projectId/suggestion", isAuthenticated, sur(async (req: any, res) => {
    const pid = idDe(req.params.projectId);
    const projet = pid ? await storage.getProject(pid, req.userId) : undefined;
    if (!projet) return res.status(404).json({ message: "not_found" });
    const r = await s.rattachementDuProjet(req.userId, projet.id);
    if (!r) return res.status(409).json({ message: "sans_profil" });
    const c = compteDe(req.body?.plateforme, req.body?.saisie);
    if (!c) return res.status(400).json({ message: "compte_invalide" });
    const cree = await s.ajouterCompte({ profilId: r.profilId, plateforme: req.body.plateforme, compte: c.compte, url: c.url, origine: "suggestion", suggerePar: req.userId, statut: "propose" });
    res.status(201).json({ compte: cree });
  }));

  app.patch("/api/profils-veille/tendances/:id", isAuthenticated, sur(async (req: any, res) => {
    const id = idDe(req.params.id);
    const t = id ? await s.tendanceProjet(req.userId, id) : undefined;
    if (!t) return res.status(404).json({ message: "not_found" });
    if (t.statut === "utilise") return res.status(409).json({ message: "deja_utilise" });
    const statut = req.body?.statut;
    if (!STATUTS_TENDANCE_UTILISATRICE.includes(statut)) return res.status(400).json({ message: "statut_invalide" });
    await s.majTendanceProjet(t.id, statut === "ecarte" ? { statut, ecarteLe: new Date() } : { statut });
    res.json({ ok: true });
  }));

  app.post("/api/profils-veille/tendances/:id/post", isAuthenticated, async (req: any, res) => {
    try {
      const id = idDe(req.params.id);
      const t = id ? await s.tendanceProjet(req.userId, id) : undefined;
      if (!t) return res.status(404).json({ message: "not_found" });
      // Double clic : la tendance a déjà son post. `semaine` n'est pas recalculée (inconnue ici), on l'omet.
      if (t.statut === "utilise" || t.contentId) return res.status(200).json({ contentId: t.contentId ?? null, deja: true });
      const typeMedia = t.typeMedia as TypeMedia;
      const libelle = libelleFormat(typeMedia, t.structure as Structure);
      const cree = await storage.createContent({
        userId: req.userId, projectId: t.projectId, title: libelle, platform: t.plateforme,
        // La consigne de rédaction : l'atelier la lit dans `body` tant que le post est « à rédiger ».
        body: `Format : ${libelle} (ce qui marche en ce moment dans ton secteur). ${t.adaptation}`,
        contentType: TYPE_CONTENU[typeMedia], postFormat: FORMAT_POST[typeMedia], pillar: "tendance", goal: "visibility",
        contentStatus: "idea", autoPost: false, scheduledFor: creneauTendance(new Date()),
        tendanceId: t.tendanceId, tendanceProjetId: t.id,
      } as any);
      await placerTachesProductionPosts(storage as any, { userId: req.userId, posts: [cree as any] })
        .catch((e: any) => console.error("[ProfilsVeille] atelier du post :", e?.message ?? e));
      await s.majTendanceProjet(t.id, { statut: "utilise", contentId: cree.id });
      res.status(201).json({ contentId: cree.id, semaine: semaineDe(new Date(cree.scheduledFor as any)) });
    } catch (e: any) {
      console.error("[ProfilsVeille] en faire un post :", e?.message);
      res.status(500).json({ message: "post_failed" });
    }
  });

  // ─── Administration (owner) ──────────────────────────────────────────────────
  const admin = (h: (req: any, res: any) => Promise<any>) => async (req: any, res: any) => {
    if (!(await estOwner(req))) return res.status(403).json({ message: "forbidden" });
    try { await h(req, res); } catch (e: any) { console.error("[ProfilsVeille] admin :", e?.message); res.status(500).json({ message: "admin_failed" }); }
  };

  app.get("/api/admin/profils-veille", isAuthenticated, admin(async (_req, res) => {
    res.json({ profils: await s.listeAdmin(moisDe(new Date())), plafond: REGLES.plafondEurParMois });
  }));

  app.post("/api/admin/profils-veille", isAuthenticated, admin(async (req, res) => {
    const nom = typeof req.body?.nom === "string" ? req.body.nom.trim().slice(0, 80) : "";
    if (nom.length < 2) return res.status(400).json({ message: "nom_requis" });
    const description = typeof req.body?.description === "string" ? req.body.description.trim().slice(0, 400) : "";
    res.status(201).json({ profil: await s.creerProfil({ nom, description, criteres: req.body?.criteres ?? {} }) });
  }));

  app.patch("/api/admin/profils-veille/:id", isAuthenticated, admin(async (req, res) => {
    const id = idDe(req.params.id);
    const patch: Record<string, unknown> = {};
    if (req.body?.statut !== undefined) { if (!STATUTS_PROFIL.includes(req.body.statut)) return res.status(400).json({ message: "statut_invalide" }); patch.statut = req.body.statut; }
    if (typeof req.body?.nom === "string" && req.body.nom.trim().length >= 2) patch.nom = req.body.nom.trim().slice(0, 80);
    if (typeof req.body?.description === "string") patch.description = req.body.description.trim().slice(0, 400);
    if (req.body?.criteres && typeof req.body.criteres === "object") patch.criteres = req.body.criteres;
    const p = id ? await s.majProfil(id, patch) : undefined;
    if (!p) return res.status(404).json({ message: "not_found" });
    res.json({ profil: p });
  }));

  app.post("/api/admin/profils-veille/:id/comptes", isAuthenticated, admin(async (req, res) => {
    const id = idDe(req.params.id);
    const c = compteDe(req.body?.plateforme, req.body?.saisie);
    if (!id || !c) return res.status(400).json({ message: "compte_invalide" });
    const statut = req.body?.statut === "suivi" ? "suivi" : "propose";
    if (statut === "suivi") {
      if ((await s.nbSuivis(id, req.body.plateforme)) >= REGLES.comptesMaxParPlateforme) return res.status(409).json({ message: "plafond_comptes" });
    }
    res.status(201).json({ compte: await s.ajouterCompte({ profilId: id, plateforme: req.body.plateforme, compte: c.compte, url: c.url, origine: "jeanne", statut }) });
  }));

  app.patch("/api/admin/profils-veille/comptes/:id", isAuthenticated, admin(async (req, res) => {
    const id = idDe(req.params.id);
    if (!id || !STATUTS_COMPTE.includes(req.body?.statut)) return res.status(400).json({ message: "statut_invalide" });
    const existant = await s.compte(id);
    if (!existant) return res.status(404).json({ message: "not_found" });
    if (req.body.statut === "suivi" && existant.statut !== "suivi" && (await s.nbSuivis(existant.profilId, existant.plateforme)) >= REGLES.comptesMaxParPlateforme) return res.status(409).json({ message: "plafond_comptes" });
    const c = await s.majCompteAdmin(id, { statut: req.body.statut });
    if (!c) return res.status(404).json({ message: "not_found" });
    res.json({ compte: c });
  }));

  app.get("/api/admin/profils-veille/:id/tendances", isAuthenticated, admin(async (req, res) => {
    const id = idDe(req.params.id);
    const semaine = typeof req.query.semaine === "string" ? req.query.semaine : semaineDe(new Date());
    res.json({ semaine, tendances: id ? await s.tendancesAdmin(id, semaine) : [] });
  }));

  app.patch("/api/admin/profils-veille/tendances/:id", isAuthenticated, admin(async (req, res) => {
    const id = idDe(req.params.id);
    const t = id ? await s.majTendanceAdmin(id, req.body?.ecarteParJeanne === true) : undefined;
    if (!t) return res.status(404).json({ message: "not_found" });
    res.json({ tendance: t });
  }));

  app.post("/api/admin/profils-veille/:id/lancer", isAuthenticated, admin(async (req, res) => {
    const id = idDe(req.params.id);
    const p = id ? await s.profil(id) : undefined;
    if (!p) return res.status(404).json({ message: "not_found" });
    const maintenant = new Date();
    if (req.body?.etape === "collecte") return res.json({ resultat: await collecterProfil(depsCollecte, p.id, "instagram", maintenant) });
    if (req.body?.etape === "analyse") return res.json({ resultat: await lancerAnalyse(depsAnalyse, p, semaineAnalysee(maintenant), maintenant) });
    res.status(400).json({ message: "etape_invalide" });
  }));

  app.get("/api/admin/profils-veille/etiquetage", isAuthenticated, admin(async (_req, res) => {
    res.json({ posts: await s.aEtiqueter(), structures: STRUCTURES, accroches: ACCROCHES });
  }));

  app.post("/api/admin/profils-veille/etiquettes", isAuthenticated, admin(async (req, res) => {
    const postId = idDe(req.body?.postId);
    if (!postId || !(STRUCTURES as readonly string[]).includes(req.body?.structure) || !(ACCROCHES as readonly string[]).includes(req.body?.accroche)) return res.status(400).json({ message: "etiquette_invalide" });
    await s.etiqueter(postId, req.body.structure, req.body.accroche);
    res.json({ ok: true });
  }));
}
