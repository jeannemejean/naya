// Un post publié ou en cours de publication ne peut plus être refusé.
export function postRefusable(p: {
  publishedAt?: unknown;
  postStatus?: string | null;
  contentStatus?: string | null;
}): boolean {
  if (p.publishedAt) return false;
  if (p.contentStatus === "published") return false;
  if (p.postStatus && ["posted", "uploading", "processing", "posting"].includes(p.postStatus)) return false;
  return true;
}
