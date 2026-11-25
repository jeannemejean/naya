// Créer un créneau régulier (rituel) et le rendre visible tout de suite : validation commune à la
// route /api/rituals et à la séance de redémarrage, puis matérialisation des 14 prochains jours.
import { storage } from "../storage";
import { areValidDays, isValidTimeOfDay } from "./rituals";
import { materializeRituals } from "./ritual-materialize";
import type { RecurringRitual } from "@shared/schema";

export interface DonneesRituel {
  projectId: number | null;
  title: string;
  days: string;
  startTime: string;
  durationMinutes: number;
  intervalWeeks: number;
  anchorDate: string;
}

/** `aujourdhui` (AAAA-MM-JJ) devient l'ancre : on compte les N semaines à partir d'aujourd'hui. */
export function validerRituel(body: any, aujourdhui: string): { ok: true; donnees: DonneesRituel } | { ok: false; message: string } {
  const { projectId, title, days, startTime, durationMinutes, intervalWeeks } = body ?? {};
  if (typeof title !== "string" || !title.trim()) return { ok: false, message: "title requis" };
  if (typeof startTime !== "string" || !isValidTimeOfDay(startTime)) return { ok: false, message: "startTime requis (HH:MM)" };
  const duration = Number(durationMinutes);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 480) return { ok: false, message: "durationMinutes invalide" };
  // "days" est optionnel : s'il est fourni, il doit être une liste de jours valide.
  if (typeof days === "string" && days.trim() && !areValidDays(days)) {
    return { ok: false, message: "days invalide (jours attendus : mon..sun)" };
  }
  const n = intervalWeeks == null ? 1 : Number(intervalWeeks);
  if (!Number.isInteger(n) || n < 1 || n > 8) return { ok: false, message: "intervalWeeks invalide (1 à 8)" };
  return {
    ok: true,
    donnees: {
      projectId: projectId != null ? Number(projectId) : null,
      title: title.trim(),
      days: typeof days === "string" && days.trim() ? days.trim() : "mon,tue,wed,thu,fri",
      startTime,
      durationMinutes: duration,
      intervalWeeks: n,
      anchorDate: aujourdhui,
    },
  };
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Crée le rituel, matérialise les 14 prochains jours et répare les chevauchements. */
export async function creerRituelEtMaterialiser(
  userId: string,
  donnees: DonneesRituel,
  aujourdhui: Date = new Date(),
): Promise<{ ritual: RecurringRitual; materialized: number }> {
  const ritual = await storage.createRitual({ userId, ...donnees });
  let materialized = 0;
  for (let i = 0; i < 14; i++) {
    const d = new Date(aujourdhui);
    d.setDate(d.getDate() + i);
    materialized += await materializeRituals(userId, iso(d));
  }
  await storage.fixOverlappingTasks(userId, iso(aujourdhui)).catch((e: any) =>
    console.error("[rituals] fixOverlappingTasks:", e?.message),
  );
  return { ritual, materialized };
}

export { iso as dateLocale };
