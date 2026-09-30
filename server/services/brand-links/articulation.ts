import { db } from "../../db";
import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import { projectLinks, campaigns, projects } from "@shared/schema";
import { anglesDepuisPhases, type Articulation } from "./links";

/** Les statuts de campagne qu'on propose d'articuler. `completed` est exclu. */
export const STATUTS_ARTICULABLES = ["draft", "active", "running"] as const;

/**
 * Le plafond de campagnes vivantes proposées PAR LIEN (donc par marque liée). Ces
 * campagnes partent dans un prompt de génération : une marque liée qui en porterait
 * beaucoup noierait le prompt plutôt que de proposer. Dans l'usage réel, une marque
 * a rarement plus de deux ou trois campagnes vivantes en parallèle — 5 laisse de la
 * marge sans jamais approcher le gonflement qu'on veut éviter.
 */
export const PLAFOND_CAMPAGNES_PAR_LIEN = 5;

/**
 * Les articulations proposables pour une marque : pour chacun de ses liens, les
 * campagnes vivantes de la marque liée, réduites à ce qui peut entrer dans un prompt.
 *
 * Quand la marque n'a AUCUN lien, on rend une liste vide sans interroger les
 * campagnes. C'est ce qui garantit qu'une marque sans lien produit exactement la
 * même génération qu'avant ce chantier.
 */
export async function articulationsDisponibles(userId: string, projectId: number): Promise<Articulation[]> {
  const liens = await db
    .select()
    .from(projectLinks)
    .where(and(
      eq(projectLinks.userId, userId),
      or(eq(projectLinks.fromProjectId, projectId), eq(projectLinks.toProjectId, projectId)),
    ))
    // Déterministe : sans cet ordre, « le premier lien rencontré » dépendrait de
    // l'ordre physique de Postgres — qui peut changer sans qu'aucune donnée ne
    // bouge — et déciderait alors du sens retenu en cas de couple réciproque (voir
    // la déduplication plus bas). Ce défaut exact a déjà été trouvé deux fois sur
    // ce chantier.
    .orderBy(asc(projectLinks.id));

  if (liens.length === 0) return [];

  const out: Articulation[] = [];
  for (const lien of liens) {
    const sortant = lien.fromProjectId === projectId;
    const autreId = sortant ? lien.toProjectId : lien.fromProjectId;

    const [autre] = await db.select({ name: projects.name }).from(projects).where(eq(projects.id, autreId));
    if (!autre) continue; // marque supprimée entre-temps : on saute, sans bruit

    // Projection explicite : seules les 5 colonnes dont on a besoin quittent la
    // requête. Défense en profondeur — même un `...c` malheureux dans l'objet
    // `campagne` plus bas ne pourrait alors exposer aucune identité, puisque les
    // colonnes n'auraient tout simplement jamais été chargées.
    const brutes = await db
      .select({
        id: campaigns.id,
        name: campaigns.name,
        objective: campaigns.objective,
        coreMessage: campaigns.coreMessage,
        phases: campaigns.phases,
      })
      .from(campaigns)
      .where(and(
        eq(campaigns.userId, userId),
        eq(campaigns.projectId, autreId),
        inArray(campaigns.status, [...STATUTS_ARTICULABLES]),
      ))
      // Les plus récemment mises à jour d'abord : ce sont elles qu'on garde si le
      // plafond mord. `id` en second départage les égalités de date, pour que le
      // plafond écarte toujours LES MÊMES campagnes d'une lecture à l'autre.
      .orderBy(desc(campaigns.updatedAt), asc(campaigns.id))
      .limit(PLAFOND_CAMPAGNES_PAR_LIEN + 1); // +1 : détecte le dépassement sans requête de comptage séparée

    const vivantes = brutes.slice(0, PLAFOND_CAMPAGNES_PAR_LIEN);
    if (brutes.length > PLAFOND_CAMPAGNES_PAR_LIEN) {
      const ecartees = brutes.length - PLAFOND_CAMPAGNES_PAR_LIEN;
      console.info(
        `[Liens] articulation: ${ecartees} campagne(s) écartée(s) au-delà du plafond ` +
        `(${PLAFOND_CAMPAGNES_PAR_LIEN}) pour la marque liée « ${autre.name} ».`
      );
    }

    for (const c of vivantes) {
      out.push({
        lien: { roleAmont: lien.roleAmont, roleAval: lien.roleAval, nature: lien.nature },
        sens: sortant ? "nourrit" : "estNourriePar",
        campagne: {
          id: c.id,
          marque: autre.name,
          name: c.name,
          objective: c.objective,
          coreMessage: c.coreMessage,
          angles: anglesDepuisPhases(c.phases),
        },
      });
    }
  }

  // Déduplique par campagne : le schéma autorise volontairement un couple de
  // marques à être lié dans les deux sens (A→B ET B→A, avec des rôles différents
  // chacun — une relation peut être mutuelle). Sans déduplication, la même
  // campagne de la marque liée ressortirait deux fois : une fois "nourrit", une
  // fois "estNourriePar" — deux affirmations contradictoires dans le même prompt.
  // On garde le sens SORTANT : c'est celui que l'utilisatrice a déclaré depuis la
  // page de CETTE marque, donc celui qu'elle attend en travaillant dessus. Ce
  // choix n'est jamais silencieux : il perd une information réelle (la relation
  // était bien réciproque), donc on le journalise.
  const parCampagne = new Map<number, Articulation>();
  for (const a of out) {
    const existante = parCampagne.get(a.campagne.id);
    if (!existante) {
      parCampagne.set(a.campagne.id, a);
    } else if (existante.sens !== a.sens) {
      const sortante = a.sens === "nourrit" ? a : existante;
      console.info(
        `[Liens] articulation: couple réciproque réduit au sens sortant pour la campagne ` +
        `${sortante.campagne.id} (« ${sortante.campagne.marque} ») — le sens "estNourriePar" est écarté.`
      );
      parCampagne.set(a.campagne.id, sortante);
    }
    // sinon : même id, même sens — ne devrait pas se produire vu l'index unique
    // sur (userId, fromProjectId, toProjectId), mais on ne duplique pas non plus.
  }

  return Array.from(parCampagne.values());
}
