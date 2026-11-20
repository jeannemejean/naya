// Étape 2 du chef d'orchestre (spec 2026-11-19-chef-d-orchestre-design.md, « Étape 2 ») : un appel
// d'offres en rédaction pose ses jalons dans le calendrier, rétro-planifiés depuis la date limite,
// avec un jour travaillé de tampon ; un AO « premier jet prêt » pose UNE décision. Chaque jalon
// porte une échéance DURE (`actionData.echeanceDure`) : le re-tassage la respecte (contrainte.ts).
//
// `jalonsDe` et `planDeSynchro` sont purs ; `synchroniserJalonsAO` lit et écrit par ses deps.
import { parisTodayString, wallClockToInstant } from "../../utils/timezone";

export const SOURCE_AO = "appel_offres";
export const TASK_TYPE_AO = "ao_jalon";
export const PARTIE_REDACTION_MIN = 120;
const LONGUEUR_OBJET = 60;

export type Jalon = "decision" | "analyse" | "redaction" | "pieces" | "relecture" | "depot";

export interface AOJalonnable {
  id: number;
  objet: string;
  statut: string;
  procedure?: string | null;
  dateLimite: Date | string | null;
  lienAvis?: string | null;
  projectId?: number | null;
}

export interface JalonPlanifie {
  jalon: Jalon;
  partie?: number;
  titre: string;
  description: string;
  duree: number;
  energie: "deep_work" | "admin";
  /** Échéance dure (YYYY-MM-DD). */
  echeance: string;
  /** Jour où la tâche est posée : un jour travaillé avant l'échéance (borné au plancher). */
  jourPlanifie: string;
}

const plus = (jour: string, n: number) => {
  const d = new Date(`${jour}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const travailleAvant = (jour: string, estTravaille: (j: string) => boolean) => {
  let j = plus(jour, -1);
  for (let i = 0; i < 14 && !estTravaille(j); i++) j = plus(j, -1);
  return j;
};
const travailleDesLe = (jour: string, estTravaille: (j: string) => boolean) => {
  let j = jour;
  for (let i = 0; i < 14 && !estTravaille(j); i++) j = plus(j, 1);
  return j;
};

const objetCourt = (objet: string) => {
  const o = objet.trim().replace(/\s+/g, " ");
  return o.length > LONGUEUR_OBJET ? `${o.slice(0, LONGUEUR_OBJET - 1)}…` : o;
};

/** Minutes de rédaction du mémoire selon la procédure. */
export function minutesRedaction(procedure: string | null | undefined): number {
  return procedure === "Appel d'offres ouvert" || procedure === "Concours" ? 480 : 240;
}

/**
 * Les jalons attendus pour un AO, aujourd'hui. Vide si la date limite est passée ou absente, ou si
 * le statut ne demande rien (repéré, déposé, gagné, perdu, écarté).
 */
export function jalonsDe(ao: AOJalonnable, aujourdhui: string, estTravaille: (j: string) => boolean): JalonPlanifie[] {
  if (ao.statut !== "en_redaction" && ao.statut !== "premier_jet_pret") return [];
  if (!ao.dateLimite) return [];
  const limite = ao.dateLimite instanceof Date ? ao.dateLimite : new Date(ao.dateLimite);
  if (Number.isNaN(limite.getTime())) return [];
  const jourLimite = parisTodayString(limite);
  if (jourLimite < aujourdhui) return [];

  const plancher = travailleDesLe(aujourdhui, estTravaille);
  // Borné à [plancher, jour limite] : un AO pris tard se tasse, jamais avant aujourd'hui.
  const borne = (j: string) => (j < plancher ? (plancher > jourLimite ? jourLimite : plancher) : j);

  const depot = travailleAvant(jourLimite, estTravaille);
  const relecture = travailleAvant(depot, estTravaille);
  const nParties = Math.ceil(minutesRedaction(ao.procedure) / PARTIE_REDACTION_MIN);
  const parties: string[] = [];
  let j = relecture;
  for (let i = 0; i < nParties; i++) { j = travailleAvant(j, estTravaille); parties.unshift(j); }
  const analyse = travailleAvant(parties[0], estTravaille);

  const nom = `AO « ${objetCourt(ao.objet)} »`;
  const jalon = (jalon: Jalon, echeanceBrute: string, duree: number, titre: string, description: string,
    energie: JalonPlanifie["energie"], partie?: number): JalonPlanifie => {
    const echeance = borne(echeanceBrute);
    const veille = travailleAvant(echeance, estTravaille);
    const jourPlanifie = veille < plancher ? echeance : veille;
    return { jalon, ...(partie ? { partie } : {}), titre, description, duree, energie, echeance, jourPlanifie };
  };

  if (ao.statut === "premier_jet_pret") {
    return [jalon("decision", analyse, 15, `Décider : répondre à « ${objetCourt(ao.objet)} » ?`,
      "Le premier jet est prêt. Lire et décider : lancer la rédaction (statut « en rédaction ») ou écarter. Naya pose ensuite les étapes jusqu'au dépôt.",
      "admin")];
  }
  return [
    jalon("analyse", analyse, 45, `${nom} : analyser le DCE et lister les pièces`,
      "Lire le règlement de consultation et le CCTP, noter les critères et la liste des pièces exigées.", "deep_work"),
    ...parties.map((p, i) => jalon("redaction", p, PARTIE_REDACTION_MIN,
      `${nom} : rédiger le mémoire technique (partie ${i + 1}/${nParties})`,
      "Rédiger le mémoire technique à partir du premier jet, critère par critère.", "deep_work", i + 1)),
    jalon("pieces", relecture, 60, `${nom} : rassembler les pièces administratives`,
      "DC1, DC2 ou DUME, attestations, Kbis, références : tout ce que le règlement exige.", "admin"),
    jalon("relecture", relecture, 60, `${nom} : relire et finaliser l'offre`,
      "Relire le mémoire contre les critères, vérifier le prix et les pièces.", "deep_work"),
    jalon("depot", depot, 30, `${nom} : déposer l'offre`,
      "Déposer sur la plateforme de l'acheteur et garder l'accusé de dépôt. Un jour de marge avant la date limite.", "admin"),
  ];
}

