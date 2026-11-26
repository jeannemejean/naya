// Connexion Metricool d'une utilisatrice : jeton chiffré au repos, jamais renvoyé ni journalisé.
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { connexionsMetricool } from "@shared/schema";
import { decryptToken, encryptToken } from "../token-crypto";
import type { ConnexionMarquesMc, MarqueMc } from "./client";

// Une connexion d'avant les marques multiples n'a que blog_id : elle suit cette seule marque.
const marquesDe = (l: { marques: MarqueMc[] | null; blogId: string }): MarqueMc[] =>
  l.marques?.length ? l.marques : [{ blogId: l.blogId, nom: l.blogId }];

export async function lireConnexionMetricool(userId: string): Promise<ConnexionMarquesMc | null> {
  const [l] = await db.select().from(connexionsMetricool).where(eq(connexionsMetricool.userId, userId)).limit(1);
  const jeton = l ? decryptToken(l.jetonChiffre) : null;
  return l && jeton ? { jeton, mcUserId: l.mcUserId, marques: marquesDe(l) } : null;
}

export async function etatConnexionMetricool(userId: string): Promise<{ connecte: boolean; etat?: string; marques?: MarqueMc[]; verifieLe?: Date | null }> {
  const [l] = await db.select().from(connexionsMetricool).where(eq(connexionsMetricool.userId, userId)).limit(1);
  return l ? { connecte: true, etat: l.etat, marques: marquesDe(l), verifieLe: l.verifieLe } : { connecte: false };
}

export async function enregistrerConnexionMetricool(userId: string, cx: ConnexionMarquesMc, etat: "ok" | "refuse", maintenant: Date): Promise<void> {
  const valeurs = { jetonChiffre: encryptToken(cx.jeton), mcUserId: cx.mcUserId, blogId: cx.marques[0]?.blogId ?? "", marques: cx.marques, etat, verifieLe: maintenant };
  await db.insert(connexionsMetricool).values({ userId, ...valeurs })
    .onConflictDoUpdate({ target: connexionsMetricool.userId, set: valeurs });
}

export async function marquerEtat(userId: string, etat: "ok" | "refuse"): Promise<void> {
  await db.update(connexionsMetricool).set({ etat }).where(eq(connexionsMetricool.userId, userId));
}

export async function supprimerConnexionMetricool(userId: string): Promise<void> {
  await db.delete(connexionsMetricool).where(eq(connexionsMetricool.userId, userId));
}
