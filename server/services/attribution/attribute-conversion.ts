/**
 * MOTEUR D'ATTRIBUTION IDEMPOTENT — wrapper DB autour des fonctions pures de `attribute.ts`.
 *
 * Deux propriétés non négociables :
 *
 * 1. La fenêtre est FIGÉE sur la conversion. Ce moteur ne lit `attributionWindowDays` QUE
 *    sur la ligne de `brand_conversions`, jamais sur le projet. Si on relisait le projet,
 *    changer la fenêtre d'une marque réécrirait silencieusement tout son historique
 *    d'attribution passé — un résultat passé changerait à cause d'un réglage présent, ce qui
 *    rendrait tous les chiffres historiques non fiables.
 *
 * 2. Le recalcul est IDEMPOTENT. Rejouer `attributeConversion` sur la même conversion
 *    REMPLACE ses lignes, ne les ajoute jamais. Le remplacement (suppression + insertion) se
 *    fait dans `storage.replaceConversionAttributions`, dans une seule transaction.
 *
 * Une fenêtre vide écrit zéro ligne et n'est PAS une erreur : la conversion existe, elle
 * n'est créditée à personne.
 */

import { storage } from "../../storage";
import { selectContentsInWindow, attribute, type ConversionForAttribution } from "./attribute";
import type { ConversionAttribution } from "@shared/schema";

export async function attributeConversion(conversionId: number): Promise<ConversionAttribution[]> {
  const conversion = await storage.getBrandConversion(conversionId);
  if (!conversion) {
    throw new Error(`Conversion ${conversionId} introuvable`);
  }
  if (conversion.attributionWindowDays == null) {
    // Ne devrait jamais arriver : createBrandConversion exige ce champ. Si on l'atteint quand
    // même, c'est une donnée corrompue — pas un cas où on va chercher un défaut ailleurs
    // (surtout pas sur le projet : ce serait exactement le bug que ce moteur interdit).
    throw new Error(
      `Conversion ${conversionId} n'a pas de fenêtre d'attribution figée sur sa ligne — impossible d'attribuer sans la lire (à tort) depuis le projet.`,
    );
  }

  // La fenêtre vient de la CONVERSION, jamais d'un `storage.getProject(...)`.
  const conversionPourAttribution: ConversionForAttribution = {
    id: conversion.id,
    projectId: conversion.projectId,
    convertedAt: conversion.convertedAt,
    attributionWindowDays: conversion.attributionWindowDays,
  };

  const candidats = await storage.getContentCandidatesForProject(conversion.projectId);
  const contenusDansLaFenetre = selectContentsInWindow(conversionPourAttribution, candidats);
  const lignes = attribute(conversionPourAttribution, contenusDansLaFenetre);

  // Remplacement transactionnel : c'est cet appel unique (delete + insert côté storage) qui
  // rend le rejeu idempotent — jamais un ajout manuel ici.
  return await storage.replaceConversionAttributions(conversionId, lignes);
}
