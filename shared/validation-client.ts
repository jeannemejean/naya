// shared/validation-client.ts — validation client (lot 8, inspiré de Metricool) : réglages d'une
// marque, décisions des relecteurs, relance après modification, garde de publication.
// Règles pures, sans base.

export const REGLES_VALIDATION = ["un", "tous"] as const;
export type RegleValidation = typeof REGLES_VALIDATION[number];
export const STATUTS_VALIDATION = ["a_valider", "validee", "refusee"] as const;
export type StatutValidation = typeof STATUTS_VALIDATION[number];
export const DECISIONS_VALIDATION = ["validee", "refusee", "commentaire"] as const;
export type DecisionValidation = typeof DECISIONS_VALIDATION[number];

export const RELECTEURS_MAX = 10;
export const NOM_RELECTEUR_MAX = 80;
export const COMMENTAIRE_VALIDATION_MAX = 2000;
/** Comme Metricool : un post pas validé à son heure attend encore 3 h, puis part en échec. */
export const GRACE_VALIDATION_MIN = 180;
/** Décisions (et commentaires) par lien de portail : au plus 60 par tranche de 10 minutes. */
export const DECISIONS_PAR_FENETRE = 60;
export const FENETRE_DECISIONS_MS = 10 * 60_000;

export interface Relecteur { nom: string; email: string }
export interface ReglagesValidation { actif: boolean; regle: RegleValidation; relecteurs: Relecteur[] }

const EMAIL_RE = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]{2,}$/;

export function normaliserEmail(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const e = v.trim().toLowerCase();
  return e.length <= 254 && EMAIL_RE.test(e) ? e : null;
}

/** Les réglages envoyés par l'écran, validés ; null s'ils sont illisibles. Emails dédoublonnés. */
export function lireReglagesValidation(body: unknown): ReglagesValidation | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.actif !== "boolean") return null;
  if (!(REGLES_VALIDATION as readonly string[]).includes(b.regle as string)) return null;
  if (!Array.isArray(b.relecteurs) || b.relecteurs.length > RELECTEURS_MAX) return null;
  const relecteurs: Relecteur[] = [];
  const vus = new Set<string>();
  for (const r of b.relecteurs) {
    if (!r || typeof r !== "object") return null;
    const email = normaliserEmail((r as any).email);
    const nom = typeof (r as any).nom === "string" ? (r as any).nom.trim() : "";
    if (!email || nom.length > NOM_RELECTEUR_MAX) return null;
    if (vus.has(email)) continue;
    vus.add(email);
    relecteurs.push({ nom: nom || email, email });
  }
  // Activer sans relecteur n'aurait pas de sens : personne ne pourrait valider.
  if (b.actif && relecteurs.length === 0) return null;
  return { actif: b.actif, regle: b.regle as RegleValidation, relecteurs };
}

/** Les relecteurs enregistrés (jsonb), relus défensivement. */
export function relecteursDe(v: unknown): Relecteur[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((r) => {
    const email = normaliserEmail(r?.email);
    return email ? [{ nom: typeof r?.nom === "string" && r.nom.trim() ? r.nom.trim() : email, email }] : [];
  });
}

/** Une décision envoyée depuis le portail ; null si illisible. */
export function lireDecision(body: unknown): { relecteurEmail: string; decision: DecisionValidation; commentaire: string | null } | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const relecteurEmail = normaliserEmail(b.relecteurEmail);
  if (!relecteurEmail) return null;
  if (!(DECISIONS_VALIDATION as readonly string[]).includes(b.decision as string)) return null;
  let commentaire: string | null = null;
  if (b.commentaire != null) {
    if (typeof b.commentaire !== "string") return null;
    const c = b.commentaire.trim();
    if (c.length > COMMENTAIRE_VALIDATION_MAX) return null;
    commentaire = c || null;
  }
  // Un commentaire sans texte ne dit rien.
  if (b.decision === "commentaire" && !commentaire) return null;
  return { relecteurEmail, decision: b.decision as DecisionValidation, commentaire };
}

const instant = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const t = new Date(v as any).getTime();
  return Number.isNaN(t) ? null : t;
};

