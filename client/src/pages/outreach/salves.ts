import { estPretAPartir, type ProspectValidable } from './validation-messages';
import { estLeadTest } from './mode-test';

/** Valeurs proposées à l'ouverture d'une salve. */
export const SALVE_NOMBRE_DEFAUT = 20;
export const SALVE_PAR_JOUR_DEFAUT = 5;
/** Plafond du serveur (`SALVE_PAR_JOUR_MAX`, server/services/prospection-salves.ts). */
export const SALVE_PAR_JOUR_MAX = 30;

/** Une saisie libre ramenée entre 0 et `max` : vide ou illisible vaut 0, le bouton se désactive. */
export function nombreBorne(saisie: string, max: number): number {
  const n = Math.floor(Number(saisie));
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), max) : 0;
}

export function joursNecessaires(nombre: number, parJour: number): number {
  return parJour > 0 ? Math.ceil(nombre / parJour) : 0;
}

export function dateCourte(iso: string, langue: string): string {
  return new Date(iso).toLocaleDateString(langue, { weekday: 'short', day: 'numeric', month: 'short' });
}

/** Plafond du serveur (`SALVE_NOMBRE_MAX`, server/services/prospection-salves.ts). */
export const SALVE_NOMBRE_MAX = 100;

/** Plafond du serveur (`ENROLEMENT_DIRECT_MAX`) : au-delà, « Ajouter la sélection » passe par une salve. */
export const ENROLEMENT_DIRECT_MAX = 5;

type ProspectCompte = Pick<ProspectValidable, 'id' | 'stage' | 'validatedAt' | 'archivedAt'> & { tags?: string[] | null };
type EnSequence = { has: (id: number) => boolean };

const estPretPourSalve = (l: ProspectCompte, dejaEnSequence: EnSequence) =>
  estPretAPartir(l) && !estLeadTest(l) && !dejaEnSequence.has(l.id);

/** Ce qu'une salve peut prendre : validés, jamais entrés en séquence, hors prospects test. */
export function compterPrets(prospects: ProspectCompte[], dejaEnSequence: EnSequence): number {
  return prospects.filter((l) => estPretPourSalve(l, dejaEnSequence)).length;
}

export type AjoutSelection =
  | { mode: 'direct' }
  | { mode: 'salve'; idsPrets: number[]; nonValides: number; dejaEnSequence: number };

/**
 * « Ajouter la sélection à la séquence » : jusqu'à 5 prospects, ajout direct ; au-delà, une salve
 * prend exactement les prospects prêts de la sélection (au plus SALVE_NOMBRE_MAX, comme le serveur).
 */
export function ajoutSelection(selection: number[], prospects: ProspectCompte[], dejaEnSequence: EnSequence): AjoutSelection {
  const choisis = new Set(selection);
  if (choisis.size <= ENROLEMENT_DIRECT_MAX) return { mode: 'direct' };
  const selectionnes = prospects.filter((l) => choisis.has(l.id));
  const idsPrets = selectionnes
    .filter((l) => estPretPourSalve(l, dejaEnSequence))
    .map((l) => l.id)
    .slice(0, SALVE_NOMBRE_MAX);
  const valides = selectionnes.filter((l) => estPretAPartir(l) && !estLeadTest(l));
  return {
    mode: 'salve',
    idsPrets,
    nonValides: selectionnes.length - valides.length,
    // Validés mais déjà en séquence (en cours ou en pause) : une salve ne les reprend pas.
    dejaEnSequence: valides.filter((l) => dejaEnSequence.has(l.id)).length,
  };
}

/**
 * Pourquoi une sélection de plus de 5 ne donne aucune salve. Les pauses se reprennent par 5 au
 * plus (ajout direct) : pas de rafale, même pour reprendre.
 */
export function raisonsSelectionVide(a: { nonValides: number; dejaEnSequence: number }): ('selectionVide' | 'selectionEnSequence')[] {
  const raisons: ('selectionVide' | 'selectionEnSequence')[] = [];
  if (a.nonValides > 0) raisons.push('selectionVide');
  if (a.dejaEnSequence > 0) raisons.push('selectionEnSequence');
  return raisons.length ? raisons : ['selectionVide'];
}

/** « Lancer en salve » : la salve proposée prend tous les prêts, dans la limite du serveur. */
export function nombrePrerempli(prets: number): number {
  return Math.max(0, Math.min(Math.floor(prets), SALVE_NOMBRE_MAX));
}

export type RaisonSalveImpossible = 'sansSequence' | 'campagneInactive' | 'aucunPret' | null;

/** Le bouton « Lancer en salve » est grisé, avec sa raison, quand rien ne peut partir. */
export function raisonSalveImpossible(e: { hasSequence: boolean; prets: number; campagneActive: boolean }): RaisonSalveImpossible {
  if (!e.hasSequence) return 'sansSequence';
  // Le serveur refuse une salve sur une campagne en pause (409 campagne_inactive).
  if (!e.campagneActive) return 'campagneInactive';
  if (e.prets <= 0) return 'aucunPret';
  return null;
}

/** Clé du message d'erreur d'une salve, lue dans l'erreur d'apiRequest (« 409: {"message":…} »). */
export function cleErreurSalve(err: unknown): 'campagneInactive' | 'sansSequence' | 'erreur' {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  try {
    const code = JSON.parse(msg.replace(/^\d{3}:\s*/, ''))?.message;
    if (code === 'campagne_inactive') return 'campagneInactive';
    if (code === 'no_sequence_defined') return 'sansSequence';
  } catch { /* corps non JSON */ }
  return 'erreur';
}
