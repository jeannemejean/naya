// Phases d'une campagne — règles PURES (aucune base) : la durée en jours d'une campagne et le
// découpage de sa fenêtre en phases. Partagé par le placement, « repenser » et le suivi de
// création du fil (fil/creation.ts). Réexporté par placement.ts et repenser.ts.
// (routes.ts garde ses propres copies inline de la table des durées : hors périmètre.)
import { addDays as campaignAddDays } from "../../utils/dateUtils";

export const DUREE_JOURS: Record<string, number> = {
  '1_week': 7, '2_weeks': 14, '3_weeks': 21, '1_month': 30,
  '2_months': 60, '3_months': 90, '6_months': 180, '12_months': 365,
};

export function computePhaseRanges(
  phases: Array<{ number: number }>,
  startDate: Date,
  campaignDurationDays: number
): Record<number, { start: Date; end: Date }> {
  const sorted = [...phases].sort((a, b) => a.number - b.number);
  const totalPhases = sorted.length;
  if (totalPhases === 0) return {};
  const daysPerPhase = Math.max(1, Math.floor(campaignDurationDays / totalPhases));
  const result: Record<number, { start: Date; end: Date }> = {};

  sorted.forEach((phase, idx) => {
    const phaseStartDay = idx * daysPerPhase;
    const isLast = idx === totalPhases - 1;
    const phaseEndDay = isLast ? campaignDurationDays - 1 : (idx + 1) * daysPerPhase - 1;

    result[phase.number] = {
      start: campaignAddDays(startDate, phaseStartDay),
      end: campaignAddDays(startDate, phaseEndDay),
    };
  });

  return result;
}
