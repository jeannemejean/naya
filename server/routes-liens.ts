// server/routes-liens.ts — Liens courts avec UTM et SmartLinks (lot 5, inspiré de Metricool).
//
// Deux familles de routes :
//  - PUBLIQUES (sans compte) : GET /l/:code (redirection 302, clic compté) et GET /b/:slug (page
//    « lien en bio »). Montées par registerLiensPublics AVANT l'authentification, le gate
//    d'abonnement (qui ne regarde de toute façon que /api/) et le fourre-tout du SPA.
//  - AUTHENTIFIÉES : /api/liens et /api/smartlinks. Tout passe par req.userId ; la marque d'un
//    autre compte est introuvable (404).
//
// Aucune donnée personnelle des visiteurs : ni IP, ni user-agent écrits. Un HEAD, un
// préchargement ou un robot évident est redirigé sans être compté.
import type { Express, Response } from "express";
import { isAuthenticated } from "./auth";
import { depsLiens, type DepsLiens, type PublicationTuile } from "./services/liens/deps";
import { CSP_PAGE, pageIntrouvable, rendrePageSmartlink } from "./services/liens/page-smartlink";
import { urlDeBase } from "./services/url-publique";
import { parisTodayString } from "./utils/timezone";
import {
  CODE_RE, codeDepuisOctets, doitCompter, estUrlSure, fusionnerUtm, lienRepris, LIENS_PAR_JOUR, lireSmartlink,
  lireUtm, SLUG_RE, TUILES_MAX, type BoutonSmartlink, type LienTuile, type Utm,
} from "@shared/liens";

const JOUR_MS = 86_400_000;

