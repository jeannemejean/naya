// Annulation des actions directes de l'agent (spec §6.3) : rejouer l'état d'avant de chaque
// ligne touchée, pendant 24 h, et SEULEMENT si aucune ligne n'a bougé entre-temps.
// « Modifiée entre-temps » = un des champs listés dans `apres` n'a plus la valeur que l'action
// lui avait donnée. Les autres champs (un titre changé après un « cocher ») ne bloquent pas.
// Tout est vérifié AVANT la première écriture : soit tout est annulé, soit rien.
import { storage } from "../../storage";
import { dateDeRetassage } from "../repack-from";
import { lireSouvenir, perimerSouvenir } from "../memory/ranger";
import { depot, type LigneJournal } from "./depot";

export const FENETRE_ANNULATION_MS = 24 * 3600 * 1000;

export type ResultatAnnulation =
  | { ok: true }
  | { ok: false; raison: "introuvable" | "deja_annulee" | "expiree" | "modifiee" };

// ── Comparaison robuste ────────────────────────────────────────────────────────────────
// Le journal est du JSON (les dates y sont des chaînes ISO) ; la base rend des Date.
// null et undefined se valent. Une date AAAA-MM-JJ ou une heure HH:MM reste du texte.
const INSTANT_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function normaliser(v: unknown): unknown {
  if (v === undefined || v === null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  if (typeof v === "string" && INSTANT_ISO.test(v)) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? v : d.toISOString();
  }
  if (typeof v === "object") return JSON.stringify(trierCles(v));
  return v;
}

// Le JSONB de Postgres réordonne les clés d'un objet : on les trie avant de comparer.
function trierCles(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(trierCles);
  if (v && typeof v === "object" && !(v instanceof Date)) {
    return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, trierCles((v as any)[k])]));
  }
  return v;
}

export function memeValeur(a: unknown, b: unknown): boolean {
  return normaliser(a) === normaliser(b);
}

// Champs horodatés des tâches : réécrits en Date (le journal les a rendus en texte).
const CHAMPS_INSTANT_TACHE = new Set(["completedAt"]);

function versEcritureTache(avant: Record<string, unknown>): Record<string, unknown> {
  const sortie: Record<string, unknown> = {};
  for (const [cle, valeur] of Object.entries(avant)) {
    sortie[cle] = CHAMPS_INSTANT_TACHE.has(cle) && typeof valeur === "string" ? new Date(valeur) : valeur;
  }
  return sortie;
}

// ── Une table = comment lire la ligne actuelle, la réécrire, la supprimer ────────────────
// Lecture TOUJOURS bornée à userId : une ligne d'une autre (ou disparue) rend undefined.
interface Gestion {
  lire(userId: string, id: number | string): Promise<Record<string, unknown> | undefined>;
  // Pour une ligne créée par l'action : y a-t-il ajouté quelque chose qui n'est pas dans
  // les champs comparés (texte, fichier) ? Si oui, la supprimer l'effacerait : on refuse.
  contenuAjoute?(userId: string, id: number | string): Promise<boolean>;
  restaurer(userId: string, ligne: LigneJournal & { avant: Record<string, unknown> }): Promise<void>;
  supprimer(userId: string, id: number | string): Promise<void>;
}

