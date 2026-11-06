/**
 * Salves : un groupe de NOUVEAUX prospects, ouvert par un clic, étalé sur plusieurs jours.
 *
 * Demande de Jeanne : partir par lots maîtrisés plutôt que 20 mails en deux heures. Une salve
 * ne remplace ni la validation ni le robot : elle choisit QUI entre en séquence et QUAND
 * (`nextRunAt`). Les relances suivent ensuite la séquence, hors du décompte de la salve.
 * Aucun minuteur n'ouvre une salve : un message part parce qu'une personne l'a voulu.
 *
 * Un prospect refusé ou bloqué réduit la salve. Personne ne prend sa place en silence.
 *
 * Les accès au stockage sont injectés pour que la règle se teste sans base.
 */
import { peutEtreContacte } from "./prospection-validation";

export const SALVE_NOMBRE_MAX = 100;
export const SALVE_PAR_JOUR_MAX = 30;

/** Raison visible dans l'aperçu après l'arrêt d'une salve. */
export const RAISON_SALVE_ARRETEE =
  "Cette salve a été arrêtée : séquence en pause, rien n'est envoyé. Ajoute ce prospect à la séquence pour reprendre.";

/** Avec moins d'une heure ouvrée devant soi, la salve commence le jour ouvré suivant. */
const FENETRE_MINIMALE_MIN = 60;
const JOURS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const JOUR_MS = 86_400_000;
const MINUTE_MS = 60_000;
/** Borne de sûreté : un an de jours parcourus suffit à toute salve permise. */
const JOURS_PARCOURUS_MAX = 366;

export interface EntreePlan {
  nombre: number;
  parJour: number;
  maintenant: Date;
  /** Minute et jour locaux de l'utilisatrice à l'instant `maintenant`. */
  nowMin: number;
  jour: string;
  debutMin: number;
  finMin: number;
  joursOuvres: Set<string>;
}

/**
 * Les instants d'envoi, répartis dans les heures ouvrées de chaque jour. PURE.
 * Calculés par décalage depuis `maintenant` : un changement d'heure décale l'envoi d'une
 * heure au pire, et le robot revérifie la fenêtre avant d'envoyer.
 */
export function planifierSalve(e: EntreePlan): Date[] {
  const dates: Date[] = [];
  if (e.joursOuvres.size === 0 || e.finMin <= e.debutMin) return dates;
  const indexDuJour = Math.max(0, JOURS.indexOf(e.jour));

  for (let decalage = 0; dates.length < e.nombre && decalage < JOURS_PARCOURUS_MAX; decalage++) {
    if (!e.joursOuvres.has(JOURS[(indexDuJour + decalage) % 7])) continue;
    const debut = decalage === 0 ? Math.max(e.debutMin, e.nowMin) : e.debutMin;
    const libre = e.finMin - debut;
    if (libre < FENETRE_MINIMALE_MIN) continue;
    const places = Math.min(e.parJour, e.nombre - dates.length);
    for (let i = 0; i < places; i++) {
      const minute = debut + (i * libre) / places;
      dates.push(new Date(e.maintenant.getTime() + decalage * JOUR_MS + (minute - e.nowMin) * MINUTE_MS));
    }
  }
  return dates;
}

export interface ProspectDeSalve {
  id: number;
  stage: string | null | undefined;
  validatedAt: Date | null | undefined;
  priority: string | null | undefined;
  tags: string[] | null | undefined;
  createdAt: Date | null | undefined;
}

const RANG_PRIORITE: Record<string, number> = { hot: 0, warm: 1 };
const rang = (l: ProspectDeSalve) => RANG_PRIORITE[l.priority ?? ""] ?? 2;

/**
 * Les prospects de la salve : validés et JAMAIS entrés en séquence. Une séquence en pause a
 * sa raison (un collègue a répondu, un doublon, un retrait à la main) : c'est à Jeanne de la
 * reprendre, une salve ne la balaie pas.
 */
export async function choisirProspects<T extends ProspectDeSalve>(e: {
  leads: T[];
  nombre: number;
  getState: (leadId: number) => Promise<{ status: string } | null | undefined>;
  estTest?: (lead: T) => boolean;
}): Promise<T[]> {
  const ordre = [...e.leads].sort(
    (a, b) => rang(a) - rang(b) || (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0),
  );
  const choisis: T[] = [];
  for (const lead of ordre) {
    if (choisis.length >= e.nombre) break;
    if (!peutEtreContacte(lead) || e.estTest?.(lead)) continue;
    if (await e.getState(lead.id)) continue;
    choisis.push(lead);
  }
  return choisis;
}

export interface ResultatSalve {
  salveId: number | null;
  programmes: number;
  ignores: number;
  premierEnvoi: Date | null;
  dernierEnvoi: Date | null;
}

export async function lancerSalve(e: {
  prospects: { id: number }[];
  plan: Date[];
  creer: () => Promise<{ id: number }>;
  enroll: (leadId: number, opts: { salveId: number; nextRunAt: Date }) => Promise<unknown>;
  supprimer: (salveId: number) => Promise<unknown>;
}): Promise<ResultatSalve> {
  const candidats = e.prospects.slice(0, e.plan.length);
  if (candidats.length === 0) {
    return { salveId: null, programmes: 0, ignores: 0, premierEnvoi: null, dernierEnvoi: null };
  }
  const salve = await e.creer();
  const utilisees: Date[] = [];
  for (const prospect of candidats) {
    const nextRunAt = e.plan[utilisees.length];
    if (await e.enroll(prospect.id, { salveId: salve.id, nextRunAt })) utilisees.push(nextRunAt);
  }
  if (utilisees.length === 0) {
    await e.supprimer(salve.id);
    return { salveId: null, programmes: 0, ignores: candidats.length, premierEnvoi: null, dernierEnvoi: null };
  }
  return {
    salveId: salve.id,
    programmes: utilisees.length,
    ignores: candidats.length - utilisees.length,
    premierEnvoi: utilisees[0],
    dernierEnvoi: utilisees[utilisees.length - 1],
  };
}

export interface EtatDansSalve {
  status: string;
  lastStepSentAt: Date | null;
  repliedAt: Date | null;
  nextRunAt: Date | null;
}

export interface BilanSalve {
  prevus: number;
  partis: number;
  reponses: number;
  enAttente: number;
  /** Rien n'est parti et rien ne partira sans une action de Jeanne. */
  bloques: number;
  prochainEnvoi: Date | null;
}

const ETATS_EN_ATTENTE = new Set(["active", "awaiting_linkedin"]);

export function bilanDeSalve(etats: EtatDansSalve[]): BilanSalve {
  const partis = etats.filter((e) => e.lastStepSentAt).length;
  const attente = etats.filter((e) => !e.lastStepSentAt && ETATS_EN_ATTENTE.has(e.status));
  const prochain = etats
    .filter((e) => e.nextRunAt && ETATS_EN_ATTENTE.has(e.status))
    .map((e) => e.nextRunAt!.getTime())
    .sort((a, b) => a - b)[0];
  return {
    prevus: etats.length,
    partis,
    reponses: etats.filter((e) => e.repliedAt).length,
    enAttente: attente.length,
    bloques: etats.length - partis - attente.length,
    prochainEnvoi: prochain === undefined ? null : new Date(prochain),
  };
}
