import { apiRequest } from "@/lib/queryClient";
import { limiteOctets, typeAccepte, type LivrableKind } from "@shared/livrables";
import type { Livrable } from "@shared/schema";

export type LivrableClient = Omit<Livrable, "createdAt" | "updatedAt"> & { createdAt: string; updatedAt: string };

export const cleLivrablesTache = (taskId: number) => [`/api/tasks/${taskId}/livrables`] as const;
/** Toute liste de livrables (tâche ou projet) : sert à l'invalidation après dépôt/modification/suppression. */
export const estCleListeLivrables = (key: readonly unknown[]) =>
  typeof key[0] === "string" && key[0].endsWith("/livrables");

/** Post auquel une tâche de production est rattachée (GET /api/tasks/:id/post), ou null. */
export interface PostDeTache {
  id: number;
  title: string;
  body: string;
  platform: string;
  postFormat: string | null;
  scheduledFor: string | null;
  modifiable: boolean;
  medias: { id: number; url: string; mimeType: string }[];
  effet: { texte: boolean; media: boolean };
}
export const clePostTache = (taskId: number) => [`/api/tasks/${taskId}/post`] as const;

/** Ce que le dépôt a changé dans le post (réponse de POST/PATCH /api/livrables). */
export type EffetDepot = { contentId: number; texte?: boolean; media?: boolean } | null;

export const cleLivrablesProjet = (projectId: number) => [`/api/projects/${projectId}/livrables`] as const;

/** Upload direct vers R2 via URL présignée. Vérifie taille et type AVANT d'envoyer. */
export async function televerser(kind: "media" | "fichier", file: File): Promise<{ url: string }> {
  const contentType = file.type || "application/octet-stream";
  if (!typeAccepte(kind, contentType)) throw new Error("unsupported_content_type");
  if (file.size > limiteOctets(kind, contentType)) throw new Error("file_too_large");

  const res = await fetch("/api/livrables/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ kind, filename: file.name, contentType, size: file.size }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message || "upload_failed");
  }
  const { uploadUrl, url } = await res.json();
  const put = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": contentType }, body: file });
  if (!put.ok) throw new Error("upload_failed");
  return { url };
}

export async function creerLivrableApi(body: {
  taskId: number;
  kind: LivrableKind;
  content?: string | null;
  url?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  size?: number | null;
}): Promise<LivrableClient & { post?: EffetDepot }> {
  return (await apiRequest("POST", "/api/livrables", body)).json();
}

export async function modifierLivrableApi(id: number, content: string | null): Promise<LivrableClient & { post?: EffetDepot }> {
  return (await apiRequest("PATCH", `/api/livrables/${id}`, { content })).json();
}

export async function supprimerLivrableApi(id: number): Promise<void> {
  await apiRequest("DELETE", `/api/livrables/${id}`);
}