export const cleJalon = (aoId: number, jalon: string, partie?: number | null) => `${aoId}:${jalon}:${partie ?? 0}`;

export interface TacheAO {
  id: number;
  completed: boolean | null;
  archivedAt: Date | string | null;
  actionData: unknown;
}

type Attendu = JalonPlanifie & { aoId: number };

const cleDeTache = (t: TacheAO): string | null => {
  const a = (t.actionData as any)?.ao;
  if (!a || typeof a.id !== "number" || typeof a.jalon !== "string") return null;
  return cleJalon(a.id, a.jalon, typeof a.partie === "number" ? a.partie : undefined);
};

/**
 * Ce qu'il faut créer, archiver et ré-échéancer. Une tâche cochée ou archivée compte comme
 * existante (jamais recréée) et n'est jamais touchée.
 */
export function planDeSynchro(attendus: Attendu[], existantes: TacheAO[]) {
  const parCle = new Map<string, TacheAO>();
  for (const t of existantes) { const c = cleDeTache(t); if (c) parCle.set(c, t); }
  const cles = new Set(attendus.map((a) => cleJalon(a.aoId, a.jalon, a.partie)));
  const ouverte = (t: TacheAO) => !t.completed && !t.archivedAt;

  const aCreer = attendus.filter((a) => !parCle.has(cleJalon(a.aoId, a.jalon, a.partie)));
  const aArchiver = existantes.filter((t) => ouverte(t) && !cles.has(cleDeTache(t) ?? "")).map((t) => t.id);
  const aModifier: { id: number; echeance: string }[] = [];
  for (const a of attendus) {
    const t = parCle.get(cleJalon(a.aoId, a.jalon, a.partie));
    if (t && ouverte(t) && (t.actionData as any)?.echeanceDure !== a.echeance) aModifier.push({ id: t.id, echeance: a.echeance });
  }
  return { aCreer, aArchiver, aModifier };
}

export interface DepsJalonsAO {
  listerAO(userId: string): Promise<AOJalonnable[]>;
  /** Toutes les tâches `source = appel_offres` de l'utilisatrice, cochées et archivées comprises. */
  tachesAO(userId: string): Promise<TacheAO[]>;
  estTravaille(userId: string): Promise<(jour: string) => boolean>;
  creer(userId: string, donnees: Record<string, unknown>): Promise<boolean>;
  archiver(userId: string, id: number): Promise<void>;
  /** Pose la nouvelle échéance dure (actionData.echeanceDure, dueDate fin du jour). */
  reEcheancer(userId: string, id: number, echeance: string): Promise<void>;
}

export async function synchroniserJalonsAO(userId: string, maintenant: Date, deps: DepsJalonsAO) {
  const aujourdhui = parisTodayString(maintenant);
  const [aos, existantes, estTravaille] = await Promise.all([deps.listerAO(userId), deps.tachesAO(userId), deps.estTravaille(userId)]);
  const parId = new Map(aos.map((a) => [a.id, a]));
  const attendus: Attendu[] = aos.flatMap((ao) => jalonsDe(ao, aujourdhui, estTravaille).map((j) => ({ aoId: ao.id, ...j })));
  const plan = planDeSynchro(attendus, existantes);

  let crees = 0;
  for (const a of plan.aCreer) {
    const ao = parId.get(a.aoId)!;
    const ok = await deps.creer(userId, {
      title: a.titre, description: a.description,
      type: "admin", category: "conversion", priority: a.jalon === "depot" || a.jalon === "decision" ? 1 : 2,
      estimatedDuration: a.duree, scheduledDate: a.jourPlanifie,
      dueDate: wallClockToInstant("Europe/Paris", a.echeance, "23:59"), taskEnergyType: a.energie,
      canBeFragmented: false, projectId: ao.projectId ?? null,
      source: SOURCE_AO, taskType: TASK_TYPE_AO, completed: false,
      actionData: {
        ao: { id: a.aoId, jalon: a.jalon, ...(a.partie ? { partie: a.partie } : {}) },
        echeanceDure: a.echeance, lien: "/appels-offres", ...(ao.lienAvis ? { externalUrl: ao.lienAvis } : {}),
      },
    });
    if (ok) crees++;
  }
  for (const id of plan.aArchiver) await deps.archiver(userId, id);
  for (const m of plan.aModifier) await deps.reEcheancer(userId, m.id, m.echeance);
  const bilan = { crees, archivees: plan.aArchiver.length, reEcheancees: plan.aModifier.length };
  if (crees || bilan.archivees || bilan.reEcheancees) console.log(`[orchestre] jalons AO user=${userId}`, bilan);
  return bilan;
}
