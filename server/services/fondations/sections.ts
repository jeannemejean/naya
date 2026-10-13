/**
 * Validation des sections des fondations (offre, motivations, KPI, plan), qu'elles viennent
 * de l'IA ou de l'interface. PUR. Ce qui sort des catalogues est retiré, jamais deviné.
 */
import {
  SECTIONS, STATUTS_SECTION, FORMATS_CREATIFS, ETAGES_KPI, FREQUENCES_KPI, MATURITES, STATUTS_BRIQUE,
  CLES_BRIQUES, PLAFONDS, ANGLE_AUCUN, type Section, type StatutSection,
} from "./catalogues";

export type Offre = { nom: string; description: string; prix?: string; pourquoi: string; existe: boolean };
export type Motivation = {
  cle: string; nom: string; description: string; angle: string;
  accroches: string[]; preuves: string[]; objections: string[]; formats: string[];
};
export type Kpi = { cle: string; nom: string; etage: string; definition: string; frequence: string; cible?: string };
export type Brique = { cle: string; statut: string; raison: string; action: string };
export type Plan = { maturite: string; resume: string; briques: Brique[] };

export type Resultat<T> = { ok: true; valeur: T } | { ok: false; erreur: string };

export function slug(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
}

const texte = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const estObjet = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const liste = (v: unknown, max = PLAFONDS.liste) =>
  (Array.isArray(v) ? v : []).map((x) => texte(x, 300)).filter(Boolean).slice(0, max);
const dans = <T extends string>(cat: readonly T[], v: unknown): v is T => typeof v === "string" && (cat as readonly string[]).includes(v);

/** Clé stable : celle fournie si elle est valide, sinon dérivée du nom ; unique dans `prises`. */
function cleUnique(fournie: unknown, nom: string, prises: Set<string>): string {
  const base = typeof fournie === "string" && /^[a-z0-9_]{1,40}$/.test(fournie) ? fournie : slug(nom) || "element";
  let cle = base === ANGLE_AUCUN ? `${base}_2` : base;
  for (let i = 2; prises.has(cle); i++) cle = `${base}_${i}`;
  prises.add(cle);
  return cle;
}

function validerOffre(v: unknown): Resultat<Offre> {
  if (!estObjet(v)) return { ok: false, erreur: "offre_invalide" };
  const nom = texte(v.nom, 120);
  if (!nom) return { ok: false, erreur: "offre_nom_requis" };
  const prix = texte(v.prix, 60);
  return { ok: true, valeur: { nom, description: texte(v.description, 600), ...(prix ? { prix } : {}), pourquoi: texte(v.pourquoi, 400), existe: v.existe === true } };
}

function validerMotivations(v: unknown): Resultat<Motivation[]> {
  const prises = new Set<string>();
  const out: Motivation[] = [];
  for (const m of Array.isArray(v) ? v : []) {
    if (!estObjet(m) || out.length >= PLAFONDS.motivations) continue;
    const nom = texte(m.nom, 80);
    if (!nom) continue;
    const formats = [...new Set((Array.isArray(m.formats) ? m.formats : []).filter((f) => dans(FORMATS_CREATIFS, f)))].slice(0, PLAFONDS.formats) as string[];
    out.push({
      cle: cleUnique(m.cle, nom, prises), nom,
      description: texte(m.description, 400), angle: texte(m.angle, 300),
      accroches: liste(m.accroches), preuves: liste(m.preuves), objections: liste(m.objections), formats,
    });
  }
  return out.length ? { ok: true, valeur: out } : { ok: false, erreur: "motivations_vides" };
}

function validerKpis(v: unknown): Resultat<Kpi[]> {
  const prises = new Set<string>();
  const out: Kpi[] = [];
  for (const k of Array.isArray(v) ? v : []) {
    if (!estObjet(k) || out.length >= PLAFONDS.kpis) continue;
    const nom = texte(k.nom, 80);
    if (!nom || !dans(ETAGES_KPI, k.etage) || !dans(FREQUENCES_KPI, k.frequence)) continue;
    const cible = texte(k.cible, 80);
    out.push({
      cle: cleUnique(k.cle, nom, prises), nom, etage: k.etage, definition: texte(k.definition, 400),
      frequence: k.frequence, ...(cible ? { cible } : {}),
    });
  }
  return out.length ? { ok: true, valeur: out } : { ok: false, erreur: "kpis_vides" };
}

function validerPlan(v: unknown): Resultat<Plan> {
  if (!estObjet(v) || !dans(MATURITES, v.maturite)) return { ok: false, erreur: "plan_maturite" };
  const vues = new Set<string>();
  const briques: Brique[] = [];
  for (const b of Array.isArray(v.briques) ? v.briques : []) {
    if (!estObjet(b) || !dans(CLES_BRIQUES, b.cle) || !dans(STATUTS_BRIQUE, b.statut) || vues.has(b.cle)) continue;
    vues.add(b.cle);
    briques.push({ cle: b.cle, statut: b.statut, raison: texte(b.raison, 300), action: texte(b.action, 300) });
  }
  if (!briques.length) return { ok: false, erreur: "plan_vide" };
  return { ok: true, valeur: { maturite: v.maturite, resume: texte(v.resume, 600), briques } };
}

export function validerSection(section: Section, valeur: unknown): Resultat<unknown> {
  switch (section) {
    case "offre": return validerOffre(valeur);
    case "motivations": return validerMotivations(valeur);
    case "kpis": return validerKpis(valeur);
    case "plan": return validerPlan(valeur);
    default: return { ok: false, erreur: "section_inconnue" };
  }
}

/** Le premier objet JSON de la réponse de l'IA (blocs de code et texte autour tolérés). */
export function lireProposition(reponse: string): Record<string, unknown> {
  const debut = reponse.indexOf("{");
  const fin = reponse.lastIndexOf("}");
  if (debut < 0 || fin <= debut) return {};
  try {
    const o = JSON.parse(reponse.slice(debut, fin + 1));
    return estObjet(o) ? o : {};
  } catch {
    return {};
  }
}

export function statutsDe(f: { statuts?: unknown } | null | undefined): Record<Section, StatutSection> {
  const s = estObjet(f?.statuts) ? (f!.statuts as Record<string, unknown>) : {};
  return Object.fromEntries(SECTIONS.map((k) => [k, dans(STATUTS_SECTION, s[k]) ? s[k] : "vide"])) as Record<Section, StatutSection>;
}
