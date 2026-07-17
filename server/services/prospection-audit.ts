/**
 * PHASE 4 — Audit adapté au type de projet + validation des messages.
 * Sections d'audit dérivées du type de projet (jamais les 6 sections JMD hardcodées),
 * avec un dernier bloc « Angle projet » toujours présent et spécifique à la campagne.
 * Logique PURE (les appels Claude vivent dans prospection-pipeline.ts).
 */

export type ProjectAuditType = "creative_agency" | "saas" | "personal_brand" | "default";

export interface AuditSectionSpec {
  key: string;
  label: string;
  guide: string; // consigne passée au modèle pour cette section
}

const ANGLE_SECTION: AuditSectionSpec = {
  key: "angle",
  label: "Angle projet",
  guide: "L'accroche/le concept spécifique et actionnable pour CETTE campagne. Ancré dans les données observées. Toujours présent.",
};

const SECTIONS: Record<ProjectAuditType, AuditSectionSpec[]> = {
  creative_agency: [
    { key: "contexteMarque", label: "Contexte marque", guide: "Histoire, positionnement, produits/services, stade, géographie. Factuel." },
    { key: "audience", label: "Audience", guide: "Qui la marque touche, canaux, profil type client." },
    { key: "contenu", label: "Contenu", guide: "Ce qu'elle publie, fréquence, formats, ton, performance." },
    { key: "positionnement", label: "Positionnement", guide: "Ce qui la différencie, son angle distinctif." },
    { key: "enjeux", label: "Enjeux", guide: "2-3 défis communication observables et documentables." },
    ANGLE_SECTION,
  ],
  saas: [
    { key: "contexteEntreprise", label: "Contexte entreprise", guide: "Activité, marché, stade, taille, géographie. Factuel." },
    { key: "stackActuel", label: "Stack actuel", guide: "Outils/technos visibles, site, produit, intégrations." },
    { key: "signauxAchat", label: "Signaux d'achat", guide: "Indices d'un besoin/projet en cours (recrutements, levée, lancement)." },
    { key: "decideurs", label: "Décideurs", guide: "Rôles décisionnaires probables pour cette offre." },
    { key: "enjeux", label: "Enjeux", guide: "2-3 défis business/technique observables." },
    ANGLE_SECTION,
  ],
  personal_brand: [
    { key: "contextePersonne", label: "Contexte personne", guide: "Qui est la personne, parcours, activité principale. Factuel." },
    { key: "activitePublique", label: "Activité publique", guide: "Ce qu'elle publie/partage, présence en ligne, sujets." },
    { key: "besoinsProbables", label: "Besoins probables", guide: "Besoins ou frictions plausibles au vu de son activité." },
    ANGLE_SECTION,
  ],
  default: [
    { key: "contexte", label: "Contexte", guide: "Activité, positionnement, stade, géographie. Factuel." },
    { key: "observations", label: "Observations", guide: "Ce qui est visible et vérifiable sur l'activité." },
    { key: "enjeux", label: "Enjeux", guide: "2-3 défis observables et documentables." },
    ANGLE_SECTION,
  ],
};

/** Sections d'audit pour un type de projet. Le dernier élément est toujours « Angle projet ». */
export function auditSectionsForProjectType(t: ProjectAuditType): AuditSectionSpec[] {
  return SECTIONS[t] ?? SECTIONS.default;
}

const CREATIVE_RE = /(agence|studio|cr[ée]ativ|communication|design|branding|marketing|publicit|social media|contenu)/i;
const SAAS_RE = /(saas|logiciel|software|plateforme|application|\bapp\b|tech|api|data|cloud|d[ée]veloppement)/i;
const PERSONAL_RE = /(personal brand|marque personnelle|coach|consultant|cr[ée]ateur|freelance|solopreneur|ind[ée]pendant)/i;

/** Déduit le type d'audit du type de projet + du businessType du DNA. */
export function classifyProjectType(
  project?: { type?: string | null } | null,
  dna?: { businessType?: string | null } | null,
): ProjectAuditType {
  const hay = `${project?.type || ""} ${dna?.businessType || ""}`.toLowerCase();
  // Personal brand prioritaire (souvent aussi "créatif") puis SaaS puis créatif.
  if (/personal brand/i.test(project?.type || "") || PERSONAL_RE.test(hay)) return "personal_brand";
  if (SAAS_RE.test(hay)) return "saas";
  if (/agency/i.test(project?.type || "") || CREATIVE_RE.test(hay)) return "creative_agency";
  return "default";
}

// ─── Validation / assainissement des messages ─────────────────────────────────

export const EM_DASH = "—";

/** Retire les tirets longs (— et –) en les remplaçant par une ponctuation douce. */
export function stripEmDash(s: string): string {
  return (s || "").replace(/\s*[—–]\s*/g, ", ").replace(/\s+/g, " ").trim();
}

/** Assainit un message : retire tirets longs, espaces superflus. */
export function sanitizeMessage(s: string): string {
  return stripEmDash(s);
}

/** Compte les phrases (séparateurs . ! ?). */
export function countSentences(s: string): number {
  return (s || "")
    .split(/[.!?]+/)
    .map((p) => p.trim())
    .filter(Boolean).length;
}

export interface MessageValidation {
  ok: boolean;
  length: number;
  sentences: number;
  hasEmDash: boolean;
}

function baseValidation(s: string): Omit<MessageValidation, "ok"> {
  const text = s || "";
  return {
    length: text.length,
    sentences: countSentences(text),
    hasEmDash: /[—–]/.test(text),
  };
}

/** Message LinkedIn (note de connexion) : ≤ 200 caractères, aucun tiret long. */
export function validateLinkedInMessage(s: string): MessageValidation {
  const b = baseValidation(s);
  return { ...b, ok: b.length <= 200 && !b.hasEmDash };
}

/** Email : 5 à 8 phrases, aucun tiret long. */
export function validateEmailMessage(s: string): MessageValidation {
  const b = baseValidation(s);
  return { ...b, ok: b.sentences >= 5 && b.sentences <= 8 && !b.hasEmDash };
}

/** Force un message LinkedIn sous la limite (assainit puis tronque au mot). */
export function enforceLinkedInLimit(s: string, max = 200): string {
  const clean = sanitizeMessage(s);
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim();
}

/**
 * Résout le PRÉNOM du créateur pour signer les messages.
 * Priorité : prénom du user (le créateur) → founderName/contactName du DNA.
 * Ne renvoie JAMAIS le nom d'agence (businessName) ni « Naya » : dernier recours = "" (aucune signature).
 */
export function resolveFounderName(
  user?: { firstName?: string | null } | null,
  dna?: { founderName?: string | null; contactName?: string | null } | null,
): string {
  return (
    user?.firstName?.trim() ||
    (dna as any)?.founderName?.trim() ||
    (dna as any)?.contactName?.trim() ||
    ""
  );
}

/**
 * Détecte un signal d'achat de la campagne dans les données enrichies.
 * Renvoie 'hot' si un signal est identifiable, 'warm' sinon.
 */
export function detectPriority(text: string, buyingSignals?: string | null): "hot" | "warm" {
  const hay = (text || "").toLowerCase();
  const signals = (buyingSignals || "")
    .split(/[,;\n]/)
    .map((x) => x.trim().toLowerCase())
    .filter((x) => x.length >= 3);
  if (signals.length === 0) return "warm";
  return signals.some((sig) => hay.includes(sig)) ? "hot" : "warm";
}
