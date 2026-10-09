// Validation des messages préparés par Naya (onglet Prospects d'une campagne).
//
// Miroir client de server/services/prospection-verification.ts (`prospectsAValider`) : un
// prospect attend une validation quand Naya a rédigé ses messages (`messages_ready`) et que
// personne ne les a encore approuvés. `validatedAt` arrive en JSON, donc en chaîne ISO.

export interface ProspectValidable {
  id: number;
  stage?: string | null;
  validatedAt?: string | Date | null;
  archivedAt?: string | Date | null;
  linkedinMessage?: string | null;
  emailMessage?: string | null;
  message1?: string | null;
  message2?: string | null;
}

/** Même règle que `estValide` côté serveur : une date absente ou illisible vaut « jamais validé ». */
export function estValide(validatedAt: string | Date | null | undefined): boolean {
  if (validatedAt == null || validatedAt === "") return false;
  const d = validatedAt instanceof Date ? validatedAt : new Date(validatedAt);
  return !Number.isNaN(d.getTime());
}

export function attendValidation(l: ProspectValidable): boolean {
  return l.stage === "messages_ready" && !estValide(l.validatedAt) && !l.archivedAt;
}

export function prospectsAValider<T extends ProspectValidable>(leads: T[]): T[] {
  return leads.filter(attendValidation);
}

/** Validé et toujours à l'étape où il peut être contacté. */
export function estPretAPartir(l: ProspectValidable): boolean {
  return l.stage === "messages_ready" && estValide(l.validatedAt) && !l.archivedAt;
}

export type ChampMessage = "linkedinMessage" | "emailMessage";

export interface MessageAValider {
  champ: ChampMessage;
  canal: "linkedin" | "email";
  texte: string;
}

/** Messages à relire, champs actuels d'abord, champs historiques (message1/2) en repli. */
export function messagesAValider(l: ProspectValidable): MessageAValider[] {
  const out: MessageAValider[] = [];
  const linkedin = l.linkedinMessage || l.message1;
  const email = l.emailMessage || l.message2;
  if (linkedin) out.push({ champ: "linkedinMessage", canal: "linkedin", texte: linkedin });
  if (email) out.push({ champ: "emailMessage", canal: "email", texte: email });
  return out;
}

/** Limite de LinkedIn pour une note de connexion. */
export const LIMITE_NOTE_LINKEDIN = 200;

export function depasseLimite(m: Pick<MessageAValider, "canal" | "texte">): boolean {
  return m.canal === "linkedin" && m.texte.length > LIMITE_NOTE_LINKEDIN;
}

/**
 * Champs à écrire quand l'utilisatrice corrige un message. Le champ historique est tenu à jour
 * pour que l'affichage (fiche prospect, cartes) montre le texte corrigé.
 */
export function miseAJourMessage(champ: ChampMessage, texte: string): Record<string, string> {
  return champ === "linkedinMessage"
    ? { linkedinMessage: texte, message1: texte }
    : { emailMessage: texte, message2: texte };
}
