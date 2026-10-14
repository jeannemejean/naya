// Ranger une marque dans un profil de veille. Sûr de lui (≥ 0,7) : rattachement proposé à
// l'utilisatrice. Sinon Naya rédige un nouveau profil, que Jeanne valide avant qu'il tourne.
import { z } from "zod/v4";
import { REGLES, handlesInstagram, normaliserCompteInstagram, PLATEFORMES_LOT1 } from "@shared/profils-veille";

export const SCHEMA_CHOIX = z.object({ profilId: z.number().int().nullable(), confiance: z.number().min(0).max(1), raison: z.string() });
export const SCHEMA_PROPOSITION = z.object({
  nom: z.string().min(2), description: z.string(),
  criteres: z.object({ typesBusiness: z.array(z.string()), cibles: z.array(z.string()), motsCles: z.array(z.string()) }),
  requetes: z.array(z.string()).max(4),
});

export interface ProjetARattacher { userId: string; projectId: number; nom: string; contexte: string; exclus: number[]; rattachementId: number | null }
type Profil = { id: number; nom: string; description: string; criteres: unknown };

export interface DepsRattachement {
  garde(userId: string): Promise<unknown | null>;
  catalogue(): Promise<Profil[]>;
  choisir(i: { userId: string; projectId: number; contexte: string; catalogue: Profil[] }): Promise<z.infer<typeof SCHEMA_CHOIX>>;
  enregistrer(row: { userId: string; projectId: number; profilId: number; confiance: number; raison: string; statut: string }): Promise<void>;
  proposer(i: { userId: string; projectId: number; contexte: string }): Promise<z.infer<typeof SCHEMA_PROPOSITION>>;
  /** Liens trouvés par recherche Google pour ces requêtes (coût imputé à l'utilisatrice). */
  chercher(userId: string, requetes: string[]): Promise<string[]>;
  creerProposition(profil: { nom: string; description: string; criteres: unknown }, comptes: Array<{ plateforme: string; compte: string; url: string }>): Promise<number>;
}

export async function rattacherProjet(deps: DepsRattachement, projet: ProjetARattacher) {
  if (await deps.garde(projet.userId)) return "refus_garde" as const;
  try {
    const catalogue = (await deps.catalogue()).filter((p) => !projet.exclus.includes(p.id));
    if (catalogue.length > 0) {
      const c = await deps.choisir({ userId: projet.userId, projectId: projet.projectId, contexte: projet.contexte, catalogue });
      if (c.profilId != null && catalogue.some((p) => p.id === c.profilId) && c.confiance >= REGLES.confianceMin) {
        await deps.enregistrer({ userId: projet.userId, projectId: projet.projectId, profilId: c.profilId, confiance: c.confiance, raison: c.raison.slice(0, 300), statut: "propose" });
        return "rattache" as const;
      }
    }
    const p = await deps.proposer({ userId: projet.userId, projectId: projet.projectId, contexte: projet.contexte });
    const liens = p.requetes.length ? await deps.chercher(projet.userId, p.requetes.map((q) => `site:instagram.com ${q}`)) : [];
    const comptes = PLATEFORMES_LOT1.includes("instagram")
      ? handlesInstagram(liens).slice(0, REGLES.comptesMaxParPlateforme).map((h) => ({ plateforme: "instagram", ...normaliserCompteInstagram(h)! }))
      : [];
    const profilId = await deps.creerProposition({ nom: p.nom, description: p.description, criteres: p.criteres }, comptes);
    await deps.enregistrer({ userId: projet.userId, projectId: projet.projectId, profilId, confiance: 0, raison: "Nouveau profil proposé à Jeanne.", statut: "en_attente" });
    return "propose_a_jeanne" as const;
  } catch (e: any) {
    console.error(`[profils-veille] rattachement du projet ${projet.projectId} :`, e?.message ?? e);
    return "erreur" as const;
  }
}
