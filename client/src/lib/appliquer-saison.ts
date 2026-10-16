import { PALETTES, type Saison } from "@shared/saisons";

export type VariablesSaison = Record<"--fond" | "--fond-rgb" | "--touche-1" | "--touche-2" | "--motif", string>;

// « #F3EADB » -> « 243 234 219 » : les canaux séparés alimentent rgb(var(--fond-rgb) / α) dans le CSS.
function canaux(hex: string): string {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(" ");
}

export function variablesDeSaison(s: Saison): VariablesSaison {
  const p = PALETTES[s];
  return {
    "--fond": p.fond,
    "--fond-rgb": canaux(p.fond),
    "--touche-1": p.touche1,
    "--touche-2": p.touche2,
    "--motif": p.motif,
  };
}

// Pose la saison sur <html> : tout le CSS qui lit les variables suit aussitôt.
export function appliquerSaison(s: Saison, racine: HTMLElement = document.documentElement): void {
  racine.dataset.saison = s;
  for (const [nom, valeur] of Object.entries(variablesDeSaison(s))) racine.style.setProperty(nom, valeur);
}
