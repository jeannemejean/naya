// Atelier de contenu — types et appels au serveur (server/routes-atelier.ts).
import type { EtatPost, GenreAtelier, Manque } from "@shared/atelier";
import type { GenreMedia } from "@shared/programmation";

export interface MediaAtelier { id: number; url: string; mimeType: string | null; genre: GenreMedia }

export interface PostAtelier {
  id: number;
  title: string;
  body: string;
  consigne: string | null;
  platform: string;
  postFormat: string | null;
  genre: GenreAtelier;
  scheduledFor: string;
  projectId: number | null;
  projet: string | null;
  campaignId: number | null;
  tendanceProjetId: number | null;
  etat: EtatPost;
  programme: boolean;
  erreurPublication: string | null;
  medias: MediaAtelier[];
  manques: Manque[];
  compteConnecte: boolean;
}

export interface DonneesAtelier {
  semaine: string;
  posts: PostAtelier[];
  taches: Array<{ id: number; title: string; taskType: string; completed: boolean; scheduledDate: string | null; estimatedDuration: number | null }>;
}

export const cleAtelier = (semaine: string) => [`/api/atelier/${semaine}`];

export type ResultatValider =
  | { statut: "programme" | "a_publier_soi_meme" }
  | { statut: "manques"; manques: Array<Manque | "trop_de_visuels"> };

async function envoyer(method: string, url: string, body?: unknown): Promise<{ status: number; data: any }> {
  const res = await fetch(url, {
    method, credentials: "include",
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

const echec = (status: number, data: any) => new Error(data?.message || `http_${status}`);

export async function rediger(id: number): Promise<void> {
  const { status, data } = await envoyer("POST", `/api/atelier/posts/${id}/rediger`);
  if (status >= 400) throw echec(status, data);
}

export async function refaire(id: number, consigne: string): Promise<string> {
  const { status, data } = await envoyer("POST", `/api/atelier/posts/${id}/refaire`, { consigne });
  if (status >= 400) throw echec(status, data);
  return data.body as string;
}

export async function enregistrer(id: number, patch: { body?: string; scheduledFor?: string; postFormat?: string }): Promise<void> {
  const { status, data } = await envoyer("PATCH", `/api/atelier/posts/${id}`, patch);
  if (status >= 400) throw echec(status, data);
}

export async function valider(id: number, patch: { body?: string } = {}): Promise<ResultatValider> {
  const { status, data } = await envoyer("POST", `/api/atelier/posts/${id}/valider`, patch);
  if (status === 422) return data as ResultatValider;
  if (status >= 400) throw echec(status, data);
  return data as ResultatValider;
}

export async function devalider(id: number): Promise<void> {
  const { status, data } = await envoyer("DELETE", `/api/atelier/posts/${id}/valider`);
  if (status >= 400) throw echec(status, data);
}

export async function joindreVisuel(id: number, fichier: { url: string; name: string; type: string; size: number }): Promise<void> {
  const { status, data } = await envoyer("POST", `/api/atelier/posts/${id}/visuels`, {
    url: fichier.url, fileName: fichier.name, mimeType: fichier.type, size: fichier.size,
  });
  if (status >= 400) throw echec(status, data);
}

export async function retirerVisuel(id: number, mediaId: number): Promise<void> {
  const { status, data } = await envoyer("DELETE", `/api/atelier/posts/${id}/visuels/${mediaId}`);
  if (status >= 400) throw echec(status, data);
}
