// Ligne d'appel vers la lecture du jour : déplacé tel quel de l'ancien dashboard vers le Planning.
import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "@/lib/fetchJson";
import { libelleAppelRevue } from "@/lib/appel-revue";
import { Link } from "wouter";

// Le déclencheur du matin. Rien ne s'affiche les jours vides : un déclencheur qui parle
// quand il n'a rien à dire devient du bruit, et un « 0 » serait un compteur de retard.
export default function AppelRevue() {
  // Best-effort, comme le reste de la revue de lecture (voir le même commentaire dans
  // client/src/components/reading/revue-du-matin.tsx) : son absence est un état normal
  // du produit, jamais une panne. Sans `throwOnError: false`, un échec sur CETTE requête
  // (règle globale de client/src/lib/queryClient.ts) ferait basculer tout le dashboard —
  // et tout le reste de l'app, un seul ErrorBoundary couvrant le routeur entier — sur
  // l'écran d'erreur plein écran, pour un simple déclencheur secondaire. `data` reste
  // `undefined` sur erreur, donc `n` retombe à 0 et le composant ne rend déjà rien.
  const { data } = useQuery<{ duJour: Array<{ id: number; status: string }>; gardees: Array<{ id: number }> }>({
    queryKey: ['/api/reading/today'],
    queryFn: () => fetchJson('/api/reading/today'),
    throwOnError: false,
  });
  // Ne compte que les fiches du jour NON TRAITÉES : une fiche gardée n'est pas un
  // retard (la compter ici ferait de cette ligne un compteur de dette qui ne redescend
  // jamais), et une fiche déjà répondue n'est plus à lire. La règle est isolée et
  // testée dans client/src/lib/appel-revue.ts.
  const libelle = libelleAppelRevue(data);
  if (!libelle) return null;

  return (
    <Link href="/reading-hub">
      <button
        className="w-full text-left text-sm text-muted-foreground hover:text-foreground transition-colors py-2"
        data-testid="appel-revue"
      >
        {libelle}
      </button>
    </Link>
  );
}
