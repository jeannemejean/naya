/**
 * Structures de séquence éprouvées. PURE.
 *
 * L'IA n'invente plus la FORME d'une séquence : elle choisit parmi ces structures et n'écrit
 * que les intentions (sequence-plan.ts). La logique de branches est ainsi garantie par le code.
 *
 * Le moteur (sequence-engine.ts) est LINÉAIRE : chaque étape est évaluée une seule fois, dans
 * l'ordre, au moment où son délai est écoulé depuis le dernier envoi réel ; une condition
 * fausse la saute. Les deux « branches » (invitation acceptée ou non) sont donc entrelacées,
 * chacune gardée par sa condition.
 *
 * Aucune condition d'ouverture ou de clic : depuis le pré-chargement des images par les
 * messageries, le suivi d'ouverture est faux une fois sur deux.
 */
import type { StepCondition } from "../sequence-engine";
import type { RoleTouche } from "./doctrine";

export type NomStructure = "linkedin_first" | "email_first" | "linkedin_only";

export interface Emplacement {
  channel: "linkedin" | "email";
  delayDays: number;
  condition: StepCondition;
  role: RoleTouche;
}

const E = (channel: Emplacement["channel"], delayDays: number, condition: StepCondition, role: RoleTouche): Emplacement =>
  ({ channel, delayDays, condition, role });

const STRUCTURES: Record<NomStructure, Emplacement[]> = {
  linkedin_first: [
    E("linkedin", 0, "always", "invitation"),
    E("email", 5, "if_invite_not_accepted", "email_ouverture"),
    E("linkedin", 2, "if_invite_accepted", "premier_message"),
    E("linkedin", 4, "if_invite_accepted", "relance"),
    E("email", 6, "if_invite_not_accepted", "relance"),
    E("linkedin", 6, "if_invite_accepted", "cloture"),
    E("email", 7, "if_invite_not_accepted", "cloture"),
  ],
  email_first: [
    E("email", 0, "always", "email_ouverture"),
    E("email", 4, "always", "relance"),
    E("email", 5, "always", "relance"),
    E("email", 7, "always", "cloture"),
  ],
  linkedin_only: [
    E("linkedin", 0, "always", "invitation"),
    E("linkedin", 5, "if_invite_accepted", "premier_message"),
    E("linkedin", 4, "if_invite_accepted", "relance"),
    E("linkedin", 6, "if_invite_accepted", "cloture"),
  ],
};

/** Canal déclaré de la campagne → structure. */
export function structurePour(channel: string | null | undefined): NomStructure {
  if (channel === "email") return "email_first";
  if (channel === "linkedin") return "linkedin_only";
  return "linkedin_first";
}

export function emplacements(nom: NomStructure): Emplacement[] {
  return STRUCTURES[nom].map((e) => ({ ...e }));
}

/**
 * Délais proposés par l'IA, bornés : ±50 % du délai de la structure, au moins 1 jour entre
 * deux touches (sauf la première, toujours à 0). Une proposition absente garde le délai.
 */
export function ajusterDelais(base: Emplacement[], proposes: Array<number | undefined>): Emplacement[] {
  return base.map((e, i) => {
    if (i === 0) return { ...e, delayDays: 0 };
    const p = proposes[i];
    if (p == null || !Number.isFinite(p)) return { ...e };
    const min = Math.max(1, Math.floor(e.delayDays * 0.5));
    const max = Math.max(min, Math.ceil(e.delayDays * 1.5));
    return { ...e, delayDays: Math.min(max, Math.max(min, Math.round(p))) };
  });
}

/** Problèmes de structure (vide = valide). */
export function verifierStructure(e: Emplacement[]): string[] {
  const pb: string[] = [];
  e.forEach((x, i) => {
    if (["if_opened", "if_not_opened", "if_clicked"].includes(x.condition)) {
      pb.push(`étape ${i + 1} : condition d'ouverture ou de clic interdite`);
    }
    if (x.channel === "linkedin" && x.role !== "invitation" && x.condition !== "if_invite_accepted") {
      pb.push(`étape ${i + 1} : message LinkedIn possible sans invitation acceptée`);
    }
    if (x.channel === "linkedin" && x.role === "invitation" && e.slice(0, i).some((y) => y.channel === "linkedin")) {
      pb.push(`étape ${i + 1} : invitation après une autre touche LinkedIn`);
    }
  });
  const acceptee = e.filter((x) => x.condition !== "if_invite_not_accepted").length;
  const refusee = e.filter((x) => x.condition !== "if_invite_accepted").length;
  if (acceptee > 5 || refusee > 5) pb.push("plus de 5 touches sur une branche");
  return pb;
}
