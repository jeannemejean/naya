import { apiRequest } from "@/lib/queryClient";

export interface ResultatRefus {
  refusee: boolean;
  remplacement: { id: number; title: string; [k: string]: unknown } | null;
  raison?: string;
}

// Refuse une tâche : le serveur la retire et tente de proposer un remplacement.
export async function refuserTacheApi(taskId: number, reason: string, freeText?: string): Promise<ResultatRefus> {
  const res = await apiRequest("POST", `/api/tasks/${taskId}/refuser`, { reason, freeText: freeText ?? "" });
  return res.json();
}
