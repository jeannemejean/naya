import { apiRequest } from "@/lib/queryClient";

export interface ResultatRefusPost {
  refuse: boolean;
  remplacement: { id: number; title: string; [k: string]: unknown } | null;
  raison?: string;
}

// Refuse un post du calendrier : le serveur le retire et, si demandé, en propose un autre.
export async function refuserPostApi(
  postId: number,
  reason: string,
  freeText: string | undefined,
  remplacer: boolean,
): Promise<ResultatRefusPost> {
  const res = await apiRequest("POST", `/api/content/${postId}/refuser`, {
    reason,
    freeText: freeText ?? "",
    remplacer,
  });
  return res.json();
}
