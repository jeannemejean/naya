// Helpers purs de l'écran « Repenser la campagne » (contrat : task-3-report, « Fix round 1 »).

export const REPENSER_POLL_MS = 3000;
export const REPENSER_DELAI_MAX_MS = 15 * 60 * 1000;
export const REPENSER_CONSIGNE_MAX = 1000;

export interface ApercuRepenser {
  postsRemplaces: number;
  postsConserves: number;
  tachesRemplacees: number;
  tachesConservees: number;
  /** Où iront les nouveaux posts et tâches : `lancement` (brouillon : au lancement),
   *  `reprise` (en pause : rien n'est placé, la reprise placera les tâches), `maintenant`
   *  (active). Indicatif : le serveur décide sur l'état de la campagne au moment d'écrire. */
  placement?: "lancement" | "reprise" | "maintenant";
}

export interface ResultatRepenser {
  postsCrees: number;
  tachesCreees: number;
  postsSupprimes: number;
  tachesSupprimees: number;
}

export type ErreurRepenser = { code: string; [k: string]: unknown };

export type EtapeRepenser = "contexte" | "strategie" | "contenu" | "taches" | "enregistrement" | "placement";

export interface EtatRepenser {
  etat: "aucun" | "en_cours" | "termine" | "echec";
  debut?: string;
  etape?: EtapeRepenser;
  etapeDepuis?: string;
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
    case "statut_incompatible":
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

/** Tolérance d'écart d'horloge entre le navigateur et le serveur. */
export const REPENSER_TOLERANCE_HORLOGE_MS = 60 * 1000;

/**
 * Un résultat `termine`/`echec` n'est celui du travail lancé que si son `debut` n'est pas
 * antérieur au lancement (aux écarts d'horloge près). Sans `debut`, on l'accepte.
 */
export function resultatAcceptable(etat: Pick<EtatRepenser, "debut">, lanceMs: number): boolean {
  if (!etat.debut) return true;
  const debut = Date.parse(etat.debut);
  if (Number.isNaN(debut)) return true;
  return debut >= lanceMs - REPENSER_TOLERANCE_HORLOGE_MS;
}

/** Relecture : seulement si le suivi n'est pas abandonné et que le travail est en cours. */
export function intervalleSuivi(
  etat: EtatRepenser["etat"] | undefined,
  abandonne: boolean,
): number | false {
  return abandonne ? false : intervalleRelecture(etat);
}

/** Faut-il (re)prendre le suivi à l'ouverture ? Jamais après abandon. */
export function doitReprendreSuivi(p: {
  open: boolean; suivi: boolean; abandonne: boolean; etat: EtatRepenser["etat"] | undefined; enVol: boolean;
}): boolean {
  return p.open && !p.suivi && !p.abandonne && p.etat === "en_cours" && !p.enVol;
}

/**
 * Pendant le suivi, `aucun` veut dire que le travail a été perdu : le registre est en
 * mémoire et un redémarrage du serveur l'efface (le POST a répondu 202, l'entrée
 * `en_cours` existait donc). Le suivi s'arrête et on prévient.
 */
export function suiviPerdu(suivi: boolean, etat: EtatRepenser["etat"] | undefined): boolean {
  return suivi && etat === "aucun";
}

/** Clé i18n (sous `campaigns.repenser.`) de la ligne d'aperçu qui dit où iront les nouveautés. */
export function clePlacementApercu(placement: ApercuRepenser["placement"]): string | null {
  switch (placement) {
    case "lancement": return "previewPlacementLancement";
    case "reprise": return "previewPlacementReprise";
    default: return null;
  }
}

// ─── Progression ─────────────────────────────────────────────────────────────
// L'étape vient du serveur (vraie progression) ; À L'INTÉRIEUR d'une étape, la barre
// avance doucement selon la durée habituelle de l'étape, sans jamais atteindre l'étape
// suivante (plafond 90 % du segment) — elle bouge donc toujours, sans mentir.

export const ETAPES_REPENSER: { etape: EtapeRepenser; poids: number; dureeTypiqueS: number }[] = [
  { etape: "contexte", poids: 5, dureeTypiqueS: 5 },
  { etape: "strategie", poids: 30, dureeTypiqueS: 60 },
  { etape: "contenu", poids: 35, dureeTypiqueS: 70 },
  { etape: "taches", poids: 20, dureeTypiqueS: 50 },
  { etape: "enregistrement", poids: 4, dureeTypiqueS: 5 },
  { etape: "placement", poids: 6, dureeTypiqueS: 15 },
];

export function progressionRepenser(
  etape: EtapeRepenser | undefined,
  etapeDepuisMs: number | undefined,
  maintenantMs: number,
): { pourcent: number; index: number; total: number } {
  const total = ETAPES_REPENSER.length;
  const idx = Math.max(0, ETAPES_REPENSER.findIndex((e) => e.etape === (etape ?? "contexte")));
  const somme = ETAPES_REPENSER.reduce((a, e) => a + e.poids, 0);
  const avant = ETAPES_REPENSER.slice(0, idx).reduce((a, e) => a + e.poids, 0);
  const courante = ETAPES_REPENSER[idx];
  const ecouleS = etapeDepuisMs !== undefined ? Math.max(0, (maintenantMs - etapeDepuisMs) / 1000) : 0;
  const fraction = Math.min(0.9, 1 - Math.exp(-ecouleS / courante.dureeTypiqueS));
  const pourcent = Math.round(((avant + courante.poids * fraction) / somme) * 100);
  return { pourcent: Math.min(99, Math.max(1, pourcent)), index: idx, total };
}

/** « 45 s », « 2 min 05 s ». */
export function dureeEcoulee(depuisMs: number | undefined, maintenantMs: number): { min: number; s: string } {
  const total = depuisMs !== undefined ? Math.max(0, Math.floor((maintenantMs - depuisMs) / 1000)) : 0;
  return { min: Math.floor(total / 60), s: String(total % 60).padStart(2, "0") };
}
