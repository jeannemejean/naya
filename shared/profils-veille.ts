/**
 * Profils de veille : règles pures (aucune I/O). Un profil = un type de marque, suivi pour
 * TOUTES les marques qui lui ressemblent (recherche mutualisée), puis trié marque par marque.
 * Spec : docs/superpowers/specs/2026-10-14-profils-de-veille-design.md
 */
import { lundiDe, plusJours } from "./atelier";

export const PLATEFORMES_VEILLE = ["instagram", "linkedin", "tiktok"] as const;
export type PlateformeVeille = (typeof PLATEFORMES_VEILLE)[number];
/** Lot 1 : Instagram seulement. TikTok (lot 2) et LinkedIn (lot 3) s'ajoutent ici. */
export const PLATEFORMES_LOT1: PlateformeVeille[] = ["instagram"];

export const TYPES_MEDIA = ["image", "carrousel", "reel", "video", "texte", "document"] as const;
export type TypeMedia = (typeof TYPES_MEDIA)[number];
export const STRUCTURES = [
  "tutoriel", "avant_apres", "coulisses", "temoignage_client", "liste", "histoire_personnelle",
  "prise_de_position", "erreur_courante", "presentation_offre", "tendance_reprise", "question_communaute", "autre",
] as const;
export type Structure = (typeof STRUCTURES)[number];
export const ACCROCHES = ["chiffre", "question", "promesse", "erreur", "contre_intuitif", "histoire", "aucune", "autre"] as const;
export type Accroche = (typeof ACCROCHES)[number];

export const LIBELLES_MEDIA: Record<TypeMedia, string> = {
  image: "Image", carrousel: "Carrousel", reel: "Reel", video: "Vidéo", texte: "Post texte", document: "Document",
};
export const LIBELLES_STRUCTURE: Record<Structure, string> = {
  tutoriel: "tutoriel", avant_apres: "avant/après", coulisses: "coulisses", temoignage_client: "témoignage client",
  liste: "liste", histoire_personnelle: "histoire personnelle", prise_de_position: "prise de position",
  erreur_courante: "erreur courante", presentation_offre: "présentation d'offre", tendance_reprise: "tendance reprise",
  question_communaute: "question à la communauté", autre: "autre",
};
export function libelleFormat(typeMedia: TypeMedia, structure: Structure): string {
  return `${LIBELLES_MEDIA[typeMedia]} ${LIBELLES_STRUCTURE[structure]}`;
}

export const REGLES = {
  comptesMaxParPlateforme: 15,
  plafondEurParMois: 10,
  joursCollecteUtc: [1, 3, 5] as readonly number[],
  heureCollecteUtc: 5,
  jourAnalyseUtc: 0,
  heureAnalyseUtc: 5,
  maturiteHeures: 48,
  fenetreMediane: 30,
  postsMursMin: 8,
  facteurFort: 2,
  fenetreAnalyseJours: 14,
  liftMin: 1.5,
  fortsMin: 3,
  comptesMin: 2,
  tendancesMaxParProjet: 5,
  dureeTendanceJours: 28,
  ecartSemaines: 8,
  confianceMin: 0.7,
  retentionPostsJours: 90,
  echecsAvantInjoignable: 2,
} as const;

export interface Metriques {
  likes?: number | null; commentaires?: number | null; partages?: number | null;
  vues?: number | null; republications?: number | null;
}

const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

/** Engagement normalisé. Une métrique indispensable absente → null (non mesuré ≠ zéro). */
export function engagementDe(plateforme: PlateformeVeille, m: Metriques, abonnes: number | null | undefined): number | null {
  const likes = n(m.likes);
  if (likes == null) return null;
  const coms = n(m.commentaires) ?? 0;
  if (plateforme === "tiktok") {
    const vues = n(m.vues);
    if (!vues) return null;
    return (likes + coms + (n(m.partages) ?? 0)) / vues;
  }
  const ab = n(abonnes);
  if (!ab) return null;
  if (plateforme === "linkedin") return (likes + coms + (n(m.republications) ?? 0)) / ab;
  return (likes + coms) / ab;
}

