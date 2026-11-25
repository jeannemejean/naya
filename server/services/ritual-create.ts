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

/** Le jour (AAAA-MM-JJ) dans le fuseau de l'utilisatrice, jamais celui du serveur (UTC en prod). */
export function dateLocale(d: Date, fuseau = "Europe/Paris"): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: fuseau }).format(d);
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(d);
  }
}

/** AAAA-MM-JJ + n jours, en calendrier pur (aucun fuseau, aucun changement d'heure). */
export function plusJours(jour: string, n: number): string {
  const [a, m, j] = jour.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, j + n)).toISOString().slice(0, 10);
}

/** Matérialise les créneaux actifs sur les 14 jours à partir de `jour`, puis répare les chevauchements. */
export async function materialiserQuinzaine(userId: string, jour: string): Promise<number> {
  let materialized = 0;
  for (let i = 0; i < 14; i++) materialized += await materializeRituals(userId, plusJours(jour, i));
  await storage.fixOverlappingTasks(userId, jour).catch((e: any) =>
    console.error("[rituals] fixOverlappingTasks:", e?.message),
  );
  return materialized;
}

/** Crée le rituel, matérialise les 14 prochains jours et répare les chevauchements. */
export async function creerRituelEtMaterialiser(
  userId: string,
  donnees: DonneesRituel,
  maintenant: Date = new Date(),
  fuseau?: string,
): Promise<{ ritual: RecurringRitual; materialized: number }> {
  const ritual = await storage.createRitual({ userId, ...donnees });
  const materialized = await materialiserQuinzaine(userId, dateLocale(maintenant, fuseau));
  return { ritual, materialized };
}