function idPositif(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** ?projectId= absent ou vide → null (marque des Réglages) ; illisible → "invalide". */
function projetDeRequete(v: unknown): number | null | "invalide" {
  if (v === undefined || v === null || v === "" || v === "null") return null;
  return idPositif(v) ?? "invalide";
}

async function marqueAElle(deps: DepsLiens, userId: string, projectId: number | null): Promise<boolean> {
  return projectId == null || !!(await deps.projet(projectId, userId));
}

function nouvelIdBouton(deps: DepsLiens): string {
  return Array.from(deps.octets(6)).map((o) => o.toString(36).padStart(2, "0")).join("").slice(0, 10);
}

class LimiteAtteinte extends Error {}

/** Un lien court neuf ; un nouveau code est tiré si le premier existe déjà (5 essais). */
async function creerLienCourt(
  deps: DepsLiens,
  v: { userId: string; projectId: number | null; urlCible: string; utm: Utm; origine: "composeur" | "smartlink" },
) {
  for (let essai = 0; essai < 5; essai++) {
    const code = codeDepuisOctets(deps.octets(16));
    if (!code) continue;
    try {
      return await deps.creerLien({ ...v, code, utm: v.utm as Record<string, string> });
    } catch (e: any) {
      if (e?.code !== "23505") throw e;
    }
  }
  throw new Error("code_introuvable");
}

async function verifierQuota(deps: DepsLiens, userId: string, besoin: number): Promise<void> {
  if (besoin <= 0) return;
  const n = await deps.compterLiensDepuis(userId, new Date(deps.maintenant().getTime() - JOUR_MS));
  if (n + besoin > LIENS_PAR_JOUR) throw new LimiteAtteinte();
}

/** L'image https d'une publication pour la grille (vignette, image, couverture). */
export function imageDePublication(
  p: PublicationTuile,
  medias: Map<number, { url: string; thumbnailUrl: string | null; mimeType: string }>,
): string | null {
  const ids = Array.isArray(p.mediaIds) ? (p.mediaIds as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
  const m = ids.length ? medias.get(ids[0]) : undefined;
  const candidats = m
    ? [m.thumbnailUrl, String(m.mimeType ?? "").startsWith("image/") ? m.url : null, p.couvertureUrl]
    : [p.couvertureUrl, p.mediaUrl];
  return candidats.find((u): u is string => !!u && estUrlSure(u, true)) ?? null;
}

async function publicationsAvecImage(deps: DepsLiens, userId: string, projectId: number | null, limite: number) {
  const posts = await deps.publications(userId, projectId, limite);
  const ids = Array.from(new Set(posts.flatMap((p) => {
    const n = Number(Array.isArray(p.mediaIds) ? (p.mediaIds as unknown[])[0] : NaN);
    return Number.isInteger(n) && n > 0 ? [n] : [];
  })));
  const medias = new Map((await deps.medias(userId, ids)).map((m) => [m.id, m]));
  return posts.flatMap((p) => {
    const imageUrl = imageDePublication(p, medias);
    return imageUrl ? [{ id: p.id, imageUrl, publishedAt: p.publishedAt }] : [];
  });
}

function envoyerHtml(res: Response, statut: number, html: string, cache: string) {
  res.status(statut)
    .set({
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": CSP_PAGE,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Cache-Control": cache,
    })
    .send(html);
}

// ── Routes publiques ─────────────────────────────────────────────────────────────────

export function registerLiensPublics(app: Express, deps: DepsLiens = depsLiens): void {
  app.get("/l/:code", async (req, res) => {
    try {
      const code = String(req.params.code ?? "");
      const lien = CODE_RE.test(code) ? await deps.lienParCode(code) : undefined;
      if (!lien || !estUrlSure(lien.urlCible)) return envoyerHtml(res, 404, pageIntrouvable(), "no-store");
      if (doitCompter(req.method, req.headers as Record<string, unknown>)) {
        const quand = deps.maintenant();
        // Un comptage raté ne bloque jamais la redirection.
        await deps.compterClic(lien.id, parisTodayString(quand), quand)
          .catch((e: any) => console.error("[Liens] comptage du clic :", e?.message));
      }
      res.set({ "Cache-Control": "no-store", "Referrer-Policy": "strict-origin-when-cross-origin" });
      res.redirect(302, fusionnerUtm(lien.urlCible, lien.utm as Utm));
    } catch (e: any) {
      console.error("[Liens] redirection :", e?.message);
      envoyerHtml(res, 500, pageIntrouvable(), "no-store");
    }
  });

  app.get("/b/:slug", async (req, res) => {
    try {
      const slug = String(req.params.slug ?? "");
      const s = SLUG_RE.test(slug) ? await deps.smartlinkParSlug(slug) : undefined;
      if (!s || !s.actif) return envoyerHtml(res, 404, pageIntrouvable(), "no-store");
      const boutons = ((s.boutons ?? []) as BoutonSmartlink[])
        .filter((b) => b && b.actif !== false && b.code)
        .map((b) => ({ libelle: b.libelle, href: `/l/${b.code}` }));
      let tuiles: Array<{ imageUrl: string; href: string | null }> = [];
      if (s.tuilesActives) {
        const liensTuiles = (s.liensTuiles ?? {}) as Record<string, LienTuile>;
        tuiles = (await publicationsAvecImage(deps, s.userId, s.projectId ?? null, TUILES_MAX)).map((p) => {
          const l = liensTuiles[String(p.id)];
          return { imageUrl: p.imageUrl, href: l?.code ? `/l/${l.code}` : null };
        });
      }
      const html = rendrePageSmartlink({
        titre: s.titre, bio: s.bio, avatarUrl: s.avatarUrl, theme: s.theme as any,
        urlPage: `${urlDeBase()}/b/${s.slug}`, boutons, tuiles,
      });
      envoyerHtml(res, 200, html, "public, max-age=60");
    } catch (e: any) {
      console.error("[SmartLink] page publique :", e?.message);
      envoyerHtml(res, 500, pageIntrouvable(), "no-store");
    }
  });
}

// ── Routes authentifiées ─────────────────────────────────────────────────────────────

/** Clics des 30 derniers jours (jour de Paris compris) par lien, et par jour. */
async function clics30Jours(deps: DepsLiens, ids: number[]) {
  const depuis = parisTodayString(new Date(deps.maintenant().getTime() - 29 * JOUR_MS));
  const rows = await deps.clicsDepuis(ids, depuis);
  const parLien = new Map<number, number>();
  const parJour = new Map<string, number>();
  for (const r of rows) {
    parLien.set(r.lienId, (parLien.get(r.lienId) ?? 0) + r.clics);
    parJour.set(r.jour, (parJour.get(r.jour) ?? 0) + r.clics);
  }
  return { parLien, parJour };
}

function smartlinkPourClient(s: any, base: string) {
  return { ...s, urlPublique: `${base}/b/${s.slug}` };
}

export function registerLiensRoutes(app: Express, deps: DepsLiens = depsLiens): void {
  // ── Liens courts ──────────────────────────────────────────────────────────────────
  app.post("/api/liens", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const b = req.body ?? {};
      if (!estUrlSure(b.url)) return res.status(400).json({ message: "url_invalide" });
      const utm = lireUtm(b.utm);
      if (!utm) return res.status(400).json({ message: "utm_invalide" });
      const projectId = projetDeRequete(b.projectId);
      if (projectId === "invalide" || !(await marqueAElle(deps, userId, projectId))) return res.status(404).json({ message: "projet_introuvable" });
      await verifierQuota(deps, userId, 1);
      const l = await creerLienCourt(deps, { userId, projectId, urlCible: String(b.url).trim(), utm, origine: "composeur" });
      res.status(201).json({ id: l.id, code: l.code, urlCourte: `${urlDeBase()}/l/${l.code}`, urlCible: l.urlCible, utm: l.utm });
    } catch (e: any) {
      if (e instanceof LimiteAtteinte) return res.status(429).json({ message: "limite_liens", max: LIENS_PAR_JOUR });
      console.error("[Liens] création :", e?.message);
      res.status(500).json({ message: "liens_failed" });
    }
  });

  app.get("/api/liens", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const projectId = projetDeRequete(req.query.projectId);
      if (projectId === "invalide" || !(await marqueAElle(deps, userId, projectId))) return res.status(404).json({ message: "projet_introuvable" });
      const liens = await deps.liens(userId, projectId, "composeur");
      const { parLien } = await clics30Jours(deps, liens.map((l) => l.id));
      const base = urlDeBase();
      res.json(liens.map((l) => ({
        id: l.id, code: l.code, urlCourte: `${base}/l/${l.code}`, urlCible: l.urlCible, utm: l.utm,
        clics: l.clics, trenteJours: parLien.get(l.id) ?? 0, dernierClicAt: l.dernierClicAt, createdAt: l.createdAt,
      })));
    } catch (e: any) {
      console.error("[Liens] liste :", e?.message);
      res.status(500).json({ message: "liens_failed" });
    }
  });

  // ── SmartLinks ────────────────────────────────────────────────────────────────────
  app.get("/api/smartlinks", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const projectId = projetDeRequete(req.query.projectId);
      if (projectId === "invalide" || !(await marqueAElle(deps, userId, projectId))) return res.status(404).json({ message: "projet_introuvable" });
      const s = await deps.smartlinkDe(userId, projectId);
      const base = urlDeBase();
      const publications = await publicationsAvecImage(deps, userId, projectId, TUILES_MAX);
      res.json({ smartlink: s ? smartlinkPourClient(s, base) : null, base, publications });
    } catch (e: any) {
      console.error("[SmartLink] lecture :", e?.message);
      res.status(500).json({ message: "smartlink_failed" });
    }
  });

  /** Enregistre (crée ou modifie) : les liens courts des boutons et tuiles sont repris ou créés. */
  async function enregistrer(req: any, res: any, existant: any | null) {
    const userId = req.userId;
    const lu = lireSmartlink(req.body, () => nouvelIdBouton(deps));
    if (!lu.ok) return res.status(400).json({ message: lu.erreur });
    const v = lu.valeur;
    const projectId = existant ? (existant.projectId ?? null) : projetDeRequete(req.body?.projectId);
    if (projectId === "invalide" || !(await marqueAElle(deps, userId, projectId))) return res.status(404).json({ message: "projet_introuvable" });
    if (!existant && (await deps.smartlinkDe(userId, projectId))) return res.status(409).json({ message: "deja_existante" });
    const autre = await deps.smartlinkParSlug(v.slug);
    if (autre && autre.id !== existant?.id) return res.status(409).json({ message: "slug_pris" });

    const anciensBoutons = new Map(((existant?.boutons ?? []) as BoutonSmartlink[]).map((b) => [b.id, b]));
    const anciennesTuiles = (existant?.liensTuiles ?? {}) as Record<string, LienTuile>;
    const besoin = v.boutons.filter((b) => !lienRepris(anciensBoutons.get(b.id), b.url)).length
      + Object.entries(v.liensTuiles).filter(([k, url]) => !lienRepris(anciennesTuiles[k], url)).length;
    await verifierQuota(deps, userId, besoin);

    const utm: Utm = { source: "smartlink", medium: "bio", campaign: v.slug };
    const lier = async (ancien: { url: string; lienId?: number; code?: string } | undefined, url: string) =>
      lienRepris(ancien, url) ?? await creerLienCourt(deps, { userId, projectId, urlCible: url, utm, origine: "smartlink" })
        .then((l) => ({ lienId: l.id, code: l.code }));

    const boutons: BoutonSmartlink[] = [];
    for (const b of v.boutons) boutons.push({ ...b, ...(await lier(anciensBoutons.get(b.id), b.url)) });
    const liensTuiles: Record<string, LienTuile> = {};
    for (const [k, url] of Object.entries(v.liensTuiles)) liensTuiles[k] = { url, ...(await lier(anciennesTuiles[k], url)) };

    const row = {
      slug: v.slug, titre: v.titre, bio: v.bio, avatarUrl: v.avatarUrl, theme: v.theme, actif: v.actif,
      boutons, tuilesActives: v.tuilesActives, liensTuiles,
    };
    try {
      const s = existant
        ? await deps.modifierSmartlink(userId, existant.id, row)
        : await deps.creerSmartlink({ ...row, userId, projectId });
      if (!s) return res.status(404).json({ message: "not_found" });
      res.status(existant ? 200 : 201).json(smartlinkPourClient(s, urlDeBase()));
    } catch (e: any) {
      if (e?.code === "23505") return res.status(409).json({ message: "slug_pris" });
      throw e;
    }
  }

  const gerer = (fn: (req: any, res: any) => Promise<unknown>) => async (req: any, res: any) => {
    try {
      await fn(req, res);
    } catch (e: any) {
      if (e instanceof LimiteAtteinte) return res.status(429).json({ message: "limite_liens", max: LIENS_PAR_JOUR });
      console.error("[SmartLink] :", e?.message);
      res.status(500).json({ message: "smartlink_failed" });
    }
  };

  app.post("/api/smartlinks", isAuthenticated, gerer((req, res) => enregistrer(req, res, null)));

  app.put("/api/smartlinks/:id", isAuthenticated, gerer(async (req, res) => {
    const id = idPositif(req.params.id);
    const s = id == null ? undefined : await deps.smartlink(req.userId, id);
    if (!s) return res.status(404).json({ message: "not_found" });
    return enregistrer(req, res, s);
  }));

  app.delete("/api/smartlinks/:id", isAuthenticated, gerer(async (req, res) => {
    const id = idPositif(req.params.id);
    if (id == null || !(await deps.supprimerSmartlink(req.userId, id))) return res.status(404).json({ message: "not_found" });
    res.json({ ok: true });
  }));

  app.get("/api/smartlinks/:id/stats", isAuthenticated, gerer(async (req, res) => {
    const userId = req.userId;
    const id = idPositif(req.params.id);
    const s = id == null ? undefined : await deps.smartlink(userId, id);
    if (!s) return res.status(404).json({ message: "not_found" });
    const boutons = (s.boutons ?? []) as BoutonSmartlink[];
    const tuiles = Object.entries((s.liensTuiles ?? {}) as Record<string, LienTuile>);
    const ids = [...boutons.map((b) => b.lienId), ...tuiles.map(([, t]) => t.lienId)]
      .filter((x): x is number => Number.isInteger(x));
    const liens = new Map((await deps.liensParIds(userId, ids)).map((l) => [l.id, l]));
    const { parLien, parJour } = await clics30Jours(deps, Array.from(liens.keys()));
    const total = (lienId?: number) => (lienId != null ? liens.get(lienId)?.clics ?? 0 : 0);
    const trente = (lienId?: number) => (lienId != null ? parLien.get(lienId) ?? 0 : 0);
    res.json({
      total: Array.from(liens.values()).reduce((a, l) => a + (l.clics ?? 0), 0),
      trenteJours: Array.from(parLien.values()).reduce((a, n) => a + n, 0),
      boutons: boutons.map((b) => ({ id: b.id, libelle: b.libelle, url: b.url, total: total(b.lienId), trenteJours: trente(b.lienId) })),
      tuiles: tuiles.map(([contentId, t]) => ({ contentId: Number(contentId), url: t.url, total: total(t.lienId), trenteJours: trente(t.lienId) })),
      parJour: Array.from(parJour.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([jour, clics]) => ({ jour, clics })),
    });
  }));
}
