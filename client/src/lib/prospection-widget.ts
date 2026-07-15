// Modèle d'affichage PUR du widget prospection (Outreach). Testé unitairement.

export interface ProspectionStatusDTO {
  plan: "base" | "enrichissement";
  enrichment_available: boolean;
  linkedin_requests_this_week: number;
  linkedin_weekly_limit: number;
  reset_day: string;
}

export interface ProspectionWidgetModel {
  mode: "enrichment" | "upsell" | "hidden";
  used: number;
  limit: number;
  percent: number; // 0..100 borné
  atLimit: boolean;
}

/** Décide quoi afficher (compteur enrichissement / bannière upsell / rien) à partir du status. */
export function prospectionWidgetModel(
  status: ProspectionStatusDTO | null | undefined,
): ProspectionWidgetModel {
  if (!status) {
    return { mode: "hidden", used: 0, limit: 0, percent: 0, atLimit: false };
  }
  const used = Math.max(0, status.linkedin_requests_this_week);
  const limit = status.linkedin_weekly_limit;
  const percent = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const atLimit = used >= limit;
  return {
    mode: status.plan === "enrichissement" ? "enrichment" : "upsell",
    used,
    limit,
    percent,
    atLimit,
  };
}
