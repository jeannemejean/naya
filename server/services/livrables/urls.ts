// server/services/livrables/urls.ts — formes exactes des URL/clés d'objets produites par r2-storage.
// Pur et sans effet de bord à l'import (testable sans variables R2). Sert à ne jamais accepter ni
// supprimer l'objet d'un autre compte.

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const EXT = "(?:\\.[a-z0-9]{1,8})?";

function echapper(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&");
}

function baseEnv(): string {
  return (process.env.R2_PUBLIC_BASE_URL || "").replace(/\/+$/, "");
}

/** Vrai seulement pour `${base}/uploads/${userId}/(images|videos)/<uuid v4>(.ext)?`, exactement. */
export function estUrlMediaDe(userId: string, url: string, base: string = baseEnv()): boolean {
  if (!base || !userId || typeof url !== "string") return false;
  const re = new RegExp(`^${echapper(base)}/uploads/${echapper(userId)}/(?:images|videos)/${UUID}${EXT}$`);
  return re.test(url);
}

/** Vrai seulement pour `livrables/${userId}/<uuid v4>(.ext)?`, exactement. */
export function estCleFichierDe(userId: string, key: string): boolean {
  if (!userId || typeof key !== "string") return false;
  return new RegExp(`^livrables/${echapper(userId)}/${UUID}${EXT}$`).test(key);
}
