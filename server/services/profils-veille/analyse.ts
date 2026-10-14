// Analyse hebdomadaire d'un profil : (1) nommer le format des posts mûrs (modèle rapide,
// sortie structurée), (2) compter sans IA, (3) écrire une fiche par format retenu via l'API
// Batch (lue à un tour suivant). Zéro tendance est une sortie normale.
import { z } from "zod/v4";
import {
  REGLES, STRUCTURES, ACCROCHES, statsFormats, formatsRetenus, enBaisse, libelleFormat, moisDe,
  type PostFenetre, type StatFormat, type TypeMedia, type Structure, type PlateformeVeille,
} from "@shared/profils-veille";
import type { InsertProfilTendance } from "@shared/schema";
import { schemaJson, lireStructure } from "../ai/structure";
import type { RequeteLot, ResultatLot } from "../ai/lots";

export const SCHEMA_CLASSEMENT = z.object({
  posts: z.array(z.object({
    id: z.number().int(),
    structure: z.enum(STRUCTURES),
    accroche: z.enum(ACCROCHES),
    autreLibelle: z.string().nullable(),
  })),
});
export const SCHEMA_TENDANCE = z.object({ pourquoi: z.string().min(1), commentAdapter: z.string().min(1) });

export interface PostAClasser { id: number; typeMedia: TypeMedia; legende: string | null }
type Format = { structure: Structure; accroche: string; autreLibelle: string | null };
type Retenu = StatFormat & { exemples: string[]; accrocheDominante: string | null; statut: "nouveau" | "confirme" | "en_baisse"; enBaisse?: boolean; pourquoi?: string; commentAdapter?: string };

export interface DepsAnalyse {
  creerAnalyse(profilId: number, semaine: string): Promise<number | null>;
  majAnalyse(id: number, patch: Record<string, unknown>): Promise<void>;
  depenseDuMois(profilId: number, mois: string): Promise<number>;
  postsAClasser(profilId: number, depuis: Date, maintenant: Date): Promise<PostAClasser[]>;
  classer(posts: PostAClasser[]): Promise<{ resultats: Array<{ id: number } & Format>; coutEur: number }>;
  enregistrerFormat(postId: number, format: Format): Promise<void>;
  postsFenetre(profilId: number, depuis: Date, maintenant: Date): Promise<PostFenetre[]>;
  exemples(profilId: number, cles: string[]): Promise<Array<{ cle: string; url: string; legende: string | null; compteId: number; accroche: string | null }>>;
  tendancesPrecedentes(profilId: number, semaine: string): Promise<Array<Pick<InsertProfilTendance, "cle" | "pourquoi" | "commentAdapter" | "exemples" | "plateforme" | "typeMedia" | "structure" | "accrocheDominante" | "statut">>>;
  soumettre(reqs: RequeteLot[]): Promise<string>;
  lire(batchId: string): Promise<ResultatLot[] | null>;
  enregistrerTendances(rows: InsertProfilTendance[]): Promise<void>;
  modeleRaisonnement: string;
  modeleRapide: string;
}

const PAR_APPEL = 20;
const SYSTEME_TENDANCE =
  "Tu es l'analyste de veille de Naya. On te donne un format de publication qui surperforme, mesuré, chez des marques d'un même secteur, avec des exemples. " +
  "Explique en 2 phrases au plus pourquoi ce format marche probablement (une hypothèse, formulée comme telle, jamais comme une certitude), " +
  "puis en 2 phrases au plus comment une marque de ce secteur peut l'adapter sans copier. Français, direct, concret, sans jargon.";

