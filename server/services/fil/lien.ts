// Lien de chaque tâche vers l'étape et l'objectif qu'elle sert (LienFil), joint aux routes des
// tâches (jour et plage) sous interrupteur : l'écran affiche « Étape : …, 3 tâches sur 7 faites.
// Objectif : … ». L'étape fait foi (elle porte son objectif) ; à défaut, l'objectif de la tâche.
import type { LienFil } from "@shared/fil";
import { storage } from "../../storage";
import { chargerCarte, libelleCible, type CarteFil, type EtapeCarte, type ObjectifCarte } from "./carte";
import { filActifPour } from "./interrupteur";

type TacheReliable = { goalId?: number | null; milestoneId?: number | null; _virtual?: boolean };

function lien(o: ObjectifCarte, e: EtapeCarte | null): LienFil {
  return {
    objectifId: o.id, objectifTitre: o.titre,
    etapeId: e?.id ?? null, etapeTitre: e?.titre ?? null,
    etapeFaites: e?.faites ?? 0, etapePrevues: e?.prevues ?? 0,
    cible: libelleCible(o),
  };
}

/** Le lien d'une tâche sur la carte, ou null (objectif non actif, aucune attache, tâche virtuelle). */
export function lienDeTache(carte: CarteFil, t: TacheReliable): LienFil | null {
  if (t._virtual) return null;
  if (t.milestoneId != null) {
    for (const o of carte.objectifs) {
      const e = o.etapes.find((x) => x.id === t.milestoneId);
      if (e) return lien(o, e);
    }
  }
  if (t.goalId != null) {
    const o = carte.objectifs.find((x) => x.id === t.goalId);
    if (o) return lien(o, null);
  }
  return null;
}

export interface DepsLiens {
  filActif: (userId: string) => boolean;
  charger: (userId: string, depuis: Date | null) => Promise<CarteFil>;
  depuis: (userId: string) => Promise<Date | null>;
}

const depsParDefaut: DepsLiens = {
  filActif: (userId) => filActifPour(userId),
  charger: chargerCarte,
  depuis: async (userId) => ((await storage.getUserPreferences(userId)) as any)?.filConducteurDepuis ?? null,
};

/**
 * Sous interrupteur : chaque tâche reçoit `lien: LienFil | null`. Hors interrupteur, ou si la carte
 * ne se charge pas, la liste est rendue telle quelle : le fil ne casse jamais la liste des tâches.
 */
export async function avecLiens<T extends TacheReliable>(userId: string, taches: T[], deps: DepsLiens = depsParDefaut): Promise<Array<T & { lien?: LienFil | null }>> {
  if (!deps.filActif(userId) || taches.length === 0) return taches;
  try {
    const carte = await deps.charger(userId, await deps.depuis(userId));
    return taches.map((t) => ({ ...t, lien: lienDeTache(carte, t) }));
  } catch (e: any) {
    console.error("[fil] liens des tâches :", e?.message ?? e);
    return taches;
  }
}
