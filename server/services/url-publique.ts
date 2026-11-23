// L'adresse publique de Naya (https://www.hellonaya.app en production) : redirections OAuth,
// liens courts (/l/<code>) et SmartLinks (/b/<slug>). Une seule règle pour tous.
export function urlDeBase(env: Record<string, string | undefined> = process.env): string {
  const brut = env.OAUTH_BASE_URL?.trim() || env.APP_URL ||
    (env.NODE_ENV === "production"
      ? "https://naya-production-64ac.up.railway.app"
      : "http://localhost:3000");
  return brut.replace(/\/+$/, "");
}
