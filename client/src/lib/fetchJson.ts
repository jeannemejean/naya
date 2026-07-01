import { throwIfResNotOk } from "./queryClient";

// fetch + vérification du statut + parse JSON, pour les queryFn custom.
// Sans ça, un `fetch(url).then(r => r.json())` renvoie le CORPS D'ERREUR ({message:…}) comme
// donnée sur une réponse non-2xx → la query croit avoir des données valides → crash de rendu
// (TypeError sur un accès imbriqué, ou .map sur un objet). Ici, un 4xx/5xx devient une vraie
// erreur (message « status: … ») : le 401 est exclu de l'ErrorBoundary (is401) et géré par le
// flux d'auth ; les autres remontent proprement à l'ErrorBoundary.
export async function fetchJson<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", ...init });
  await throwIfResNotOk(res);
  return res.json() as Promise<T>;
}

// Lit le corps JSON d'une réponse en TOLÉRANT un corps vide → null (au lieu de JSON.parse('')
// qui throw « Unexpected end of JSON input »). Utile quand un endpoint peut répondre 200 sans
// contenu (ex. res.json(undefined)). À utiliser sur une Response déjà vérifiée (apiRequest).
export async function readJsonSafe<T = unknown>(res: Response): Promise<T | null> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
