// Logique pure de la boîte « Réponses » (testée sans rendu).

export type RaisonEnvoi =
  | "envoi_coupe" | "compte_restreint" | "compte_deconnecte" | "compte_absent"
  | "envoi_en_cours" | "deja_envoye" | "texte_vide" | "texte_trop_long" | "introuvable" | "desinscrit" | "echec";

const RAISONS_CONNUES: readonly string[] = [
  "envoi_coupe", "compte_restreint", "compte_deconnecte", "compte_absent",
  "envoi_en_cours", "deja_envoye", "texte_vide", "texte_trop_long", "introuvable", "desinscrit", "echec",
];

/** Clé i18n du message d'un refus d'envoi ; toute raison inconnue retombe sur « echec ». */
export function cleErreurEnvoi(raison: unknown): string {
  return `outreach.reponses.erreurs.${typeof raison === "string" && RAISONS_CONNUES.includes(raison) ? raison : "echec"}`;
}

/** Clé i18n du message de « Ce n'était pas une vraie réponse ». */
export function cleErreurPasUneReponse(raison: unknown): string {
  return raison === "deja_repondu"
    ? "outreach.reponses.pasUneReponse.dejaRepondu"
    : "outreach.reponses.pasUneReponse.echec";
}

export interface MessageFil {
  id: string;
  sens: "entrant" | "sortant" | string;
  nature: "reponse" | "absence" | "accuse" | "nous" | "en_attente" | string;
  canal?: string | null;
  subject?: string | null;
  body: string | null;
  sentAt: string | Date;
  /** Relance lue dans cette réponse (proposition, ou déjà validée). */
  relance?: VueRelanceClient;
}

export type VueRelanceClient =
  | { statut: "proposee"; date: string }
  | { statut: "en_cours"; date: string | null }
  | { statut: "validee"; date: string | null; taskId: number; faite: boolean };

/** Identifiant numérique d'un message de la boîte (« inbox-42 » → 42), ou null. */
export function idMessageBoite(id: string): number | null {
  const m = /^inbox-(\d+)$/.exec(id);
  return m ? Number(m[1]) : null;
}

/** « lundi 4 janvier » (+ l'année si ce n'est pas celle de `now`), pour une date AAAA-MM-JJ. */
export function jourLisible(date: string | null | undefined, locale: string, now: Date = new Date()): string {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
  const d = new Date(`${date}T12:00:00Z`);
  const annee = d.getUTCFullYear() !== now.getFullYear();
  return d.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", ...(annee ? { year: "numeric" } : {}), timeZone: "UTC" });
}

/** Prénom (premier mot du nom). */
export const prenom = (nom: string | null | undefined) => (nom ?? "").trim().split(/\s+/)[0] || "";

/** Clé i18n d'un refus de validation de relance ; inconnue → « echec ». */
export function cleErreurRelance(raison: unknown): string {
  const connues = ["date_passee", "jour_non_travaille", "date_invalide", "pas_de_date", "refusee", "en_cours", "signature_client", "introuvable"];
  return `outreach.reponses.relance.erreurs.${typeof raison === "string" && connues.includes(raison) ? raison : "echec"}`;
}

export type TypeBulle = "entrant" | "sortant" | "en_attente" | "discret";

/** Absences et accusés sont discrets ; un envoi pas encore confirmé est « en cours ». */
export function typeBulle(m: Pick<MessageFil, "sens" | "nature">): TypeBulle {
  if (m.nature === "en_attente") return "en_attente";
  if (m.nature === "absence" || m.nature === "accuse") return "discret";
  return m.sens === "entrant" ? "entrant" : "sortant";
}

/** Fil dans l'ordre chronologique (stable : l'entrée n'est pas modifiée). */
export function ordonnerFil<T extends Pick<MessageFil, "sentAt">>(messages: T[]): T[] {
  return messages
    .map((m, i) => ({ m, i, t: new Date(m.sentAt).getTime() }))
    .sort((a, b) => (a.t - b.t) || (a.i - b.i))
    .map((x) => x.m);
}