export function estMur(publieLe: Date | string | null | undefined, maintenant: Date): boolean {
  if (!publieLe) return false;
  const t = new Date(publieLe).getTime();
  return Number.isFinite(t) && maintenant.getTime() - t >= REGLES.maturiteHeures * 3600_000;
}

export function mediane(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const t = [...xs].sort((a, b) => a - b);
  return t.length % 2 ? t[(t.length - 1) / 2] : (t[t.length / 2 - 1] + t[t.length / 2]) / 2;
}

/**
 * `historique` : engagements des posts mûrs du compte, du plus récent au plus ancien (le post
 * jugé compris). Seuls les 30 premiers comptent. Moins de 8 → on ne juge pas (null).
 */
export function estFort(e: number | null, historique: number[]): boolean | null {
  if (e == null) return null;
  const fenetre = historique.slice(0, REGLES.fenetreMediane);
  if (fenetre.length < REGLES.postsMursMin) return null;
  const m = mediane(fenetre)!;
  return e > REGLES.facteurFort * m;
}

export interface PostFenetre {
  cle: string; compteId: number; plateforme: PlateformeVeille; typeMedia: TypeMedia;
  structure: Structure | null; fort: boolean | null;
}
export interface StatFormat {
  cle: string; plateforme: PlateformeVeille; typeMedia: TypeMedia; structure: Structure;
  lift: number; nbPosts: number; nbForts: number; nbComptes: number; clesForts: string[];
}

export const cleFormat = (plateforme: string, typeMedia: string, structure: string) => `${plateforme}|${typeMedia}|${structure}`;

/** Statistiques par format (plateforme × type de média × structure), posts jugés et classés seulement. */
export function statsFormats(posts: PostFenetre[]): StatFormat[] {
  const juges = posts.filter((p) => p.fort !== null && p.structure !== null);
  const parPlateforme = new Map<string, { total: number; forts: number }>();
  for (const p of juges) {
    const g = parPlateforme.get(p.plateforme) ?? { total: 0, forts: 0 };
    g.total++; if (p.fort) g.forts++;
    parPlateforme.set(p.plateforme, g);
  }
  const groupes = new Map<string, PostFenetre[]>();
  for (const p of juges) {
    const k = cleFormat(p.plateforme, p.typeMedia, p.structure!);
    groupes.set(k, [...(groupes.get(k) ?? []), p]);
  }
  const out: StatFormat[] = [];
  for (const [cle, ps] of Array.from(groupes)) {
    const g = parPlateforme.get(ps[0].plateforme)!;
    const tauxGlobal = g.total ? g.forts / g.total : 0;
    const forts = ps.filter((p) => p.fort);
    const tauxFormat = forts.length / ps.length;
    out.push({
      cle, plateforme: ps[0].plateforme, typeMedia: ps[0].typeMedia, structure: ps[0].structure!,
      lift: tauxGlobal > 0 ? tauxFormat / tauxGlobal : 0,
      nbPosts: ps.length, nbForts: forts.length,
      nbComptes: new Set(forts.map((p) => p.compteId)).size,
      clesForts: forts.map((p) => p.cle),
    });
  }
  return out.sort((a, b) => b.lift - a.lift);
}

/** Seuil anti-hasard : lift ≥ 1,5, ≥ 3 forts, venant d'au moins 2 comptes. `autre` n'est jamais une tendance. */
export function formatsRetenus(stats: StatFormat[]): StatFormat[] {
  return stats.filter((s) => s.structure !== "autre" && s.lift >= REGLES.liftMin && s.nbForts >= REGLES.fortsMin && s.nbComptes >= REGLES.comptesMin);
}

