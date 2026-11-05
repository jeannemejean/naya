// Marquage des prospects test (mode test de la prospection), partagé serveur / client.
// Sans migration : `leads.tags` (colonne jusque-là inutilisée) porte la marque.

/** Marque d'un prospect test dans `leads.tags`. */
export const TAG_LEAD_TEST = "naya_test";

/** Le prospect est-il un prospect test ? Pure. */
export function estLeadTest(lead: { tags?: string[] | null } | null | undefined): boolean {
  return Array.isArray(lead?.tags) && lead!.tags!.includes(TAG_LEAD_TEST);
}
