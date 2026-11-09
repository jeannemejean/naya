// Hooks de la boîte « Réponses » (routes de server/routes-reponses.ts).
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Lead } from "@shared/schema";
import type { MessageFil } from "./reponses-logique";

export interface ConversationListe {
  id: number; leadId: number; leadName: string; company: string | null; channel: string; statut: string;
  nonLu: boolean; extrait: string | null; lastMessageAt: string | null; projectId: number | null;
  /** Absents d'un serveur plus ancien : traités comme « hors campagne ». */
  campaignId?: number | null; campaignName?: string | null;
}
export interface ConversationDetail {
  conversation: { id: number; channel: string; statut: string; nonLu: boolean; leadId: number; projectId: number | null };
  lead: Lead;
  campagne: { id: number; name: string; projectId: number | null; offer?: string | null; messageAngle?: string | null } | null;
  messages: MessageFil[];
  /** Relance validée dont le jour est arrivé : son brouillon, à reprendre dans « Ta réponse ». */
  relancePrete?: { taskId: number; messageId: number; date: string; texte: string } | null;
}
export type ResultatEnvoiClient = { ok: true } | { ok: false; raison: string };

const CLE_LISTE = "/api/reponses";
const invalider = () => queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/reponses") });

/** Pastille de l'onglet : rafraîchie toutes les 60 s. */
export const useReponsesCompte = () =>
  useQuery<{ aTraiter: number }>({ queryKey: ["/api/reponses/compte"], refetchInterval: 60_000 });

export const urlListe = (statut: "a_traiter" | "traitee", projectId?: number | null) =>
  `${CLE_LISTE}?statut=${statut}${projectId ? `&projectId=${projectId}` : ""}`;

export const useReponsesListe = (statut: "a_traiter" | "traitee", projectId?: number | null) =>
  useQuery<ConversationListe[]>({ queryKey: [urlListe(statut, projectId)], refetchInterval: 60_000 });

export const useConversation = (id: number | null) =>
  useQuery<ConversationDetail>({ queryKey: [`/api/reponses/${id}`], enabled: id != null });

export const useProposerReponse = (id: number) =>
  useMutation<{ texte: string }, Error>({
    mutationFn: async () => (await apiRequest("POST", `/api/reponses/${id}/proposition`)).json(),
  });

/** Un refus (4xx/5xx avec { ok:false, raison }) est rendu comme résultat, pas comme exception. */
export const useEnvoyerReponse = (id: number) =>
  useMutation<ResultatEnvoiClient, Error, string>({
    mutationFn: async (texte) => {
      const res = await fetch(`/api/reponses/${id}/envoyer`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ texte }),
      });
      const corps = await res.json().catch(() => null);
      if (corps && typeof corps.ok === "boolean") return corps as ResultatEnvoiClient;
      return { ok: false, raison: res.status === 404 ? "introuvable" : "echec" };
    },
    onSettled: invalider,
  });

export const useMarquerTraitee = (id: number) =>
  useMutation<unknown, Error>({
    mutationFn: async () => (await apiRequest("POST", `/api/reponses/${id}/traitee`)).json(),
    onSettled: () => { invalider(); queryClient.invalidateQueries({ queryKey: ["/api/tasks"] }); },
  });

export const usePasUneReponse = (id: number) =>
  useMutation<{ ok: boolean; restaure?: boolean; raison?: string }, Error>({
    mutationFn: async () => {
      const res = await fetch(`/api/reponses/${id}/pas-une-reponse`, { method: "POST", credentials: "include" });
      const corps = await res.json().catch(() => ({}));
      if (res.status === 409 && corps?.raison === "deja_repondu") return { ok: false, raison: "deja_repondu" };
      if (!res.ok) throw new Error(String(res.status));
      return corps;
    },
    onSettled: () => { invalider(); queryClient.invalidateQueries({ queryKey: ["/api/tasks"] }); },
  });

// ── Relances demandées par le prospect (« revenez vers moi en septembre »). Valider crée une
// tâche datée avec le message déjà rédigé ; rien n'est jamais envoyé sans « Envoyer ».

export type ResultatRelance = { ok: true; taskId: number; date: string; deja?: boolean } | { ok: false; raison: string };

const postJson = async (url: string, corps?: unknown) => {
  const res = await fetch(url, {
    method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps ?? {}),
  });
  const json = await res.json().catch(() => null);
  return { res, json };
};

export const useValiderRelance = (id: number) =>
  useMutation<ResultatRelance, Error, { messageId: number; date?: string }>({
    mutationFn: async ({ messageId, date }) => {
      const { res, json } = await postJson(`/api/reponses/${id}/relances/${messageId}/valider`, date ? { date } : {});
      if (json && typeof json.ok === "boolean") return json as ResultatRelance;
      return { ok: false, raison: res.status === 404 ? "introuvable" : "echec" };
    },
    onSettled: () => { invalider(); queryClient.invalidateQueries({ queryKey: ["/api/tasks"] }); },
  });

export const useRefuserRelance = (id: number) =>
  useMutation<{ ok: boolean; raison?: string }, Error, number>({
    mutationFn: async (messageId) => {
      const { json } = await postJson(`/api/reponses/${id}/relances/${messageId}/refuser`);
      return json && typeof json.ok === "boolean" ? json : { ok: false, raison: "echec" };
    },
    onSettled: invalider,
  });

export const useReformulerRelance = (id: number) =>
  useMutation<{ texte: string }, Error, number>({
    mutationFn: async (messageId) => (await apiRequest("POST", `/api/reponses/${id}/relances/${messageId}/proposition`)).json(),
  });
