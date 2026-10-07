// Helpers purs de l'écran « Repenser la campagne » (contrat : task-3-report, « Fix round 1 »).

export const REPENSER_POLL_MS = 3000;
export const REPENSER_DELAI_MAX_MS = 15 * 60 * 1000;
export const REPENSER_CONSIGNE_MAX = 1000;

export interface ApercuRepenser {
  postsRemplaces: number;
  postsConserves: number;
  tachesRemplacees: number;
  tachesConservees: number;
}

export interface ResultatRepenser {
  postsCrees: number;
  tachesCreees: number;
  postsSupprimes: number;
  tachesSupprimees: number;
}

export type ErreurRepenser = { code: string; [k: string]: unknown };

export interface EtatRepenser {
  etat: "aucun" | "en_cours" | "termine" | "echec";
  debut?: string;
  fin?: string;
  resultat?: ResultatRepenser;
  erreur?: ErreurRepenser;
}

export const STATUTS_REPENSABLES = ["draft", "active", "paused"] as const;

export function campagneRepensable(statut: string | null | undefined): boolean {
  return !!statut && (STATUTS_REPENSABLES as readonly string[]).includes(statut);
}

/** Clé i18n (sous `campaigns.repenser.erreurs.`) pour une erreur d'état « echec ». */
export function cleErreurEtat(erreur: { code?: string } | null | undefined): string {
  switch (erreur?.code) {
    case "generation_echouee":
    case "placement_echoue":
    case "deja_en_cours":
      return erreur.code;
    default:
      return "generique";
  }
}

/** Code `message` du corps d'une réponse d'erreur du POST (`apiRequest` lève « 409: {json} »). */
export function codeErreurPost(err: unknown): string | null {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  const m = /^\d{3}: ([\s\S]*)$/.exec(msg);
  if (!m) return null;
  try {
    const corps = JSON.parse(m[1]);
    return typeof corps?.message === "string" ? corps.message : null;
  } catch {
    return null;
  }
}

/** Clé i18n (sous `campaigns.repenser.erreurs.`) pour un échec du POST. */
export function cleErreurPost(err: unknown): string {
  const code = codeErreurPost(err);
  switch (code) {
    case "deja_en_cours":
    case "consigne_trop_longue":
    case "statut_incompatible":
      return code;
    default:
      return "generique";
  }
}

export function delaiDepasse(debutMs: number, maintenantMs: number): boolean {
  return maintenantMs - debutMs > REPENSER_DELAI_MAX_MS;
}

/** Intervalle de relecture : seulement tant que le travail est en cours. */
export function intervalleRelecture(etat: EtatRepenser["etat"] | undefined): number | false {
  return etat === "en_cours" ? REPENSER_POLL_MS : false;
}
