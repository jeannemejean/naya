// Placement de la vie perso (spec 2026-11-23 §7-8). Module pur : des demandes de tâches et les
// plages déjà occupées en entrée, des jours et heures en sortie. Fenêtres : les soirs en semaine,
// la journée le week-end (réglages de l'utilisatrice).
import {
  ajouterJours, jourSemaine, type ContenuActivite, type Fenetre, type PlanRepas, type ProfilViePerso, type RepasPlan,
} from "@shared/vie-perso";

export type Plage = { start: number; end: number };
export type Occupes = Map<string, Plage[]>;
export interface Depuis { jour: string; min: number }

export interface DemandeTache {
  cle: string;
  titre: string;
  description: string;
  jour: string;
  heure: string;
  duree: number;
  fenetre: Fenetre;
}

export interface TachePlacee { cle: string; titre: string; description: string; jour: string; heure: string; duree: number }

const PAS = 5;
const HORIZON_JOURS = 60;
const DUREE_ACHATS = 45;

export const enMin = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + (m || 0); };
export const enHeure = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const arrondir = (min: number) => Math.ceil(min / PAS) * PAS;
const estWeekend = (jour: string) => { const d = jourSemaine(jour); return d === 0 || d === 6; };

export function fenetreDuJour(jour: string, p: ProfilViePerso): Plage {
  return estWeekend(jour)
    ? { start: enMin(p.weekendDebut), end: enMin(p.weekendFin) }
    : { start: enMin(p.soirDebut), end: enMin(p.soirFin) };
}

/** Le dernier `jourCible` (0 = dimanche … 6 = samedi) strictement avant `lundi`. */
export function jourAvant(lundi: string, jourCible: number): string {
  const ecart = (jourSemaine(lundi) - jourCible + 7) % 7 || 7;
  return ajouterJours(lundi, -ecart);
}

const libre = (occ: Plage[], s: number, e: number) => occ.every((o) => e <= o.start || s >= o.end);

function premierCreneau(occ: Plage[], debut: number, fin: number, duree: number): number | null {
  for (let s = arrondir(debut); s + duree <= fin; s += PAS) if (libre(occ, s, s + duree)) return s;
  return null;
}

const convient = (jour: string, f: Fenetre) => f === "indifferent" || (f === "weekend") === estWeekend(jour);

/**
 * Avec une heure : gardée si libre, sinon premier créneau libre de la fenêtre du même jour
 * (d'abord après l'heure demandée, puis depuis le début de la fenêtre), sinon gardée telle quelle.
 * Sans heure : premier créneau libre d'un jour qui convient, à partir de `depuis`, au plus tard `avant`.
 */
export function placer(
  d: { jour?: string; heure?: string; duree: number; fenetre: Fenetre; avant?: string | null },
  occupes: Occupes, p: ProfilViePerso, depuis: Depuis,
): { jour: string; heure: string } | null {
  if (d.jour && d.heure) {
    const occ = occupes.get(d.jour) ?? [];
    const s = enMin(d.heure);
    if (libre(occ, s, s + d.duree)) return { jour: d.jour, heure: d.heure };
    const f = fenetreDuJour(d.jour, p);
    const x = premierCreneau(occ, Math.max(s, f.start), f.end, d.duree) ?? premierCreneau(occ, f.start, f.end, d.duree);
    return { jour: d.jour, heure: x != null ? enHeure(x) : d.heure };
  }
  for (let i = 0; i < HORIZON_JOURS; i++) {
    const jour = ajouterJours(depuis.jour, i);
    if (d.avant && jour > d.avant) return null;
    if (!convient(jour, d.fenetre)) continue;
    const f = fenetreDuJour(jour, p);
    const debut = jour === depuis.jour ? Math.max(f.start, depuis.min) : f.start;
    const x = premierCreneau(occupes.get(jour) ?? [], debut, f.end, d.duree);
    if (x != null) return { jour, heure: enHeure(x) };
  }
  return null;
}

const occuper = (occupes: Occupes, jour: string, s: number, e: number) => {
  if (!occupes.has(jour)) occupes.set(jour, []);
  occupes.get(jour)!.push({ start: s, end: e });
};

// ─── Plan de repas → tâches ──────────────────────────────────────────────────────────────

const descriptionRepas = (r: RepasPlan) => [
  r.detail,
  ...r.variantes.map((v) => `${v.membre} : ${v.texte}`),
].filter(Boolean).join("\n");

