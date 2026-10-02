// Verrou du MÉCANISME derrière le correctif Critique de `campaigns.tsx` (apercuRejetQuery) :
// que `staleTime: 0` fait bien repartir une requête désactivée-puis-réactivée — y compris
// sous les MÊMES defaults globaux que ce dépôt (`staleTime: Infinity`, `refetchOnWindowFocus:
// false`, `client/src/lib/queryClient.ts`) — et que `isFetching` repasse vrai AU MÊME INSTANT
// où la donnée visible (`.data`) est encore l'ANCIENNE valeur périmée.
//
// `QueryObserver` est une classe framework-agnostique de `@tanstack/react-query` (le même
// moteur que `useQuery`) : aucun composant, aucun rendu, aucun DOM n'est nécessaire pour
// l'exercer — ce test tourne donc en environnement `node`, comme le reste de ce dépôt qui
// n'a pas de jsdom (voir le commentaire de `@/lib/one-shot-guard`).
//
// CE QUE CE TEST NE COUVRE PAS, faute de jsdom : le JSX réel de `campaigns.tsx` — le
// gating `{!apercuRejetQuery.isFetching && apercuRejetQuery.data && ...}` et le `disabled`
// du bouton de confirmation (`apercuRejetQuery.isFetching || apercuRejetQuery.isError ||
// !apercuRejetQuery.data`) — n'est pas exécutable en test : `campaigns.tsx` contient du
// JSX, et ce dépôt a `tsconfig.json` en `"jsx": "preserve"` sans plugin React dans
// `vitest.config.ts` (même contrainte que `ErrorBoundary.tsx`, documentée dans
// `one-shot-guard.ts`). Ce test prouve que le MÉCANISME sur lequel ce JSX s'appuie se
// comporte exactement comme le commentaire du correctif l'affirme (isFetching vrai, data
// périmée encore présente, au moment précis de la réouverture) ; il ne prouve pas que le
// JSX lit effectivement ces deux champs au bon endroit — ce dernier pas reste couvert
// uniquement par relecture du code, pas par un test automatisé.

import { describe, it, expect } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("apercuRejetQuery — le mécanisme react-query derrière le correctif Critique", () => {
  it("staleTime: 0 relance une requête désactivée-puis-réactivée (même sous staleTime: Infinity en défaut global), et isFetching repasse vrai PENDANT que data porte encore l'ancienne valeur", async () => {
    // Mêmes defaults globaux que client/src/lib/queryClient.ts — pour que ce test échoue
    // si jamais quelqu'un retire `staleTime: 0` de la query en pensant, à tort, que le
    // défaut global suffirait.
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: Infinity,
          refetchOnWindowFocus: false,
          refetchInterval: false,
          retry: false,
        },
      },
    });

    const reponses = [
      { contenusGardes: 0, contenusPartants: 0 }, // 1er vol : campagne tout juste générée, vide
      { contenusGardes: 9, contenusPartants: 3 }, // 2e vol : campagne relancée, posts créés
    ];
    let appels = 0;
    const resolveurs: Array<() => void> = [];
    const queryFn = () => {
      const index = appels++;
      return new Promise((resolve) => {
        resolveurs.push(() => resolve(reponses[index]));
      });
    };

    const optionsBase = {
      queryKey: ["/api/campaigns", 1, "reject-preview"] as const,
      queryFn,
      staleTime: 0, // le correctif
    };

    const observer = new QueryObserver(queryClient, { ...optionsBase, enabled: false });
    const unsubscribe = observer.subscribe(() => {});

    try {
      // Ouverture du dialogue : enabled passe à vrai → 1er fetch.
      observer.setOptions({ ...optionsBase, enabled: true });
      expect(appels).toBe(1);
      resolveurs[0]();
      await flush();

      expect(observer.getCurrentResult().data).toEqual({ contenusGardes: 0, contenusPartants: 0 });
      expect(observer.getCurrentResult().isFetching).toBe(false);

      // Annulation : dialogue fermé.
      observer.setOptions({ ...optionsBase, enabled: false });

      // (Entre les deux, côté serveur : la campagne est lancée — posts/tâches créés. Cette
      // clé n'est invalidée par rien dans campaigns.tsx : c'est exactement le Critique.)

      // Réouverture du dialogue.
      observer.setOptions({ ...optionsBase, enabled: true });

      // L'ASSERTION CLÉ : à cet instant précis — synchrone, avant que le 2e fetch ait
      // résolu — isFetching doit déjà être vrai (sinon rien dans le JSX ne pourrait s'en
      // garder) ET data doit encore porter l'ANCIENNE valeur (0, 0). C'est exactement
      // pourquoi staleTime: 0 seul ne suffit pas : il relance la requête, mais ne cache
      // pas la valeur périmée pendant le vol — d'où le gating sur isFetching dans le JSX.
      const pendantLeVol = observer.getCurrentResult();
      expect(appels).toBe(2);
      expect(pendantLeVol.isFetching).toBe(true);
      expect(pendantLeVol.data).toEqual({ contenusGardes: 0, contenusPartants: 0 });

      // Résolution du 2e fetch : les vrais chiffres arrivent.
      resolveurs[1]();
      await flush();

      const final = observer.getCurrentResult();
      expect(final.isFetching).toBe(false);
      expect(final.data).toEqual({ contenusGardes: 9, contenusPartants: 3 });
    } finally {
      unsubscribe();
    }
  });
});
