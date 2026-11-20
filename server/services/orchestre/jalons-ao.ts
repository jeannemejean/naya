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
  // Plus aucun jour travaillé d'ici la date limite : rien à poser (un jour non travaillé serait refusé).
  if (plancher > jourLimite || !estTravaille(plancher)) return [];
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
  scheduledDate?: string | null;
  actionData: unknown;
}

type Attendu = JalonPlanifie & { aoId: number };

const cleDeTache = (t: TacheAO): string | null => {
  const a = (t.actionData as any)?.ao;
  if (!a || typeof a.id !== "number" || typeof a.jalon !== "string") return null;
  return cleJalon(a.id, a.jalon, typeof a.partie === "number" ? a.partie : undefined);
};

/** Marque posée sur une tâche archivée par la synchro (et non par l'utilisatrice). */
export const MARQUE_ARCHIVE = "archiveParSynchro";

/**
 * Ce qu'il faut créer, archiver, rouvrir, ré-échéancer et replacer.
 * - Une tâche cochée, ou archivée par l'utilisatrice, compte comme existante : jamais recréée ni touchée.
 * - Archivée par la synchro (statut avancé puis revenu) : rouverte.
 * - Ouverte en double sur une même clé : les suivantes sont archivées.
 * - Ouverte en retard (avant aujourd'hui) ou planifiée après son échéance : replacée au jour prévu
 *   (la reprise ne touche pas aux jalons d'AO : c'est ici qu'ils reviennent).
 */
export function planDeSynchro(attendus: Attendu[], existantes: TacheAO[], aujourdhui: string) {
  const ouverte = (t: TacheAO) => !t.completed && !t.archivedAt;
  const parCle = new Map<string, TacheAO>();
  const doublons: number[] = [];
  for (const t of existantes) {
    const c = cleDeTache(t);
    if (!c) continue;
    const deja = parCle.get(c);
    if (!deja) { parCle.set(c, t); continue; }
    // On garde une ouverte de préférence ; une ouverte en trop est un doublon.
    if (ouverte(t) && ouverte(deja)) doublons.push(t.id);
    else if (ouverte(t)) parCle.set(c, t);
  }
  const cles = new Set(attendus.map((a) => cleJalon(a.aoId, a.jalon, a.partie)));

  const aCreer = attendus.filter((a) => !parCle.has(cleJalon(a.aoId, a.jalon, a.partie)));
  const aArchiver = [
    ...existantes.filter((t) => ouverte(t) && !doublons.includes(t.id) && !cles.has(cleDeTache(t) ?? "")).map((t) => t.id),
    ...doublons,
  ];
  const aModifier: { id: number; echeance: string }[] = [];
  const aRouvrir: { id: number; echeance: string; jour: string }[] = [];
  const aReplacer: { id: number; jour: string }[] = [];
  for (const a of attendus) {
    const t = parCle.get(cleJalon(a.aoId, a.jalon, a.partie));
    if (!t || t.completed) continue;
    if (t.archivedAt) {
      if ((t.actionData as any)?.[MARQUE_ARCHIVE] === true) aRouvrir.push({ id: t.id, echeance: a.echeance, jour: a.jourPlanifie });
      continue;
    }
    if ((t.actionData as any)?.echeanceDure !== a.echeance) aModifier.push({ id: t.id, echeance: a.echeance });
    if (t.scheduledDate && (t.scheduledDate < aujourdhui || t.scheduledDate > a.echeance)) aReplacer.push({ id: t.id, jour: a.jourPlanifie });
  }
  return { aCreer, aArchiver, aModifier, aRouvrir, aReplacer };
}

export interface DepsJalonsAO {
  listerAO(userId: string): Promise<AOJalonnable[]>;
  /** Toutes les tâches `source = appel_offres` de l'utilisatrice, cochées et archivées comprises. */
  tachesAO(userId: string): Promise<TacheAO[]>;
  estTravaille(userId: string): Promise<(jour: string) => boolean>;
  /** La tâche créée (id et jour où le moteur de créneaux l'a posée), ou null si refusée. */
  creer(userId: string, donnees: Record<string, any>): Promise<{ id: number; scheduledDate: string | null } | null>;
  /** Archive et pose la marque MARQUE_ARCHIVE. */
  archiver(userId: string, id: number): Promise<void>;
  /** Pose la nouvelle échéance dure (actionData.echeanceDure, dueDate fin du jour). */
  reEcheancer(userId: string, id: number, echeance: string): Promise<void>;
  /** Désarchive, retire la marque, pose l'échéance et le jour (heure laissée au re-tassage). */
  rouvrir(userId: string, id: number, echeance: string, jour: string): Promise<void>;
  /** Pose le jour, heure laissée au re-tassage. */
  replacer(userId: string, id: number, jour: string): Promise<void>;
}

export async function synchroniserJalonsAO(userId: string, maintenant: Date, deps: DepsJalonsAO) {
  const aujourdhui = parisTodayString(maintenant);
  const [aos, existantes, estTravaille] = await Promise.all([deps.listerAO(userId), deps.tachesAO(userId), deps.estTravaille(userId)]);
  const parId = new Map(aos.map((a) => [a.id, a]));
  const attendus: Attendu[] = aos.flatMap((ao) => jalonsDe(ao, aujourdhui, estTravaille).map((j) => ({ aoId: ao.id, ...j })));
  const plan = planDeSynchro(attendus, existantes, aujourdhui);

  // Chaque écriture est isolée : une erreur est consignée et n'arrête pas les suivantes.
  const sur = async (quoi: string, f: () => Promise<unknown>) => {
    try { await f(); return true; } catch (e: any) {
      console.error(`[orchestre] jalons AO, ${quoi} user=${userId} :`, e?.message);
      return false;
    }
  };
  let crees = 0;
  let replacees = 0;
  for (const a of plan.aCreer) {
    const ao = parId.get(a.aoId)!;
    await sur(`création ${a.jalon}`, async () => {
      const t = await deps.creer(userId, {
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
      if (!t) return;
      crees++;
      // Journée pleine : le moteur de créneaux a pu la pousser après son échéance. Ramenée au
      // jour prévu ; le re-tassage la place (échéance dure : elle force sa place).
      if (t.scheduledDate && t.scheduledDate > a.echeance) { await deps.replacer(userId, t.id, a.jourPlanifie); replacees++; }
    });
  }
  let archivees = 0;
  for (const id of plan.aArchiver) if (await sur("archivage", () => deps.archiver(userId, id))) archivees++;
  let reEcheancees = 0;
  for (const m of plan.aModifier) if (await sur("échéance", () => deps.reEcheancer(userId, m.id, m.echeance))) reEcheancees++;
  let rouvertes = 0;
  for (const r of plan.aRouvrir) if (await sur("réouverture", () => deps.rouvrir(userId, r.id, r.echeance, r.jour))) rouvertes++;
  for (const r of plan.aReplacer) if (await sur("replacement", () => deps.replacer(userId, r.id, r.jour))) replacees++;
  const bilan = { crees, archivees, reEcheancees, rouvertes, replacees };
  if (Object.values(bilan).some((n) => n > 0)) console.log(`[orchestre] jalons AO user=${userId}`, bilan);
  return bilan;
}