/**
 * Le statut d'un post d'après les décisions de la demande en cours (déjà filtrées sur
 * `validation_demandee_at`). Pour chaque relecteur de la liste, seule sa dernière décision
 * compte ; les commentaires ne décident rien ; un relecteur retiré de la liste ne compte plus.
 *  - un refus (dernière décision d'un relecteur) → refusee, quelle que soit la règle ;
 *  - « un » : une validation suffit ; « tous » : chaque relecteur de la liste a validé.
 */
export function statutApresDecisions(
  regle: RegleValidation,
  relecteurs: Relecteur[],
  decisions: Array<{ relecteurEmail: string; decision: string; createdAt?: Date | string | null }>,
): StatutValidation {
  const liste = new Set(relecteurs.map((r) => r.email.toLowerCase()));
  const derniere = new Map<string, { decision: string; t: number; i: number }>();
  decisions.forEach((d, i) => {
    const email = String(d.relecteurEmail ?? "").toLowerCase();
    if (!liste.has(email) || (d.decision !== "validee" && d.decision !== "refusee")) return;
    const t = instant(d.createdAt) ?? 0;
    const prec = derniere.get(email);
    if (!prec || t > prec.t || (t === prec.t && i > prec.i)) derniere.set(email, { decision: d.decision, t, i });
  });
  const valeurs = Array.from(derniere.values()).map((d) => d.decision);
  if (valeurs.includes("refusee")) return "refusee";
  if (regle === "un") return valeurs.includes("validee") ? "validee" : "a_valider";
  return liste.size > 0 && Array.from(liste).every((e) => derniere.get(e)?.decision === "validee") ? "validee" : "a_valider";
}

/**
 * Champs dont la modification remet un post en validation : tout ce qui change ce qui partira
 * (texte, médias, date, options du post, compte de publication).
 */
export const CHAMPS_RELANCE = [
  "body", "title", "mediaIds", "mediaUrl", "couvertureUrl", "scheduledFor",
  "premierCommentaire", "collaborateurs", "texteAlternatif", "postFormat", "socialAccountId",
  "couvertureOffsetMs", "nomAudio", "linkedinDocument", "reelDansLeFil",
] as const;

const memeValeur = (k: string, a: unknown, b: unknown): boolean => {
  if (k === "scheduledFor") return instant(a) === instant(b);
  if (k === "mediaIds" || k === "collaborateurs") return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
  // Le compte posé pour la première fois (programmation d'un post validé) ne change pas ce que
  // le client a vu ; en changer, si.
  if (k === "socialAccountId") return a == null || (a ?? null) === (b ?? null);
  if (a !== null && typeof a === "object") return JSON.stringify(a) === JSON.stringify(b ?? null);
  return (a ?? null) === (b ?? null);
};

/** Le patch change-t-il un champ que le client doit revoir ? (Sans regarder le statut.) */
export function editionTouchePublication(avant: Record<string, any>, patch: Record<string, any> | null | undefined): boolean {
  if (!avant || !patch) return false;
  return CHAMPS_RELANCE.some((k) => k in patch && !memeValeur(k, avant[k], patch[k]));
}

/**
 * Une modification d'un post en validation, validé ou refusé le remet « à valider » : le client
 * doit revoir ce qui partira vraiment. Seuls les champs PRÉSENTS dans le patch sont comparés.
 */
export function editionRelanceValidation(avant: Record<string, any>, patch: Record<string, any> | null | undefined): boolean {
  if (!avant || !patch) return false;
  if (!(STATUTS_VALIDATION as readonly string[]).includes(avant.validationStatut)) return false;
  return editionTouchePublication(avant, patch);
}

/** Un post dont le statut empêche la publication (marque avec validation active). */
export function bloqueParValidation(statut: unknown): boolean {
  return statut === "a_valider" || statut === "refusee";
}

export type DecisionPublication = { action: "publier" } | { action: "attendre" } | { action: "echec"; raison: "validation_manquante" | "validation_refusee" };

/**
 * Ce que le worker fait d'un post arrivé à son heure :
 *  - validation inactive pour sa marque, ou post validé / hors validation → publier ;
 *  - à valider ou refusé → attendre, jusqu'à 3 h après l'heure prévue ;
 *  - au-delà → échec (« validation_manquante » ou « validation_refusee ») et alerte.
 */
