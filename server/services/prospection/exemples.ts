/**
 * Exemples de la façon d'écrire de l'utilisatrice, tirés de ses corrections. PURE.
 * Priorité : un message qui a obtenu une réponse > un message qu'elle a modifié > un message
 * qu'elle a collé (original nul) > un message validé tel quel. Les plus récents d'abord.
 */
import type { ProspectionMessageFeedback } from "@shared/schema";

function rang(f: ProspectionMessageFeedback): number {
  if (f.aRepondu === true) return 0;
  if (f.action === "modifie" && f.original != null) return 1;
  if (f.action === "modifie") return 2;
  return 3;
}

export function choisirExemples(fb: ProspectionMessageFeedback[], role: string, max = 4): string[] {
  const candidats = fb
    .filter((f) => f.role === role && (f.action === "modifie" || f.action === "valide_tel_quel") && (f.final ?? "").trim())
    .sort((a, b) => rang(a) - rang(b) || (b.id ?? 0) - (a.id ?? 0));
  const vus = new Set<string>();
  const out: string[] = [];
  for (const f of candidats) {
    const t = (f.final ?? "").trim();
    if (vus.has(t)) continue;
    vus.add(t);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}
