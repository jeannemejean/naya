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

const DELAI_ECRITURE_MS = 5000;
const INTERVALLE_DEBUT_MS = 5 * 60_000;
const dernierDebutEcrit = new Map<NomTacheFond, number>();

/** Pour les tests. */
export function _reinitialiserEtatTachesFond(): void { dernierDebutEcrit.clear(); }

// Un échec d'écriture de l'état est journalisé et avalé : il ne doit jamais faire échouer la
// tâche. Bornée à quelques secondes : un pool bloqué ne retarde pas la suite.
async function noter(nom: NomTacheFond, valeurs: Partial<typeof etatTachesFond.$inferInsert>): Promise<void> {
  let minuterie: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      db.insert(etatTachesFond).values({ nom, ...valeurs })
        .onConflictDoUpdate({ target: etatTachesFond.nom, set: valeurs }),
      new Promise<never>((_, rejeter) => { minuterie = setTimeout(() => rejeter(new Error("écriture trop lente")), DELAI_ECRITURE_MS); }),
    ]);
  } catch (e) {
    console.error(`[etat-taches-fond] ${nom} :`, messageDe(e));
  } finally {
    if (minuterie) clearTimeout(minuterie);
  }
}

/**
 * Exécute `fn` en notant son début, puis son succès ou son erreur. Renvoie la valeur de `fn` et
 * relance son erreur telle quelle, après l'avoir notée.
 */
export async function suivrePassage<T>(nom: NomTacheFond, fn: () => Promise<T>): Promise<T> {
  // Le début s'écrit en parallèle : `fn` démarre tout de suite, sans attendre la base. Les
  // écritures suivantes l'attendent, pour que le succès ne soit jamais écrasé par le début.
  // Pas plus d'une écriture de début toutes les 5 minutes par tâche (l'envoi passe chaque minute).
  const maintenant = Date.now();
  const dernier = dernierDebutEcrit.get(nom);
  let debut: Promise<void> = Promise.resolve();
  if (dernier === undefined || maintenant - dernier >= INTERVALLE_DEBUT_MS) {
    dernierDebutEcrit.set(nom, maintenant);
    debut = noter(nom, { dernierDebut: new Date(maintenant) });
  }
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

/** Début du suivi : le plus ancien `dernierDebut` connu (null s'il n'y a aucune ligne). */
export function debutDuSuivi(etats: EtatTacheFond[]): Date | null {
  const t = etats.map((e) => (e.dernierDebut ? new Date(e.dernierDebut).getTime() : NaN)).filter((n) => !isNaN(n));
  return t.length ? new Date(Math.min(...t)) : null;
}

/**
 * Les tâches en panne : pas de succès depuis la tolérance, ou une erreur plus récente que le
 * dernier succès. Une tâche sans succès connu n'est en panne qu'une fois la tolérance écoulée
 * depuis `debutSuivi` (sinon, juste après un déploiement, tout serait en panne) ; sans
 * `debutSuivi`, rien n'est reproché. La veille AO n'est attendue que si des utilisatrices y
 * sont inscrites.
 */
export function pannes(
  etats: EtatTacheFond[], maintenant: Date, veilleAOAttendue: boolean = utilisatricesVeilleAO().length > 0,
  debutSuivi: Date | null = null,
): { nom: string; dernierSucces: string | null }[] {
  const res: { nom: string; dernierSucces: string | null }[] = [];
  for (const nom of Object.keys(ATTENDUS) as NomTacheFond[]) {
    if (nom === "veille_ao" && !veilleAOAttendue) continue;
    const etat = etats.find((e) => e.nom === nom);
    const succes = etat?.dernierSucces ? new Date(etat.dernierSucces) : null;
    const erreur = etat?.derniereErreurAt ? new Date(etat.derniereErreurAt) : null;
    const reference = succes ?? debutSuivi;
    const enRetard = !!reference && maintenant.getTime() - reference.getTime() > ATTENDUS[nom].tolereMinutes * 60_000;
    const enErreur = !!erreur && (!succes || erreur.getTime() > succes.getTime());
    if (enRetard || enErreur) res.push({ nom: ATTENDUS[nom].libelle, dernierSucces: succes ? succes.toISOString() : null });
  }
  return res;
}