export function decisionPublication(p: {
  validationActive: boolean; statut: unknown; scheduledFor: Date | string | null | undefined; maintenant: Date;
}): DecisionPublication {
  if (!p.validationActive || !bloqueParValidation(p.statut)) return { action: "publier" };
  const t = instant(p.scheduledFor);
  if (t != null && p.maintenant.getTime() - t >= GRACE_VALIDATION_MIN * 60_000) {
    return { action: "echec", raison: p.statut === "refusee" ? "validation_refusee" : "validation_manquante" };
  }
  return { action: "attendre" };
}

/**
 * Limiteur en mémoire (par lien de portail) : fenêtre glissante. Rend false quand la limite est
 * atteinte (la demande n'est pas comptée).
 */
export function creerLimiteur(max = DECISIONS_PAR_FENETRE, fenetreMs = FENETRE_DECISIONS_MS) {
  const traces = new Map<string, number[]>();
  return (cle: string, maintenant: number): boolean => {
    const t = (traces.get(cle) ?? []).filter((x) => maintenant - x < fenetreMs);
    if (t.length >= max) { traces.set(cle, t); return false; }
    t.push(maintenant);
    traces.set(cle, t);
    if (traces.size > 5000) { const premiere = traces.keys().next().value; if (premiere !== undefined) traces.delete(premiere); }
    return true;
  };
}


// ── Portail public : jamais d'adresse email ──────────────────────────────────────────

/** « claire@domaine.fr » → « c***@d***.fr » : assez pour départager deux homonymes, pas pour écrire. */
export function masquerEmail(email: string): string {
  const [local = "", domaine = ""] = String(email ?? "").split("@");
  const point = domaine.lastIndexOf(".");
  const nomDomaine = point > 0 ? domaine.slice(0, point) : domaine;
  const tld = point > 0 ? domaine.slice(point) : "";
  return `${local.slice(0, 1)}***@${nomDomaine.slice(0, 1)}***${tld}`;
}

export interface RelecteurPublic { id: string; nom: string }

/**
 * Les relecteurs tels que le portail public les montre : un identifiant opaque (calculé par le
 * serveur, `idDe`) et un nom. Un relecteur sans nom (nom = adresse) ou deux homonymes sont
 * départagés par l'adresse MASQUÉE — l'adresse en clair ne sort jamais.
 */
export function relecteursPublics(relecteurs: Relecteur[], idDe: (email: string) => string): RelecteurPublic[] {
  const sansAdresse = (r: Relecteur) => (r.nom && r.nom.toLowerCase() !== r.email.toLowerCase() && !r.nom.includes("@") ? r.nom : "");
  const compte = new Map<string, number>();
  for (const r of relecteurs) {
    const n = sansAdresse(r).toLowerCase();
    if (n) compte.set(n, (compte.get(n) ?? 0) + 1);
  }
  return relecteurs.map((r) => {
    const nom = sansAdresse(r);
    const affiche = !nom ? masquerEmail(r.email) : (compte.get(nom.toLowerCase()) ?? 0) > 1 ? `${nom} (${masquerEmail(r.email)})` : nom;
    return { id: idDe(r.email), nom: affiche };
  });
}

/** Le nom public d'une adresse (décisions du portail) : celui de la liste, sinon l'adresse masquée. */
export function nomPublic(relecteurs: Relecteur[], email: string, idDe: (email: string) => string): string {
  const e = String(email ?? "").toLowerCase();
  const publics = relecteursPublics(relecteurs, idDe);
  const i = relecteurs.findIndex((r) => r.email.toLowerCase() === e);
  return i >= 0 ? publics[i].nom : masquerEmail(e);
}

/** L'adresse d'un relecteur d'après l'identifiant opaque choisi sur le portail ; null s'il est inconnu. */
export function relecteurParId(relecteurs: Relecteur[], id: unknown, idDe: (email: string) => string): Relecteur | null {
  if (typeof id !== "string" || !id || id.length > 100) return null;
  return relecteurs.find((r) => idDe(r.email) === id) ?? null;
}
