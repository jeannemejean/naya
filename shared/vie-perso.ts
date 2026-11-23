// Vie perso (spec 2026-11-23) : ce qui est partagé entre serveur et client. Module pur.
import { z } from "zod/v4";

/** Marqueur d'une tâche perso : le moteur de travail ne la déplace jamais et la compte comme occupée. */
export const SOURCE_VIE_PERSO = "vie_perso";
export const estTachePerso = (t: { source?: string | null }) => t.source === SOURCE_VIE_PERSO;
/** Les tâches de travail seules : pour tout calcul de charge, de plafond ou de créneau de travail. */
export const horsViePerso = <T extends { source?: string | null }>(ts: T[]): T[] => ts.filter((t) => !estTachePerso(t));

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

// Sortie payée : un texte ou une liste trop longs sont coupés, jamais refusés (leçon du premier jet AO).
const coupe = (n: number) => (s: string) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);
const texte = (max: number) => z.string().overwrite(coupe(max)).max(max);
const liste = <T extends z.ZodType>(el: T, max: number) =>
  z.array(el).overwrite((l) => l.slice(0, max)).max(max);
const nombre = z.number().nullable();
const minutes = (max: number) => z.number().overwrite((n) => Math.max(0, Math.min(max, Math.round(n)))).pipe(z.number().int().min(0).max(max));

export const SCHEMA_REPAS = z.object({
  titre: texte(200),
  detail: texte(1000),
  kcal: nombre, proteines: nombre, lipides: nombre, glucides: nombre,
  variantes: liste(z.object({ membre: texte(80), texte: texte(400) }), 8),
  /** Préparation le jour même, en minutes (0 : rien à faire, tout vient du batch). */
  preparationMin: minutes(240),
});

const BATCH = z.object({
    dureeMin: minutes(300),
    etapes: liste(z.object({ appareil: texte(80), action: texte(600) }), 30),
});
export const SCHEMA_COURSES = liste(z.object({
  article: texte(160), quantite: texte(60), magasin: texte(80), rayon: texte(80),
  /** « tous » ou le prénom d'un membre */
  pour: texte(80),
}), 150);

/** Plan enregistré (et relu) : un repas absent vaut null, une valeur inconnue aussi. */
export const SCHEMA_PLAN_REPAS = z.object({
  jours: z.array(z.object({
    date: texte(10),
    dejeuner: SCHEMA_REPAS.nullable(),
    diner: SCHEMA_REPAS.nullable(),
    dessert: SCHEMA_REPAS.nullable(),
  })).length(7),
  batch: BATCH,
  courses: SCHEMA_COURSES,
  regles: liste(texte(300), 8),
  snacks: liste(texte(300), 10),
});
export type PlanRepas = z.infer<typeof SCHEMA_PLAN_REPAS>;

// Ce que le modèle remplit : aucune alternative « ou null » (chacune alourdit la grammaire des
// sorties structurées, refusée au-delà d'une taille : constaté le 23 nov. 2026 sur 7 jours x 3
// repas). Un repas absent a un titre vide, une valeur inconnue vaut 0 ; converti ensuite.
export const SCHEMA_REPAS_GENERE = z.object({
  titre: texte(200),
  detail: texte(1000),
  kcal: z.number(), proteines: z.number(), lipides: z.number(), glucides: z.number(),
  variantes: liste(z.object({ membre: texte(80), texte: texte(400) }), 8),
  preparationMin: minutes(240),
});
export const SCHEMA_PLAN_GENERE = z.object({
  jours: liste(z.object({
    date: texte(10), dejeuner: SCHEMA_REPAS_GENERE, diner: SCHEMA_REPAS_GENERE, dessert: SCHEMA_REPAS_GENERE,
  }), 7),
  batch: BATCH,
  courses: SCHEMA_COURSES,
  regles: liste(texte(300), 8),
  snacks: liste(texte(300), 10),
});
export type PlanGenere = z.infer<typeof SCHEMA_PLAN_GENERE>;
export type RepasGenere = z.infer<typeof SCHEMA_REPAS_GENERE>;

const valeur = (n: number) => (Number.isFinite(n) && n > 0 ? Math.round(n) : null);
export function repasDepuisGenere(r: RepasGenere): z.infer<typeof SCHEMA_REPAS> | null {
  if (!r.titre.trim()) return null;
  return { ...r, kcal: valeur(r.kcal), proteines: valeur(r.proteines), lipides: valeur(r.lipides), glucides: valeur(r.glucides) };
}
/** Sortie du modèle → plan enregistrable ; lève « structure_invalide » s'il n'a pas 7 jours. */
export function planDepuisGenere(g: PlanGenere): PlanRepas {
  const r = SCHEMA_PLAN_REPAS.safeParse({
    ...g,
    jours: g.jours.map((j) => ({ date: j.date, dejeuner: repasDepuisGenere(j.dejeuner), diner: repasDepuisGenere(j.diner), dessert: repasDepuisGenere(j.dessert) })),
  });
  if (!r.success) throw new Error(`structure_invalide: ${r.error.issues.map((i) => i.path.join(".") + " " + i.message).join("; ").slice(0, 300)}`);
  return r.data;
}
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
  achats: liste(z.object({ article: texte(160), quantite: texte(60), ou: texte(120) }), 40),
  etapes: z.array(z.object({
    titre: texte(160),
    dureeMin: z.number().overwrite((n) => Math.max(10, Math.min(480, Math.round(n)))).pipe(z.number().int().min(10).max(480)),
    /** À faire avec les personnes prévues (alors placée le week-end). */
    ensemble: z.boolean(),
  })).overwrite((l) => l.slice(0, 15)).min(1).max(15),
});
export type ContenuActivite = z.infer<typeof SCHEMA_ACTIVITE>;
