import { QueryClient, QueryFunction } from "@tanstack/react-query";

export async function throwIfResNotOk(res: Response) {
 if (!res.ok) {
 const text = (await res.text()) || res.statusText;
 throw new Error(`${res.status}: ${text}`);
 }
}

// Vrai si l'erreur est un 401 (message « 401: … »). Exporté pour que les queryFn custom
// ET le mécanisme global d'exclusion (throwOnError) utilisent la MÊME détection.
export function is401(error: unknown): boolean {
 const msg = error instanceof Error ? error.message : String(error ?? "");
 return /^401\b/.test(msg);
}

export async function apiRequest(
 method: string,
 url: string,
 data?: unknown | undefined,
): Promise<Response> {
 const res = await fetch(url, {
 method,
 headers: data ? { "Content-Type": "application/json" } : {},
 body: data ? JSON.stringify(data) : undefined,
 credentials: "include",
 });

 await throwIfResNotOk(res);
 return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
 on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
 ({ on401: unauthorizedBehavior }) =>
 async ({ queryKey }) => {
 const res = await fetch(queryKey[0] as string, {
 credentials: "include",
 });

 if (unauthorizedBehavior === "returnNull" && res.status === 401) {
 return null;
 }

 await throwIfResNotOk(res);
 return await res.json();
 };

export const queryClient = new QueryClient({
 defaultOptions: {
 queries: {
 queryFn: getQueryFn({ on401: "throw" }),
 refetchInterval: false,
 refetchOnWindowFocus: false,
 staleTime: Infinity,
 retry: 1, // un retry pour absorber les aléas transitoires avant d'afficher une erreur
 // Les erreurs persistantes non-401 remontent à l'ErrorBoundary (écran « Naya cherche
 // la meilleure réponse… ») au lieu de laisser une UI cassée/blanche. Le 401 reste géré
 // par le flux d'auth (pas d'écran d'erreur quand on est simplement déconnecté).
 throwOnError: (error: unknown) => !is401(error),
 },
 mutations: {
 retry: false,
 },
 },
});
