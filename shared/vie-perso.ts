// Vie perso (spec 2026-11-23) : ce qui est partagé entre serveur et client. Module pur.
import { z } from "zod";

/** Marqueur d'une tâche perso : le moteur de travail ne la déplace jamais et la compte comme occupée. */
export const SOURCE_VIE_PERSO = "vie_perso";
export const estTachePerso = (t: { source?: string | null }) => t.source === SOURCE_VIE_PERSO;

export type Phase = "regles" | "folliculaire" | "ovulation" | "luteale";
export type Fenetre = "soir" | "weekend" | "indifferent";
export const REPAS = ["dejeuner", "diner", "dessert"] as const;
export type Repas = (typeof REPAS)[number];

export interface ProfilViePerso {
  soirDebut: string; soirFin: string;
  weekendDebut: string; weekendFin: string;
  heureDejeuner: string; heureDiner: string;
  /** 0 = dimanche … 6 = samedi */
  batchJour: number; batchHeure: string; batchDureeMax: number;
  coursesJour: number; coursesHeure: string; coursesDuree: number;
  jeune: string;
  equipement: string[];
  magasins: string[];
  placard: string[];
  dernieresRegles: string | null;
  dureeCycle: number | null;
}

export const PROFIL_DEFAUT: ProfilViePerso = {
  soirDebut: "18:30", soirFin: "22:00",
  weekendDebut: "09:00", weekendFin: "20:00",
  heureDejeuner: "12:00", heureDiner: "19:30",
  batchJour: 0, batchHeure: "10:00", batchDureeMax: 120,
  coursesJour: 6, coursesHeure: "10:00", coursesDuree: 60,
  jeune: "", equipement: [], magasins: [], placard: [],
  dernieresRegles: null, dureeCycle: null,
};

const JOUR_MS = 86_400_000;
const enDate = (j: string) => new Date(`${j}T12:00:00Z`);
const enJour = (d: Date) => d.toISOString().slice(0, 10);

export const ajouterJours = (jour: string, n: number) => enJour(new Date(enDate(jour).getTime() + n * JOUR_MS));
export const jourSemaine = (jour: string) => enDate(jour).getUTCDay();
export const lundiDe = (jour: string) => ajouterJours(jour, -((jourSemaine(jour) + 6) % 7));
export const joursDeSemaine = (lundi: string) => Array.from({ length: 7 }, (_, i) => ajouterJours(lundi, i));

/** Phase du cycle un jour donné (J1 = premier jour des dernières règles). Null si inconnue. */
export function phaseDuCycle(jour: string, dernieresRegles: string | null, dureeCycle: number | null): Phase | null {
  if (!dernieresRegles || !/^\d{4}-\d{2}-\d{2}$/.test(dernieresRegles)) return null;
  const duree = dureeCycle && dureeCycle >= 20 && dureeCycle <= 45 ? dureeCycle : 28;
  const ecart = Math.round((enDate(jour).getTime() - enDate(dernieresRegles).getTime()) / JOUR_MS);
  if (ecart < 0) return null;
  const j = (ecart % duree) + 1;
  if (j <= 5) return "regles";
  if (j <= 13) return "folliculaire";
  if (j <= 16) return "ovulation";
  return "luteale";
}

// ─── Plan de repas (sortie de génération, validée) ──────────────────────────────────────

const texte = (max: number) => z.string().max(max);
const nombre = z.number().nullable();

export const SCHEMA_REPAS = z.object({
  titre: texte(200),
  detail: texte(1000),
  kcal: nombre, proteines: nombre, lipides: nombre, glucides: nombre,
  variantes: z.array(z.object({ membre: texte(80), texte: texte(400) })).max(8),
  /** Préparation le jour même, en minutes (0 : rien à faire, tout vient du batch). */
  preparationMin: z.number().int().min(0).max(240),
});

export const SCHEMA_PLAN_REPAS = z.object({
  jours: z.array(z.object({
    date: texte(10),
    dejeuner: SCHEMA_REPAS.nullable(),
    diner: SCHEMA_REPAS.nullable(),
    dessert: SCHEMA_REPAS.nullable(),
  })).length(7),
  batch: z.object({
    dureeMin: z.number().int().min(0).max(300),
    etapes: z.array(z.object({ appareil: texte(80), action: texte(600) })).max(30),
  }),
  courses: z.array(z.object({
    article: texte(160), quantite: texte(60), magasin: texte(80), rayon: texte(80),
    /** « tous » ou le prénom d'un membre */
    pour: texte(80),
  })).max(150),
  regles: z.array(texte(300)).max(8),
  snacks: z.array(texte(300)).max(10),
});
export type PlanRepas = z.infer<typeof SCHEMA_PLAN_REPAS>;
export type RepasPlan = z.infer<typeof SCHEMA_REPAS>;

/** Plan enregistré : la sortie générée + l'état des cases de la liste de courses. */
export interface PlanEnregistre {
  semaine: string;
  statut: "brouillon" | "valide";
  contenu: PlanRepas;
  coches: number[];
}

// ─── Activité perso ─────────────────────────────────────────────────────────────────────

export const SCHEMA_ACTIVITE = z.object({
  achats: z.array(z.object({ article: texte(160), quantite: texte(60), ou: texte(120) })).max(40),
  etapes: z.array(z.object({
    titre: texte(160),
    dureeMin: z.number().int().min(10).max(480),
    /** À faire avec les personnes prévues (alors placée le week-end). */
    ensemble: z.boolean(),
  })).min(1).max(15),
});
export type ContenuActivite = z.infer<typeof SCHEMA_ACTIVITE>;
