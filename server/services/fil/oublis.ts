// Objectifs oubliés (spec, point 5) : un objectif actif qui n'a eu aucune tâche faite depuis
// 7 jours est signalé, et Naya propose une tâche courte pour le reprendre. La règle ne se
// déclenche qu'à partir du 8e jour après la mise en route du fil (`depuis`) : avant, l'absence
// de tâche faite ne dit rien, l'historique n'étant pas reclassé.
import { z } from "zod";
import { storage } from "../../storage";
import { isAiBlocked } from "../usage";
import { callClaudeWithContext, CLAUDE_MODELS } from "../claude";
import { etapesActives, type CarteFil } from "./carte";
import { objectifDe } from "./etapes";
import { bornerPourquoi, estPourquoiCreux } from "./rattachement";
import { jsonDe } from "./json-ia";

export const JOURS_SANS_TACHE = 7;
export const JOURS_DE_GRACE = 8;
export const REPRISE_MIN = 15;
export const REPRISE_MAX = 30;

const JOUR_MS = 24 * 3600_000;

export interface ObjectifOublieBrut { objectifId: number; titre: string; joursSansTache: number }
export interface RepriseProposee { titre: string; pourquoi: string; duree: number }

/**
 * Objectifs de la carte sans tâche faite depuis 7 jours (`derniereTacheFaite` : absente ou null
 * = aucune). Rien tant que le fil n'est pas en route, ni avant `depuis + 8 jours`. Sans tâche
 * faite, les jours sont comptés depuis la mise en route.
 */
export function objectifsOublies(
  carte: CarteFil,
  derniereTacheFaite: Map<number, Date | null>,
  maintenant: Date,
): ObjectifOublieBrut[] {
  const depuis = carte.depuis;
  if (!depuis || maintenant.getTime() < depuis.getTime() + JOURS_DE_GRACE * JOUR_MS) return [];
  const res: ObjectifOublieBrut[] = [];
  for (const o of carte.objectifs) {
    const derniere = derniereTacheFaite.get(o.id) ?? null;
    const reference = derniere ?? depuis;
    const ecart = maintenant.getTime() - reference.getTime();
    if (derniere && ecart < JOURS_SANS_TACHE * JOUR_MS) continue;
    res.push({ objectifId: o.id, titre: o.titre, joursSansTache: Math.floor(ecart / JOUR_MS) });
  }
  return res;
}

/** Lit la dernière tâche faite de chaque objectif de la carte, puis applique `objectifsOublies`. */
export async function chargerObjectifsOublies(userId: string, carte: CarteFil, maintenant: Date): Promise<ObjectifOublieBrut[]> {
  if (!carte.depuis || carte.objectifs.length === 0) return [];
  const dernieres = await storage.getDerniereTacheFaiteParObjectif(userId, carte.objectifs.map((o) => o.id));
  return objectifsOublies(carte, dernieres, maintenant);
}

// ── Tâche de reprise ───────────────────────────────────────────────────────────────────

const SortieReprise = z.object({
  titre: z.string().trim().min(1).max(200),
  pourquoi: z.string().trim().min(1),
  duree: z.number().optional(),
});

const borneDuree = (d: number | undefined): number =>
  typeof d === "number" && Number.isFinite(d) ? Math.min(REPRISE_MAX, Math.max(REPRISE_MIN, Math.round(d))) : 20;

/**
 * Une tâche courte (15 à 30 min) pour reprendre l'objectif, sur son étape en cours (jamais une
 * étape `locked`). Appel rapide. Rend null, sans appel IA, si l'IA est bloquée (plafond) ou si
 * l'objectif n'est pas à l'utilisatrice ou pas actif ; null aussi si deux réponses de suite sont
 * invalides (JSON, « pourquoi » creux).
 */
export async function tacheDeReprise(userId: string, objectifId: number): Promise<RepriseProposee | null> {
  if (await isAiBlocked(userId)) {
    console.info(`[fil] reprise de l'objectif ${objectifId} : IA bloquée (plafond), aucune proposition user=${userId}`);
    return null;
  }
  const o = await objectifDe(userId, objectifId);
  if (!o || o.objectif.status !== "active") return null;
  const { objectif } = o;
  const etape = etapesActives([...o.etapes].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)))[0];

  const consigne = [
    `Objectif : « ${objectif.title} »${objectif.description ? ` (${objectif.description})` : ""}.`,
    etape
      ? `Étape en cours : « ${etape.title} »${etape.pourquoi ? ` (pourquoi : ${etape.pourquoi})` : ""}.`
      : "Aucune étape en cours pour cet objectif.",
    `Aucune tâche n'a été faite pour cet objectif depuis au moins ${JOURS_SANS_TACHE} jours.`,
    "",
    `Propose UNE seule tâche courte, de ${REPRISE_MIN} à ${REPRISE_MAX} minutes, à faire aujourd'hui pour reprendre ${etape ? "cette étape" : "cet objectif"}.`,
    "Le titre est la première action concrète, propre à cette marque (pas « Travailler sur… »).",
    `Le « pourquoi » tient en une phrase : il nomme ${etape ? "l'étape" : "l'objectif"} et dit ce que la tâche débloque (pas « pour avancer ton objectif »).`,
    'Réponds UNIQUEMENT en JSON : {"titre":"…","pourquoi":"…","duree":20}',
  ].join("\n");

  let remarque = "";
  for (let essai = 0; essai < 2; essai++) {
    const texte = await callClaudeWithContext({
      userId, projectId: objectif.projectId, model: CLAUDE_MODELS.fast, max_tokens: 300, temperature: 0.4,
      userMessage: consigne + remarque,
    });
    const v = SortieReprise.safeParse(jsonDe(texte));
    if (!v.success) { remarque = "\n\nTa réponse précédente n'était pas un JSON valide. Recommence."; continue; }
    const pourquoi = bornerPourquoi(v.data.pourquoi);
    if (estPourquoiCreux(pourquoi)) { remarque = "\n\nLe « pourquoi » était creux. Dis concrètement ce que la tâche débloque. Recommence."; continue; }
    return { titre: v.data.titre, pourquoi, duree: borneDuree(v.data.duree) };
  }
  return null;
}
