// Niveau 2 : pour chaque marque, au plus 5 tendances du profil qui lui vont, avec une phrase
// d'adaptation. Et le bloc injecté UNIQUEMENT dans les appels qui écrivent du contenu.
import { z } from "zod/v4";
import { REGLES, clesEcartees, tendanceVisible, libelleFormat, type TypeMedia, type Structure } from "@shared/profils-veille";
import type { InsertTendanceProjet } from "@shared/schema";

export const SCHEMA_TRI = z.object({ choix: z.array(z.object({ tendanceId: z.number().int(), adaptation: z.string().min(1) })).max(REGLES.tendancesMaxParProjet) });

type Tendance = { id: number; cle: string; plateforme: string; typeMedia: string; structure: string; lift: number; pourquoi: string; commentAdapter: string; statut?: string | null };

export interface DepsTri {
  /** Diffusion ouverte pour cette utilisatrice (owner, ou PROFILS_VEILLE_POUR_TOUS=true). */
  estOuvert(userId: string): Promise<boolean>;
  garde(userId: string): Promise<unknown | null>;
  /** Tendances de la semaine du profil, non écartées par Jeanne. */
  tendancesSemaine(profilId: number, semaine: string): Promise<Tendance[]>;
  ecartees(projectId: number): Promise<Array<{ cle: string; ecarteLe: Date }>>;
  projet(userId: string, projectId: number): Promise<{ nom: string; plateformes: string; offre: string; cible: string }>;
  choisir(i: { userId: string; projectId: number; projet: { nom: string; plateformes: string; offre: string; cible: string }; tendances: Tendance[] }): Promise<z.infer<typeof SCHEMA_TRI>>;
  enregistrer(rows: InsertTendanceProjet[]): Promise<void>;
  marquerTri(projectId: number, semaine: string): Promise<void>;
  /** Formats (cle) déjà proposés à ce projet : ligne encore visible, ou utilisée il y a moins de 28 jours. */
  clesRecentes(projectId: number, maintenant: Date): Promise<Set<string>>;
}

export async function trierPourProjet(deps: DepsTri, r: { userId: string; projectId: number; profilId: number; dernierTri: string | null }, semaine: string, maintenant: Date) {
  if (r.dernierTri === semaine) return "deja" as const;
  if (!(await deps.estOuvert(r.userId))) return "ferme" as const;
  const bloquees = clesEcartees(await deps.ecartees(r.projectId), maintenant);
  const recentes = await deps.clesRecentes(r.projectId, maintenant);
  // Jamais le même format en double d'une semaine à l'autre ; une tendance « en baisse » ne se propose pas.
  const tendances = (await deps.tendancesSemaine(r.profilId, semaine))
    .filter((t) => !bloquees.has(t.cle) && !recentes.has(t.cle) && t.statut !== "en_baisse");
  if (tendances.length === 0) { await deps.marquerTri(r.projectId, semaine); return "rien" as const; }
  if (await deps.garde(r.userId)) return "refus_garde" as const;
  try {
    const projet = await deps.projet(r.userId, r.projectId);
    const { choix } = await deps.choisir({ userId: r.userId, projectId: r.projectId, projet, tendances });
    const ids = new Set(tendances.map((t) => t.id));
    const expireLe = new Date(maintenant.getTime() + REGLES.dureeTendanceJours * 24 * 3600_000);
    const rows = choix.filter((c) => ids.has(c.tendanceId)).slice(0, REGLES.tendancesMaxParProjet)
      .map((c) => ({ userId: r.userId, projectId: r.projectId, tendanceId: c.tendanceId, adaptation: c.adaptation.slice(0, 400), statut: "nouveau", expireLe }));
    await deps.enregistrer(rows);
    await deps.marquerTri(r.projectId, semaine);
    return rows.length ? ("ok" as const) : ("rien" as const);
  } catch (e: any) {
    console.error(`[profils-veille] tri du projet ${r.projectId} :`, e?.message ?? e);
    return "erreur" as const;
  }
}

const virgule = (x: number) => x.toFixed(1).replace(".", ",");

export function formaterBloc(ts: Array<{ id: number; plateforme: string; typeMedia: string; structure: string; lift: number; adaptation: string }>): string {
  if (ts.length === 0) return "";
  return [
    "CE QUI MARCHE EN CE MOMENT DANS LE SECTEUR DE CETTE MARQUE (veille Naya, mesuré sur des marques comparables) :",
    ...ts.map((t) => `- [${t.id}] ${t.plateforme} · ${libelleFormat(t.typeMedia as TypeMedia, t.structure as Structure)} — contenus forts ${virgule(t.lift)}× plus souvent que la moyenne. Pour cette marque : ${t.adaptation}`),
    "Inspire-t'en quand c'est pertinent, jamais par obligation. Ne copie jamais un post existant.",
  ].join("\n");
}

type LigneInjection = { id: number; statut: string; expireLe: Date; plateforme: string; typeMedia: string; structure: string; lift: number; adaptation: string };

export async function tendancesPourLeContenu(
  userId: string, projectId: number | null | undefined, plateformes: string[],
  lire: (userId: string, projectId: number) => Promise<LigneInjection[]> = async (u, p) => (await import("./stockage")).stockageProfils.tendancesDuProjet(u, p),
  maintenant = new Date(),
): Promise<string> {
  if (projectId == null) return "";
  const voulues = new Set(plateformes.map((p) => p.toLowerCase()));
  try {
    const lignes = (await lire(userId, projectId))
      .filter((t) => voulues.has(t.plateforme.toLowerCase()) && tendanceVisible(t, maintenant))
      .slice(0, REGLES.tendancesMaxParProjet);
    return formaterBloc(lignes);
  } catch (e: any) {
    console.error("[profils-veille] bloc d'injection indisponible :", e?.message ?? e);
    return "";
  }
}