/** Date relative courte (« il y a 3 h »), dans la langue donnée. */
export function dateRelative(date: string | Date | null | undefined, now: Date, locale: string): string {
  if (!date) return "";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  const s = Math.round((d.getTime() - now.getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const a = Math.abs(s);
  if (a < 60) return locale.startsWith("fr") ? "à l'instant" : "just now";
  if (a < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (a < 86400) return rtf.format(Math.round(s / 3600), "hour");
  if (a < 86400 * 30) return rtf.format(Math.round(s / 86400), "day");
  return d.toLocaleDateString(locale, { day: "numeric", month: "short" });
}

/** Date et heure absolues (« 5 nov., 19:10 ») : sous chaque bulle, à côté du relatif. */
export function dateHeure(date: string | Date | null | undefined, locale: string): string {
  if (!date) return "";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

// ── Campagnes : une seule boîte, chaque conversation porte l'étiquette de sa campagne ──

/**
 * Couleurs d'étiquette (tokens de la palette Naya, fonds clairs + texte sombre — jamais de
 * `text-white`). Classes écrites en entier pour que Tailwind les garde.
 */
export const PALETTE_CAMPAGNES: readonly string[] = [
  "bg-sulphur-subtle text-sulphur-text border-naya-sulphur/50",
  "bg-salvia-subtle text-salvia-text border-naya-salvia/50",
  "bg-mauve-subtle text-mauve-text border-naya-mauve/50",
  "bg-naya-olive-10 text-naya-olive border-naya-olive-18",
  "bg-naya-sulphur/35 text-naya-olive border-naya-sulphur",
  "bg-naya-salvia/30 text-salvia-text border-naya-salvia",
];

/** Couleur stable d'une campagne, dérivée de son id (la même partout, d'une visite à l'autre). */
export function couleurCampagne(id: number | null | undefined): string {
  if (id == null || !Number.isFinite(id)) return PALETTE_CAMPAGNES[3];
  const n = PALETTE_CAMPAGNES.length;
  return PALETTE_CAMPAGNES[((Math.trunc(id) % n) + n) % n];
}

/** Campagne choisie dans l'URL (`?campagne=12`), ou null. */
export function campagneDepuisRecherche(search: string): number | null {
  const v = Number(new URLSearchParams(search).get("campagne"));
  return Number.isInteger(v) && v > 0 ? v : null;
}

/** URL de l'onglet Réponses, filtre campagne et conversation ouverte compris. */
export function urlReponses(o: { campagne?: number | null; conversation?: number | null } = {}): string {
  return `/outreach?onglet=reponses${o.campagne ? `&campagne=${o.campagne}` : ""}${o.conversation ? `&conversation=${o.conversation}` : ""}`;
}

type AvecCampagne = { campaignId?: number | null; campaignName?: string | null };

/** Filtre campagne (null : toutes). */
export function filtrerParCampagne<T extends AvecCampagne>(liste: T[], campagne: number | null): T[] {
  return campagne == null ? liste : liste.filter((c) => c.campaignId === campagne);
}

/** Campagnes présentes dans la liste, par nom, sans doublon. */
export function campagnesDeListe(liste: AvecCampagne[]): Array<{ id: number; name: string }> {
  const vues = new Map<number, string>();
  for (const c of liste) if (c.campaignId != null && !vues.has(c.campaignId)) vues.set(c.campaignId, c.campaignName ?? "");
  return Array.from(vues, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

/** Campagnes connues + campagnes vues dans la liste, sans doublon (les premières gardent leur nom), par nom. */
export function fusionnerCampagnes(
  connues: Array<{ id: number; name: string }>, vues: Array<{ id: number; name: string }>,
): Array<{ id: number; name: string }> {
  const parId = new Map<number, string>();
  for (const c of [...connues, ...vues]) if (!parId.has(c.id)) parId.set(c.id, c.name);
  return Array.from(parId, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

/** Nombre de conversations « à traiter » par campagne (carte de l'onglet Campagnes). */
export function compterATraiterParCampagne(liste: Array<AvecCampagne & { statut?: string }>): Map<number, number> {
  const compte = new Map<number, number>();
  for (const c of liste) {
    if (c.campaignId == null || c.statut !== "a_traiter") continue;
    compte.set(c.campaignId, (compte.get(c.campaignId) ?? 0) + 1);
  }
  return compte;
}
