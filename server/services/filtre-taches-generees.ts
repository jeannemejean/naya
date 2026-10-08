// Filtre déterministe appliqué aux tâches produites par les générateurs GÉNÉRIQUES
// (journée, semaine, mois, objectif, jalon, auto-planner). PURE.
//
// Décision de Jeanne (9 octobre 2026) : le travail de contenu vient UNIQUEMENT du calendrier
// éditorial (chaque post y dérive ses propres tâches de production) et la prospection
// UNIQUEMENT du pipeline de prospection (qui pose ses tâches de vérification). Les générateurs
// génériques fabriquaient des tâches flottantes — « Draft DM outreach template… »,
// « Draft 3-part carousel… », « Identify 3 founders… » — sans lien avec un post ni un prospect.
//
// Les prompts le disent déjà ; ce filtre le GARANTIT, parce qu'une consigne ne suffit pas.
// Une journée qui s'amincit après filtrage reste mince : on ne comble pas avec du remplissage.

export type RaisonExclusion = "prospection" | "contenu";

export interface TacheFiltrable {
  title?: unknown;
  type?: unknown;
  workflowGroup?: unknown;
  taskType?: unknown;
}

// Frontières de mot compatibles avec les lettres accentuées (\b est ASCII en JS).
const mot = (alternatives: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives})(?![\\p{L}\\p{N}])`, "iu");
const suite = (avant: string, apres: string) =>
  new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${avant})(?![\\p{L}\\p{N}]).*(?<![\\p{L}\\p{N}])(?:${apres})(?![\\p{L}\\p{N}])`,
    "iu",
  );

const TYPES_PROSPECTION = new Set(["outreach", "prospection", "prospecting"]);
const TYPES_CONTENU = new Set(["content", "contenu"]);
const GROUPES_PROSPECTION = new Set(["prospection", "outreach"]);
const GROUPES_CONTENU = new Set(["content", "contenu"]);
const TASK_TYPES_PROSPECTION = new Set(["linkedin_message", "outreach_action"]);
const TASK_TYPES_CONTENU = new Set(["post_publish", "canva_task"]);

const MOTIFS_PROSPECTION: RegExp[] = [
  mot("dms?|outreach|cold[- ]?(?:e-?mails?|mails?|calls?)|prospect\\p{L}*|leads?|démarch\\p{L}*|demarch\\p{L}*"),
  mot("demandes? de connexion|connection requests?|invitations? linkedin|prises? de contact"),
  mot("messages? personnalisés?|personali[sz]ed messages?"),
  suite(
    "identif\\p{L}*|find|trouver|lister|list|repérer|reperer|cibler|target\\p{L}*|reach out",
    "founders?|fondat\\p{L}*|cmos?|ceos?|décideu\\p{L}*|decideu\\p{L}*|decision[- ]makers?|à contacter|to contact",
  ),
];

const MOTIFS_CONTENU: RegExp[] = [
  mot("carousels?|carrousels?|reels?|tiktoks?"),
  suite(
    "write|draft|create|publish|post|film|shoot|record|edit|schedule|rédiger|rediger|écrire|ecrire|créer|creer|publier|poster|préparer|preparer|programmer|tourner|filmer|monter|concevoir",
    "posts?|publications?|newsletters?|articles?|stories|story|vidéos?|videos?|scripts?|captions?|légendes?|visuels?|contenus?|content|threads?",
  ),
];

const normaliser = (v: unknown): string => (typeof v === "string" ? v.trim().toLowerCase() : "");

/** Groupe de workflow sans l'espace de noms « projet:: » posé par generate-daily. */
const groupe = (v: unknown): string => normaliser(v).replace(/^[^:]*::/, "");

/**
 * Pourquoi cette tâche générée doit être écartée (`prospection` / `contenu`), ou `null`
 * si elle reste. Un livrable client (workflowGroup « client ») n'est jamais écarté au titre
 * du contenu : c'est du travail facturé, pas de la visibilité. La prospection, elle, est
 * écartée partout.
 */
export function raisonExclusionGenerateur(t: TacheFiltrable | null | undefined): RaisonExclusion | null {
  if (!t) return null;
  const type = normaliser(t.type);
  const wg = groupe(t.workflowGroup);
  const taskType = normaliser(t.taskType);
  const titre = typeof t.title === "string" ? t.title : "";

  if (TYPES_PROSPECTION.has(type) || GROUPES_PROSPECTION.has(wg) || TASK_TYPES_PROSPECTION.has(taskType)) {
    return "prospection";
  }
  if (MOTIFS_PROSPECTION.some((m) => m.test(titre))) return "prospection";

  if (wg === "client") return null;

  if (TYPES_CONTENU.has(type) || GROUPES_CONTENU.has(wg) || TASK_TYPES_CONTENU.has(taskType)) {
    return "contenu";
  }
  if (MOTIFS_CONTENU.some((m) => m.test(titre))) return "contenu";

  return null;
}

/**
 * Rend les tâches à garder, dans l'ordre, sans copier les objets. `acces` lit la tâche
 * quand elle est enveloppée (ex. `{ taskData }` dans generate-daily). Journalise ce qui
 * est écarté.
 */
export function filtrerTachesGenerees<T>(
  taches: T[] | null | undefined,
  origine: string,
  acces: (t: T) => TacheFiltrable | null | undefined = (t) => t as unknown as TacheFiltrable,
): T[] {
  const gardees: T[] = [];
  const ecartees: string[] = [];
  for (const t of taches ?? []) {
    const raison = raisonExclusionGenerateur(acces(t));
    if (raison) ecartees.push(`${raison} : « ${String(acces(t)?.title ?? "")} »`);
    else gardees.push(t);
  }
  if (ecartees.length > 0) {
    console.log(`[FiltreGenerateur] ${origine} — ${ecartees.length} tâche(s) écartée(s) (calendrier éditorial / pipeline de prospection) :\n  ${ecartees.join("\n  ")}`);
  }
  return gardees;
}