/** Les tâches d'une semaine de repas validée (courses, batch, préparations du jour). */
export function tachesDuPlan(plan: PlanRepas, p: ProfilViePerso, semaine: string): DemandeTache[] {
  const out: DemandeTache[] = [];
  const jourBatch = jourAvant(semaine, p.batchJour);
  let jourCourses = jourAvant(semaine, p.coursesJour);
  if (jourCourses > jourBatch) jourCourses = jourBatch;

  if (plan.courses.length > 0) {
    const magasins = Array.from(new Set(plan.courses.map((c) => c.magasin.trim() || "Autre")));
    const description = magasins.map((m) => [
      m,
      ...plan.courses.filter((c) => (c.magasin.trim() || "Autre") === m)
        .map((c) => `- ${c.article}${c.quantite ? ` (${c.quantite})` : ""}${c.pour && c.pour !== "tous" ? ` · ${c.pour}` : ""}`),
    ].join("\n")).join("\n\n");
    out.push({ cle: "courses", titre: `Courses : ${magasins.join(", ")}`, description, jour: jourCourses, heure: p.coursesHeure, duree: p.coursesDuree, fenetre: "weekend" });
  }

  if (plan.batch.dureeMin > 0) {
    out.push({
      cle: "batch", titre: "Batch cooking de la semaine",
      description: plan.batch.etapes.map((e, i) => `${i + 1}. ${e.appareil ? `${e.appareil} : ` : ""}${e.action}`).join("\n"),
      jour: jourBatch, heure: p.batchHeure, duree: Math.min(plan.batch.dureeMin, p.batchDureeMax), fenetre: "weekend",
    });
  }

  for (const j of plan.jours) {
    const dej = j.dejeuner;
    if (dej && dej.preparationMin > 0 && estWeekend(j.date)) {
      out.push({
        cle: `dejeuner:${j.date}`, titre: `Préparer le déjeuner : ${dej.titre}`, description: descriptionRepas(dej),
        jour: j.date, heure: enHeure(enMin(p.heureDejeuner) - dej.preparationMin), duree: dej.preparationMin, fenetre: "weekend",
      });
    }
    const din = j.diner;
    if (din && din.preparationMin > 0) {
      out.push({
        cle: `diner:${j.date}`, titre: `Préparer le dîner : ${din.titre}`, description: descriptionRepas(din),
        jour: j.date, heure: enHeure(enMin(p.heureDiner) - din.preparationMin), duree: din.preparationMin,
        fenetre: estWeekend(j.date) ? "weekend" : "soir",
      });
    }
  }
  return out;
}

/** Place des demandes à heure donnée, en tenant compte des plages occupées (mises à jour au fil). */
export function placerDemandes(demandes: DemandeTache[], occupes: Occupes, p: ProfilViePerso, depuis: Depuis): TachePlacee[] {
  const out: TachePlacee[] = [];
  for (const d of demandes) {
    if (d.jour < depuis.jour || (d.jour === depuis.jour && enMin(d.heure) < depuis.min)) continue; // déjà passé
    const r = placer(d, occupes, p, depuis)!;
    occuper(occupes, r.jour, enMin(r.heure), enMin(r.heure) + d.duree);
    out.push({ cle: d.cle, titre: d.titre, description: d.description, jour: r.jour, heure: r.heure, duree: d.duree });
  }
  return out;
}

// ─── Activité → tâches ───────────────────────────────────────────────────────────────────

export function placerActivite(
  a: { titre: string; contenu: ContenuActivite; quand: Fenetre; dateCible: string | null },
  occupesInit: Occupes, p: ProfilViePerso, depuis: Depuis,
): { taches: TachePlacee[]; nonPlacees: string[] } {
  const occupes: Occupes = new Map(Array.from(occupesInit, ([k, v]) => [k, [...v]]));
  const taches: TachePlacee[] = [];
  const nonPlacees: string[] = [];
  let curseur = depuis;
  const poser = (cle: string, titre: string, description: string, duree: number, fenetre: Fenetre, nomCourt: string) => {
    const r = placer({ duree, fenetre, avant: a.dateCible }, occupes, p, curseur);
    if (!r) { nonPlacees.push(nomCourt); return; }
    const s = enMin(r.heure);
    occuper(occupes, r.jour, s, s + duree);
    taches.push({ cle, titre, description, jour: r.jour, heure: r.heure, duree });
    curseur = { jour: r.jour, min: s + duree };
  };
  if (a.contenu.achats.length > 0) {
    const liste = a.contenu.achats.map((x) => `- ${x.article}${x.quantite ? ` (${x.quantite})` : ""}${x.ou ? `, ${x.ou}` : ""}`).join("\n");
    poser("achats", `Acheter le matériel : ${a.titre}`, liste, DUREE_ACHATS, a.quand, "Acheter le matériel");
  }
  a.contenu.etapes.forEach((e, i) => {
    poser(`etape:${i}`, `${a.titre} : ${e.titre}`, "", e.dureeMin, e.ensemble ? "weekend" : a.quand, e.titre);
  });
  return { taches, nonPlacees };
}
