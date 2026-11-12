// Santé des tâches de fond de Naya (spec §3, lot 4) : chacune note dans `etat_taches_fond` son
// début, son succès ou son erreur ; le matin liste celles qui sont en retard ou en échec. Naya
// signale la panne, elle ne refait JAMAIS le travail de la tâche. La table est globale (le nom
// est la clé) : ces tâches tournent pour tout le monde.
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { etatTachesFond, type EtatTacheFond } from "@shared/schema";
import { utilisatricesVeilleAO } from "../veille-ao/etat";

export type NomTacheFond = "planificateur" | "veille_ao" | "envoi_prospection" | "revue_du_matin" | "indexeur";

/** Libellé affiché au matin et durée de silence tolérée avant de parler de retard. */
export const ATTENDUS: Record<NomTacheFond, { libelle: string; tolereMinutes: number }> = {
  planificateur: { libelle: "Le planificateur du matin", tolereMinutes: 26 * 60 },
  veille_ao: { libelle: "La veille des appels d'offres", tolereMinutes: 26 * 60 },
  envoi_prospection: { libelle: "L'envoi de prospection", tolereMinutes: 30 },
  revue_du_matin: { libelle: "La revue du matin", tolereMinutes: 26 * 60 },
  indexeur: { libelle: "L'indexeur de la recherche", tolereMinutes: 30 },
};

const messageDe = (e: unknown) => String((e as any)?.message ?? e).slice(0, 500);

// Un échec d'écriture de l'état est journalisé et avalé : il ne doit jamais faire échouer la tâche.
async function noter(nom: NomTacheFond, valeurs: Partial<typeof etatTachesFond.$inferInsert>): Promise<void> {
  try {
    await db.insert(etatTachesFond).values({ nom, ...valeurs })
      .onConflictDoUpdate({ target: etatTachesFond.nom, set: valeurs });
  } catch (e) {
    console.error(`[etat-taches-fond] ${nom} :`, messageDe(e));
  }
}

/**
 * Exécute `fn` en notant son début, puis son succès ou son erreur. Renvoie la valeur de `fn` et
 * relance son erreur telle quelle, après l'avoir notée.
 */
export async function suivrePassage<T>(nom: NomTacheFond, fn: () => Promise<T>): Promise<T> {
  // Le début s'écrit en parallèle : `fn` démarre tout de suite, sans attendre la base. Les
  // écritures suivantes l'attendent, pour que le succès ne soit jamais écrasé par le début.
  const debut = noter(nom, { dernierDebut: new Date() });
  try {
    const r = await fn();
    await debut;
    await noter(nom, { dernierSucces: new Date() });
    return r;
  } catch (e) {
    await debut;
    await noter(nom, { derniereErreur: messageDe(e), derniereErreurAt: new Date() });
    throw e;
  }
}

/** Les états enregistrés (lecture seule, pour le matin). */
export async function lireEtatsTachesFond(): Promise<EtatTacheFond[]> {
  return db.select().from(etatTachesFond);
}

/**
 * Les tâches en panne : pas de succès depuis la tolérance (ou jamais), ou une erreur plus récente
 * que le dernier succès. La veille AO n'est attendue que si des utilisatrices y sont inscrites.
 */
export function pannes(
  etats: EtatTacheFond[], maintenant: Date, veilleAOAttendue: boolean = utilisatricesVeilleAO().length > 0,
): { nom: string; dernierSucces: string | null }[] {
  const res: { nom: string; dernierSucces: string | null }[] = [];
  for (const nom of Object.keys(ATTENDUS) as NomTacheFond[]) {
    if (nom === "veille_ao" && !veilleAOAttendue) continue;
    const etat = etats.find((e) => e.nom === nom);
    const succes = etat?.dernierSucces ? new Date(etat.dernierSucces) : null;
    const erreur = etat?.derniereErreurAt ? new Date(etat.derniereErreurAt) : null;
    const enRetard = !succes || maintenant.getTime() - succes.getTime() > ATTENDUS[nom].tolereMinutes * 60_000;
    const enErreur = !!erreur && (!succes || erreur.getTime() > succes.getTime());
    if (enRetard || enErreur) res.push({ nom: ATTENDUS[nom].libelle, dernierSucces: succes ? succes.toISOString() : null });
  }
  return res;
}
