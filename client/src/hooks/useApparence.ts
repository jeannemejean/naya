import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { APPARENCE_DEFAUT, normaliserApparence, saisonEffective, type Apparence, type Saison } from "@shared/saisons";

const FUSEAU_REPLI = "Europe/Paris";

// `enabled` : la requête renvoie 401 hors connexion, on évite de la lancer pour rien.
export function useApparence(enabled = true): {
  apparence: Apparence;
  saison: Saison;
  fuseau: string;
  modifier: (a: Partial<Apparence>) => void;
} {
  const queryClient = useQueryClient();
  const { data: prefs } = useQuery<{ apparence?: unknown; timezone?: string | null }>({
    queryKey: ["/api/preferences"],
    enabled,
    retry: false,
  });

  const apparence = useMemo(
    () => (prefs ? normaliserApparence(prefs.apparence) : { ...APPARENCE_DEFAUT }),
    [prefs],
  );
  // « UTC » est la valeur par défaut de la base, pas un choix : on retombe sur Paris.
  const fuseau = !prefs?.timezone || prefs.timezone === "UTC" ? FUSEAU_REPLI : prefs.timezone;
  const saison = saisonEffective(apparence, new Date(), fuseau);

  const mutation = useMutation({
    mutationFn: (a: Apparence) => apiRequest("PATCH", "/api/preferences", { apparence: a }).then((r) => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/preferences"] }),
  });

  return { apparence, saison, fuseau, modifier: (a) => mutation.mutate({ ...apparence, ...a }) };
}
