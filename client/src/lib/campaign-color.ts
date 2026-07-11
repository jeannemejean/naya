// Couleur de badge de campagne DÉTERMINISTE dérivée de l'id (ou du nom) — jamais hardcodée.
// Même seed → même couleur ; seeds différents → teintes différentes (hue issu d'un hash).

/** Hash FNV-1a 32 bits (bonne dispersion, déterministe, stable entre sessions/navigateurs). */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Teinte (0-359) déterministe pour un seed (id de campagne ou nom). */
export function campaignHue(seed: string | number): number {
  return hashString(String(seed)) % 360;
}

/**
 * Style de badge : fond pastel clair + texte foncé de la MÊME teinte → toujours lisible
 * (cohérent avec la palette claire de l'app), et distinct par campagne.
 */
export function campaignBadgeStyle(seed: string | number): {
  backgroundColor: string;
  color: string;
  borderColor: string;
} {
  const hue = campaignHue(seed);
  return {
    backgroundColor: `hsl(${hue}, 68%, 92%)`,
    color: `hsl(${hue}, 55%, 30%)`,
    borderColor: `hsl(${hue}, 45%, 82%)`,
  };
}

/** Nom court : retire un suffixe « — Prospection » fréquent, puis tronque. */
export function shortCampaignName(name: string, max = 20): string {
  if (!name) return "";
  let s = name.split(/\s+[—–-]\s+/)[0].trim() || name.trim();
  if (s.length > max) s = s.slice(0, max - 1).trimEnd() + "…";
  return s;
}
