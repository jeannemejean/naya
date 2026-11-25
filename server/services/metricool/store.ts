// Connexion Metricool d'une utilisatrice : jeton chiffré au repos, jamais renvoyé ni journalisé.
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { connexionsMetricool } from "@shared/schema";
import { decryptToken, encryptToken } from "../token-crypto";
import type { ConnexionMc } from "./client";

export async function lireConnexionMetricool(userId: string): Promise<ConnexionMc | null> {
  const [l] = await db.select().from(connexionsMetricool).where(eq(connexionsMetricool.userId, userId)).limit(1);
  const jeton = l ? decryptToken(l.jetonChiffre) : null;
  return l && jeton ? { jeton, mcUserId: l.mcUserId, blogId: l.blogId } : null;
}

export async function etatConnexionMetricool(userId: string): Promise<{ connecte: boolean; etat?: string; blogId?: string; verifieLe?: Date | null }> {
  const [l] = await db.select().from(connexionsMetricool).where(eq(connexionsMetricool.userId, userId)).limit(1);
  return l ? { connecte: true, etat: l.etat, blogId: l.blogId, verifieLe: l.verifieLe } : { connecte: false };
}

export async function enregistrerConnexionMetricool(userId: string, cx: ConnexionMc, etat: "ok" | "refuse", maintenant: Date): Promise<void> {
  const valeurs = { jetonChiffre: encryptToken(cx.jeton), mcUserId: cx.mcUserId, blogId: cx.blogId, etat, verifieLe: maintenant };
  await db.insert(connexionsMetricool).values({ userId, ...valeurs })
    .onConflictDoUpdate({ target: connexionsMetricool.userId, set: valeurs });
}

export async function marquerEtat(userId: string, etat: "ok" | "refuse"): Promise<void> {
  await db.update(connexionsMetricool).set({ etat }).where(eq(connexionsMetricool.userId, userId));
}

export async function supprimerConnexionMetricool(userId: string): Promise<void> {
  await db.delete(connexionsMetricool).where(eq(connexionsMetricool.userId, userId));
}