function plusFrequent(xs: Array<string | null>): string | null {
  const c = new Map<string, number>();
  for (const x of xs) if (x) c.set(x, (c.get(x) ?? 0) + 1);
  return Array.from(c).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function exemplesVariés(ex: Array<{ url: string; compteId: number }>): string[] {
  const vus = new Set<number>(); const out: string[] = [];
  for (const e of ex) { if (vus.has(e.compteId)) continue; vus.add(e.compteId); out.push(e.url); if (out.length === 3) break; }
  return out;
}

export async function lancerAnalyse(deps: DepsAnalyse, profil: { id: number; nom: string; description: string }, semaine: string, maintenant: Date) {
  const id = await deps.creerAnalyse(profil.id, semaine);
  if (id == null) return "deja" as const;
  if ((await deps.depenseDuMois(profil.id, moisDe(maintenant))) >= REGLES.plafondEurParMois) {
    await deps.majAnalyse(id, { statut: "plafond", erreur: "Plafond mensuel du profil atteint.", updatedAt: new Date() });
    return "plafond" as const;
  }
  const depuis = new Date(maintenant.getTime() - REGLES.fenetreAnalyseJours * 24 * 3600_000);
  let cout = 0;
  try {
    const aClasser = await deps.postsAClasser(profil.id, depuis, maintenant);
    for (let i = 0; i < aClasser.length; i += PAR_APPEL) {
      const { resultats, coutEur } = await deps.classer(aClasser.slice(i, i + PAR_APPEL));
      cout += coutEur;
      const ids = new Set(aClasser.slice(i, i + PAR_APPEL).map((p) => p.id));
      for (const r of resultats) if (ids.has(r.id)) await deps.enregistrerFormat(r.id, { structure: r.structure, accroche: r.accroche, autreLibelle: r.autreLibelle });
    }
    const stats = statsFormats(await deps.postsFenetre(profil.id, depuis, maintenant));
    const retenus = formatsRetenus(stats);
    // Une fiche « en baisse » n'est pas une tendance retenue : elle ne fonde ni « confirme » ni un nouvel « en baisse ».
    const precedentes = (await deps.tendancesPrecedentes(profil.id, semainePrecedente(semaine))).filter((p) => p.statut !== "en_baisse");
    const clesPrec = new Set(precedentes.map((p) => p.cle));
    const enBaisseCles = enBaisse(precedentes.map((p) => ({ cle: p.cle })), new Set(retenus.map((r) => r.cle)), stats);

    const fiches: Retenu[] = [];
    for (const r of retenus) {
      const ex = await deps.exemples(profil.id, r.clesForts);
      fiches.push({ ...r, exemples: exemplesVariés(ex), accrocheDominante: plusFrequent(ex.map((e) => e.accroche)), statut: clesPrec.has(r.cle) ? "confirme" : "nouveau" });
    }
    for (const cle of enBaisseCles) {
      const p = precedentes.find((x) => x.cle === cle)!;
      const s = stats.find((x) => x.cle === cle)!;
      fiches.push({ ...s, exemples: (p.exemples as string[]) ?? [], accrocheDominante: p.accrocheDominante ?? null, statut: "en_baisse", enBaisse: true, pourquoi: p.pourquoi ?? "", commentAdapter: p.commentAdapter ?? "" });
    }
    if (fiches.length === 0) {
      await deps.majAnalyse(id, { statut: "rien", retenus: [], coutEur: cout, updatedAt: new Date() });
      return "rien" as const;
    }
    const aEcrire = fiches.filter((f) => !f.enBaisse);
    if (aEcrire.length === 0) {
      await deps.majAnalyse(id, { statut: "lot_soumis", batchId: null, retenus: fiches, coutEur: cout, updatedAt: new Date() });
      return "lot_soumis" as const;
    }
    const schema = schemaJson(SCHEMA_TENDANCE);
    const batchId = await deps.soumettre(aEcrire.map((f) => ({
      customId: f.cle, system: SYSTEME_TENDANCE, model: deps.modeleRaisonnement, maxTokens: 600, schema,
      prompt: [
        `Secteur : ${profil.nom} — ${profil.description}`,
        `Format : ${libelleFormat(f.typeMedia, f.structure)} sur ${f.plateforme}`,
        `Mesure : contenus forts ${f.lift.toFixed(1)} fois plus souvent que la moyenne du secteur (${f.nbForts} contenus forts, ${f.nbComptes} marques, 14 derniers jours).`,
        f.accrocheDominante ? `Accroche la plus fréquente : ${f.accrocheDominante}` : "",
        `Exemples (liens) : ${f.exemples.join(" ")}`,
      ].filter(Boolean).join("\n"),
    })));
    await deps.majAnalyse(id, { statut: "lot_soumis", batchId, retenus: fiches, coutEur: cout, updatedAt: new Date() });
    return "lot_soumis" as const;
  } catch (e: any) {
    await deps.majAnalyse(id, { statut: "erreur", erreur: String(e?.message ?? e).slice(0, 500), coutEur: cout, updatedAt: new Date() });
    return "erreur" as const;
  }
}

export function semainePrecedente(semaine: string): string {
  const d = new Date(`${semaine}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString().slice(0, 10);
}

export async function finaliserAnalyse(deps: DepsAnalyse, analyse: { id: number; profilId: number; semaine: string; batchId: string | null; retenus: unknown; coutEur: number }) {
  try {
    return await finaliser(deps, analyse);
  } catch (e: any) {
    // Sans trace, le lot resterait « lot_soumis » et lèverait à chaque tour de 15 minutes.
    console.error(`[profils-veille] finalisation de l'analyse ${analyse.id} :`, e?.message ?? e);
    await deps.majAnalyse(analyse.id, { statut: "erreur", erreur: String(e?.message ?? e).slice(0, 500), updatedAt: new Date() });
    return "erreur" as const;
  }
}

async function finaliser(deps: DepsAnalyse, analyse: { id: number; profilId: number; semaine: string; batchId: string | null; retenus: unknown; coutEur: number }) {
  const fiches = (analyse.retenus as Retenu[]) ?? [];
  const resultats = analyse.batchId ? await deps.lire(analyse.batchId) : [];
  if (resultats == null) return "en_cours" as const;
  let cout = analyse.coutEur;
  const erreurs: string[] = [];
  const rows: InsertProfilTendance[] = [];
  for (const f of fiches) {
    let pourquoi = f.pourquoi ?? "", commentAdapter = f.commentAdapter ?? "";
    if (!f.enBaisse) {
      const r = resultats.find((x) => x.customId === f.cle);
      if (!r) { erreurs.push(`${f.cle} : absent du lot`); continue; }
      if ("erreur" in r) { erreurs.push(`${f.cle} : ${r.erreur}`); continue; }
      cout += r.coutEur;
      try { ({ pourquoi, commentAdapter } = lireStructure(SCHEMA_TENDANCE, r.texte)); } catch (e: any) { erreurs.push(`${f.cle} : ${e.message}`); continue; }
    }
    rows.push({
      profilId: analyse.profilId, semaine: analyse.semaine, plateforme: f.plateforme, typeMedia: f.typeMedia, structure: f.structure,
      cle: f.cle, accrocheDominante: f.accrocheDominante, lift: f.lift, nbForts: f.nbForts, nbComptes: f.nbComptes,
      exemples: f.exemples, pourquoi, commentAdapter, statut: f.statut,
    });
  }
  await deps.enregistrerTendances(rows);
  await deps.majAnalyse(analyse.id, { statut: "termine", coutEur: cout, erreur: erreurs.length ? erreurs.join(" | ").slice(0, 1000) : null, updatedAt: new Date() });
  return "termine" as const;
}

export type { PlateformeVeille };
