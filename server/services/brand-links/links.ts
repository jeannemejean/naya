import type { ProjectLink } from "@shared/schema";

/** Une campagne de la marque liée, réduite à ce qui peut entrer dans un prompt. */
export interface CampagneLiee {
  id: number;
  marque: string;
  name: string;
  objective: string;
  coreMessage: string | null;
  angles: string[];
}

/**
 * Le contexte d'articulation. Volontairement PAUVRE : il ne porte ni ADN, ni mémoire,
 * ni ton de voix de la marque liée. Connaître la relation n'est pas partager la matière.
 */
export interface Articulation {
  lien: Pick<ProjectLink, "roleAmont" | "roleAval" | "nature">;
  sens: "nourrit" | "estNourriePar";
  campagne: CampagneLiee;
}

/** Un lien ne relie jamais une marque à elle-même. Pur. */
export function valideLien(input: { fromProjectId: number; toProjectId: number }):
  | { ok: true }
  | { ok: false; raison: string } {
  if (input.fromProjectId === input.toProjectId) {
    return { ok: false, raison: "Une marque ne peut pas être liée à elle-même." };
  }
  return { ok: true };
}

/**
 * Les angles d'une campagne, lus dans son `phases` jsonb — écrit par le modèle, donc
 * de forme incertaine. On lit `angle`, à défaut `objective`, à défaut `description`.
 * Toute forme inattendue rend une liste vide plutôt que de jeter. Pur.
 */
export function anglesDepuisPhases(phases: unknown): string[] {
  if (!Array.isArray(phases)) return [];
  const out: string[] = [];
  for (const p of phases) {
    if (!p || typeof p !== "object") continue;
    const o = p as Record<string, unknown>;
    const brut = [o.angle, o.objective, o.description].find((v) => typeof v === "string" && v.trim());
    if (typeof brut === "string") out.push(brut.trim());
  }
  return out;
}

/**
 * Le bloc injecté dans le prompt de génération. Il dit la relation et la campagne
 * liée, et RIEN de l'identité de l'autre marque. La dernière consigne est un
 * garde-fou produit : une marque ne parle jamais à la place d'une autre.
 */
export function formaterArticulation(a: Articulation): string {
  const { lien, sens, campagne } = a;
  const relation =
    sens === "nourrit"
      ? `La marque pour laquelle tu travailles NOURRIT « ${campagne.marque} ».`
      : `La marque pour laquelle tu travailles EST NOURRIE par « ${campagne.marque} ».`;

  const lignes: string[] = [
    "ARTICULATION AVEC UNE MARQUE LIÉE",
    relation,
  ];
  if (lien.roleAmont) lignes.push(`Rôle de la marque qui nourrit : ${lien.roleAmont}`);
  if (lien.roleAval) lignes.push(`Rôle de la marque nourrie : ${lien.roleAval}`);
  if (lien.nature) lignes.push(`Nature du lien : ${lien.nature}`);

  lignes.push("");
  if (campagne.marque?.trim()) {
    lignes.push(`Campagne en cours sur « ${campagne.marque.trim()} » : ${campagne.name}`);
  } else {
    lignes.push(`Campagne en cours : ${campagne.name}`);
  }
  if (campagne.objective?.trim()) {
    lignes.push(`Son objectif : ${campagne.objective.trim()}`);
  }
  if (campagne.coreMessage?.trim()) lignes.push(`Son message central : ${campagne.coreMessage.trim()}`);
  if (campagne.angles.length) lignes.push(`Ses angles par phase : ${campagne.angles.join(" · ")}`);

  lignes.push(
    "",
    "Construis en ÉCHO, pas en répétition : la campagne que tu produis doit se tenir",
    "seule tout en renvoyant à celle-ci. Tu ne reprends pas ses angles, tu leur réponds.",
    "Tu ne parles JAMAIS à la place de l'autre marque et tu n'imites pas sa voix.",
  );

  return lignes.join("\n");
}
