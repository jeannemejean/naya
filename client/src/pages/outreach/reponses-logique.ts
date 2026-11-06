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
