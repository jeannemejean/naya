import { sql } from "drizzle-orm";
import { readingCards } from "@shared/schema";

/**
 * Le statut d'une fiche APRÈS qu'on y a répondu, décidé par le SQL lui-même.
 *
 * Le cycle du spec est `proposed → answered → kept`, mais aussi bien
 * `proposed → kept → answered` : rien n'oblige à répondre avant de garder. Écrire
 * `status = 'answered'` inconditionnellement — ce que faisait l'endpoint — retournait
 * la valeur des deux états : la fiche qu'elle avait délibérément conservée retombait
 * dans le lot du jour et quittait l'écran au minuit suivant, tandis que la fiche gardée
 * et JAMAIS répondue restait visible indéfiniment. « Garder » doit survivre à une
 * réponse : c'est la seule action volontaire de conservation du produit.
 *
 * Expression SQL plutôt que lecture préalable puis écriture : le statut est lu et écrit
 * dans le même UPDATE, donc un « Garder » qui arrive entre les deux ne peut pas être
 * écrasé.
 */
export const statutApresReponse = sql`CASE WHEN ${readingCards.status} = 'kept' THEN 'kept' ELSE 'answered' END`;