/** Retenus la semaine d'avant, pas cette semaine, mais encore au moins dans la moyenne. */
export function enBaisse(precedentes: Array<{ cle: string }>, retenues: Set<string>, stats: StatFormat[]): string[] {
  const lift = new Map(stats.map((s) => [s.cle, s.lift]));
  return precedentes.map((p) => p.cle).filter((c) => !retenues.has(c) && (lift.get(c) ?? 0) >= 1);
}

export const jourDe = (d: Date) => d.toISOString().slice(0, 10);
export const moisDe = (d: Date) => d.toISOString().slice(0, 7);
export const semaineDe = (d: Date) => lundiDe(jourDe(d));
/** L'analyse du dimanche prépare la semaine qui commence le lendemain. */
export const semaineAnalysee = (d: Date) => semaineDe(new Date(d.getTime() + 24 * 3600_000));

export function clesEcartees(ecartees: Array<{ cle: string; ecarteLe: Date | string }>, maintenant: Date): Set<string> {
  const limite = maintenant.getTime() - REGLES.ecartSemaines * 7 * 24 * 3600_000;
  return new Set(ecartees.filter((e) => new Date(e.ecarteLe).getTime() >= limite).map((e) => e.cle));
}

export function tendanceVisible(t: { statut: string; expireLe: Date | string }, maintenant: Date): boolean {
  if (t.statut === "garde") return true;
  if (t.statut !== "nouveau" && t.statut !== "vu") return false;
  return new Date(t.expireLe).getTime() > maintenant.getTime();
}

/** Post créé depuis une tendance : mercredi de la semaine suivante, 8 h UTC (modifiable dans l'atelier). */
export function creneauTendance(maintenant: Date): Date {
  const mercredi = plusJours(plusJours(semaineDe(maintenant), 7), 2);
  return new Date(`${mercredi}T08:00:00.000Z`);
}

const HANDLE = /^[a-z0-9._]{1,30}$/;
const PAS_DES_COMPTES = new Set(["p", "reel", "reels", "explore", "stories", "tv", "accounts", "about", "developer", "legal"]);

export function normaliserCompteInstagram(saisie: string): { compte: string; url: string } | null {
  let s = (saisie || "").trim().toLowerCase();
  if (!s) return null;
  const m = /instagram\.com\/([^/?#]+)/.exec(s);
  if (m) s = m[1];
  s = s.replace(/^@/, "").replace(/\/+$/, "");
  if (!HANDLE.test(s) || PAS_DES_COMPTES.has(s)) return null;
  return { compte: s, url: `https://www.instagram.com/${s}/` };
}

export function handlesInstagram(liens: string[]): string[] {
  const vus = new Set<string>();
  for (const l of liens) {
    if (!/instagram\.com\//i.test(l)) continue;
    const r = normaliserCompteInstagram(l);
    if (r) vus.add(r.compte);
  }
  return Array.from(vus);
}

export function cleDePost(url: string): string {
  return (url || "").trim().split(/[?#]/)[0].replace(/\/+$/, "");
}

/**
 * Retire TOUTE ligne « TENDANCE: … » (où qu'elle soit, gras ou crochets tolérés) — elle ne doit
 * jamais être publiée. L'id = premier nombre de la dernière ligne trouvée ; « TENDANCE: aucune » → null.
 */
export function extraireTendance(texte: string): { texte: string; tendanceId: number | null } {
  const brut = texte ?? "";
  const lignes = brut.match(/^\s*\**\s*TENDANCE\s*:.*$/gim);
  if (!lignes) return { texte: brut.trim(), tendanceId: null };
  const id = /\d{1,9}/.exec(lignes[lignes.length - 1]);
  const reste = brut.replace(/^\s*\**\s*TENDANCE\s*:.*$/gim, "").replace(/\n{3,}/g, "\n\n").trim();
  return { texte: reste, tendanceId: id ? Number(id[0]) : null };
}
