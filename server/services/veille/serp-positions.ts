/** Positions dans Google (top 10) et ce qui a bougé. PUR. */
import type { SerpResult } from "../serp";
import { domaineDe, memeDomaine } from "./texte";
import type { ConstatBrut } from "./types";

export type Positions = Record<string, number | null>;

/** Position (1 à 10) du premier résultat de chaque domaine suivi ; null s'il n'est pas dans le top 10. */
export function positions(resultats: SerpResult[], entites: Array<{ cle: string; domaine: string | null }>): Positions {
  const top = resultats.slice(0, 10).map((r) => domaineDe(r.link));
  const out: Positions = {};
  for (const e of entites) {
    const i = top.findIndex((d) => memeDomaine(d, e.domaine));
    out[e.cle] = i >= 0 ? i + 1 : null;
  }
  return out;
}

export function comparerSerp(
  prec: Positions | null,
  cur: Positions,
  ctx: { motCle: string; marqueCle: string; concurrents: Array<{ cle: string; nom: string }> },
): ConstatBrut[] {
  if (!prec) return [];
  const out: ConstatBrut[] = [];
  // Une entité absente du relevé précédent (ajoutée ou reconfigurée depuis) part d'un point
  // de départ : sa première position n'est pas un « mouvement ».
  const p = prec[ctx.marqueCle] ?? null;
  const c = cur[ctx.marqueCle] ?? null;
  const q = `« ${ctx.motCle} »`;
  if (!(ctx.marqueCle in prec)) { /* point de départ de la marque */ }
  else if (p == null && c != null) {
    out.push({ type: "position", titre: `Entrée dans le top 10`, texte: `Sur ${q}, tu apparais désormais en position ${c}.` });
  } else if (p != null && c == null) {
    out.push({ type: "position", titre: `Sortie du top 10`, texte: `Sur ${q}, tu n'es plus dans les 10 premiers résultats (tu étais ${p}e).` });
  } else if (p != null && c != null && Math.abs(p - c) >= 3) {
    out.push({ type: "position", titre: c < p ? `Gain de position` : `Perte de position`, texte: `Sur ${q}, tu passes de la position ${p} à la position ${c}.` });
  }
  for (const k of ctx.concurrents) {
    if (!(k.cle in prec)) continue;
    const avant = prec[k.cle] ?? null;
    const apres = cur[k.cle] ?? null;
    if (apres != null && apres <= 3 && (avant == null || avant > 3)) {
      out.push({ type: "position", titre: `${k.nom} dans le top 3`, texte: `Sur ${q}, ${k.nom} entre dans le top 3 (position ${apres}).` });
    }
  }
  return out;
}

export function bilanSerp(toutes: Positions[], marqueCle: string): { presentes: number; total: number } {
  return { presentes: toutes.filter((p) => p[marqueCle] != null).length, total: toutes.length };
}