const GESTIONS: Partial<Record<LigneJournal["table"], Gestion>> = {
  tasks: {
    async lire(userId, id) {
      const t = await storage.getTask(Number(id));
      return t && (t as any).userId === userId ? (t as any) : undefined;
    },
    async contenuAjoute(userId, id) {
      // Supprimer la tâche effacerait son espace de travail (clearTaskReferences) et
      // détacherait ses livrables : un dépôt de l'utilisatrice compte comme une modification.
      const entrees = await storage.getWorkspaceEntries(Number(id));
      if (entrees.length > 0) return true;
      return storage.tacheALivrables(Number(id), userId);
    },
    async restaurer(userId, ligne) {
      // Remise directe de l'état d'avant (pas de recherche de créneau : on revient où l'on
      // était), puis le filet anti-chevauchement, comme tout chemin de replanification.
      await storage.updateTask(Number(ligne.id), versEcritureTache(ligne.avant) as any);
      if ("scheduledDate" in ligne.avant || "scheduledTime" in ligne.avant) {
        const depuis = dateDeRetassage(
          (ligne.avant.scheduledDate as string | null) ?? null,
          (ligne.apres.scheduledDate as string | null) ?? null,
        );
        if (depuis) {
          await storage.fixOverlappingTasks(userId, depuis).catch((e: any) =>
            console.error("[agent:annuler] fixOverlappingTasks:", e?.message));
        }
      }
    },
    async supprimer(_userId, id) {
      // La propriété a été vérifiée par `lire` juste avant (deleteTask ne filtre pas).
      await storage.deleteTask(Number(id));
    },
  },
  task_lists: {
    async lire(userId, id) {
      const l = await storage.getTaskList(Number(id), userId);
      if (!l) return undefined;
      // Les éléments tels qu'ils sont, sous la forme journalisée par creer_liste : un élément
      // coché, ajouté, renommé ou retiré rend la liste « modifiée ».
      return { ...l, elements: elementsDeListe(l.items) };
    },
    async restaurer() {
      throw new Error("task_lists : seule la création est journalisée");
    },
    async supprimer(userId, id) {
      await storage.deleteTaskList(Number(id), userId);
    },
  },
  quick_capture_entries: {
    // Une note créée par l'agent : si elle a été éditée, rangée ou convertie depuis, un des
    // champs de `apres` a bougé et l'annulation est refusée. Lecture bornée à userId.
    async lire(userId, id) {
      return (await storage.getCaptureEntry(Number(id), userId)) as any;
    },
    async restaurer() {
      throw new Error("quick_capture_entries : seule la création est journalisée");
    },
    async supprimer(userId, id) {
      await storage.deleteCaptureEntry(Number(id), userId);
    },
  },
  memory_entries: {
    async lire(userId, id) {
      return (await lireSouvenir(userId, Number(id))) as any;
    },
    async restaurer() {
      throw new Error("memory_entries : seule la création est journalisée");
    },
    // Jamais de suppression : le souvenir est périmé (superseded_at = now()).
    async supprimer(userId, id) {
      await perimerSouvenir(userId, Number(id));
    },
  },
  user_preferences: {
    async lire(userId, id) {
      if (id !== userId) return undefined;
      return (await storage.getUserPreferences(userId)) as any;
    },
    async restaurer(userId, ligne) {
      await storage.upsertUserPreferences(userId, ligne.avant as any);
    },
    async supprimer() {
      throw new Error("user_preferences : jamais créées par une action");
    },
  },
};

export function elementsDeListe(items: { title: string; completed: boolean | null }[]): { titre: string; coche: boolean }[] {
  return items.map((i) => ({ titre: i.title, coche: !!i.completed }));
}

function gestion(table: LigneJournal["table"]): Gestion {
  const g = GESTIONS[table];
  if (!g) throw new Error(`annulation non prise en charge pour la table ${table}`);
  return g;
}

export async function annulerAction(userId: string, actionId: number, maintenant: Date): Promise<ResultatAnnulation> {
  // Le dépôt filtre sur userId : l'action d'une autre est « introuvable ».
  const action = await depot.getAction(actionId, userId);
  if (!action) return { ok: false, raison: "introuvable" };
  if (action.annuleeAt) return { ok: false, raison: "deja_annulee" };
  const creee = action.createdAt ? new Date(action.createdAt).getTime() : NaN;
  if (!Number.isFinite(creee) || maintenant.getTime() - creee > FENETRE_ANNULATION_MS) {
    return { ok: false, raison: "expiree" };
  }

  const lignes = (Array.isArray(action.lignes) ? action.lignes : []) as LigneJournal[];

  // 1. Vérifier TOUTES les lignes avant d'écrire quoi que ce soit.
  for (const ligne of lignes) {
    const actuelle = await gestion(ligne.table).lire(userId, ligne.id);
    if (!actuelle) return { ok: false, raison: "modifiee" };
    for (const [champ, valeur] of Object.entries(ligne.apres ?? {})) {
      if (!memeValeur(actuelle[champ], valeur)) return { ok: false, raison: "modifiee" };
    }
    const g = gestion(ligne.table);
    if (ligne.avant === null && g.contenuAjoute && (await g.contenuAjoute(userId, ligne.id))) {
      return { ok: false, raison: "modifiee" };
    }
  }

  // 2. Rejouer l'état d'avant, de la dernière ligne touchée à la première.
  for (const ligne of [...lignes].reverse()) {
    const g = gestion(ligne.table);
    if (ligne.avant === null) await g.supprimer(userId, ligne.id);
    else await g.restaurer(userId, ligne as LigneJournal & { avant: Record<string, unknown> });
  }

  await depot.marquerAnnulee(actionId, userId, maintenant);
  return { ok: true };
}
