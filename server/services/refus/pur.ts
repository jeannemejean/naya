// Fonctions pures du refus de tâche (aucune dépendance base / réseau).

export const RAISONS_REFUS = [
  "not_useful", "wrong_timing", "already_done", "not_aligned", "too_vague", "wrong_approach", "other",
] as const;
export type RaisonRefus = typeof RAISONS_REFUS[number];

export function estRaisonRefus(x: unknown): x is RaisonRefus {
  return typeof x === "string" && (RAISONS_REFUS as readonly string[]).includes(x);
}

const LIBELLES: Record<RaisonRefus, string> = {
  not_useful: "pas utile",
  wrong_timing: "mauvais moment",
  already_done: "déjà fait",
  not_aligned: "pas aligné",
  too_vague: "trop vague",
  wrong_approach: "mauvaise approche",
  other: "autre",
};

export function libelleRaison(r: RaisonRefus): string {
  return LIBELLES[r];
}

function tronquer(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

// Souvenir mémoire : uniquement si l'utilisateur a expliqué son refus.
export function texteSouvenirRefus(titre: string, raison: RaisonRefus, freeText: string | null | undefined): string | null {
  const texte = (freeText ?? "").trim();
  if (!texte) return null;
  return `A refusé la tâche « ${titre} » (${libelleRaison(raison)}) : ${tronquer(texte, 1500)}`;
}

// Ligne du contexte « tâches rejetées » du générateur (format historique + explication).
export function ligneContexteRefus(f: {
  taskTitle: string; taskType?: string | null; taskCategory?: string | null; taskSource?: string | null;
  feedbackType: string; reason: string; freeText?: string | null;
}): string {
  const base = `- ${f.taskTitle} (${f.taskType || ''}/${f.taskCategory || ''}, source: ${f.taskSource || 'unknown'}) — ${f.feedbackType}, reason: ${f.reason}`;
  const texte = (f.freeText ?? "").trim();
  return texte ? `${base} — "${tronquer(texte, 300)}"` : base;
}

export interface Remplacement {
  title: string;
  description: string;
  type: string;
  category: string;
  estimatedDuration: number;
  activationPrompt?: string | null;
}

export function validerRemplacement(brut: unknown, dureeOrigine: number | null | undefined): Remplacement | null {
  if (!brut || typeof brut !== "object") return null;
  const o = brut as Record<string, unknown>;
  if (typeof o.title !== "string" || !o.title.trim()) return null;
  if (typeof o.description !== "string" || !o.description.trim()) return null;
  const defaut = dureeOrigine || 30;
  const d = typeof o.estimatedDuration === "number" && Number.isFinite(o.estimatedDuration) ? o.estimatedDuration : defaut;
  return {
    title: o.title.trim().slice(0, 200),
    description: o.description,
    type: typeof o.type === "string" && o.type ? o.type : "generic",
    category: typeof o.category === "string" && o.category ? o.category : "general",
    estimatedDuration: Math.min(240, Math.max(15, Math.round(d))),
    activationPrompt: typeof o.activationPrompt === "string" ? o.activationPrompt : null,
  };
}
