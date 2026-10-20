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

  type Prefs = { apparence?: unknown; timezone?: string | null };
  const CLE = ["/api/preferences"];

  // Mise à jour optimiste : le décor change tout de suite, et deux choix rapprochés
  // (saison puis décor) ne s'écrasent pas en attendant le retour du serveur.
  const mutation = useMutation({
    mutationFn: (a: Apparence) => apiRequest("PATCH", "/api/preferences", { apparence: a }).then((r) => r.json()),
    onMutate: async (a: Apparence) => {
      await queryClient.cancelQueries({ queryKey: CLE });
      const avant = queryClient.getQueryData<Prefs>(CLE);
      queryClient.setQueryData<Prefs>(CLE, (p) => ({ ...(p ?? {}), apparence: a }));
      return { avant };
    },
    onError: (_e, _a, ctx) => {
      // Retour arrière : on remet les préférences d'avant ce choix.
      if (ctx) queryClient.setQueryData(CLE, ctx.avant);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: CLE }),
  });

  // Fusion sur la valeur la plus récente du cache (pas celle du dernier rendu).
  const modifier = (a: Partial<Apparence>) => {
    const actuelle = queryClient.getQueryData<Prefs>(CLE);
    const base = actuelle ? normaliserApparence(actuelle.apparence) : apparence;
    mutation.mutate({ ...base, ...a });
  };

  return { apparence, saison, fuseau, modifier };
}
