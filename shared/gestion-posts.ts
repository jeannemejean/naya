// shared/gestion-posts.ts — gestion des posts (lot 2 Metricool) : historique, duplication vers
// une autre marque, corbeille et actions groupées du calendrier. Règles pures, sans base.

/** Événements de l'historique d'un post (journal en ajout seul). */
export const EVENEMENTS_POST = [
  "cree", "texte_modifie", "date_modifiee", "programme", "deprogramme", "valide", "devalide",
  "publie", "echec", "duplique", "supprime", "restaure", "note_ajoutee",
  "validation_demandee", "validation_relancee", "validation_validee", "validation_refusee", "validation_commentaire",
  "validation_retiree", "compte_change",
] as const;
export type EvenementPost = typeof EVENEMENTS_POST[number];
export type Evenement = { evenement: EvenementPost; details?: Record<string, unknown> | null };

export const TEXTE_NOTE_MAX = 2000;
export const IDS_GROUPES_MAX = 100;
export const CORBEILLE_JOURS = 30;
/** Un décalage groupé reste raisonnable : un an au plus dans un sens ou dans l'autre. */
const JOURS_MAX = 366;

const STATUTS_EN_COURS = ["posting", "processing", "uploading"];

const norme = (v: unknown) => String(v ?? "").trim().toLowerCase();
const instant = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const t = new Date(v as any).getTime();
  return Number.isNaN(t) ? null : t;
};
const iso = (v: unknown): string | null => {
  const t = instant(v);
  return t == null ? null : new Date(t).toISOString();
};

/** Publié, ou en train de partir : ni déplacé, ni mis à la corbeille. */
export function postVerrouille(p: { publishedAt?: unknown; postStatus?: string | null; contentStatus?: string | null }): boolean {
  return !!p.publishedAt || norme(p.postStatus) === "posted" || STATUTS_EN_COURS.includes(norme(p.postStatus))
    || norme(p.contentStatus) === "published";
}

function raisonVerrou(p: { publishedAt?: unknown; postStatus?: string | null; contentStatus?: string | null }): "deja_publie" | "en_cours" | null {
  if (STATUTS_EN_COURS.includes(norme(p.postStatus))) return "en_cours";
  return postVerrouille(p) ? "deja_publie" : null;
}

/**
 * Ce qu'un changement d'un post (état avant → état après, ou patch partiel) écrit dans
 * l'historique. Seuls les champs PRÉSENTS dans `apres` sont comparés.
 */
export function evenementsDuChangement(avant: Record<string, any>, apres: Record<string, any>): Evenement[] {
  const ev: Evenement[] = [];
  const a = apres ?? {};
  const change = (k: string) => k in a && (a[k] ?? null) !== (avant[k] ?? null);
  if (change("body") || change("title")) ev.push({ evenement: "texte_modifie" });
  if ("scheduledFor" in a && instant(a.scheduledFor) !== instant(avant.scheduledFor)) {
    ev.push({ evenement: "date_modifiee", details: { avant: iso(avant.scheduledFor), apres: iso(a.scheduledFor) } });
  }
  if ("autoPost" in a && !!a.autoPost !== !!avant.autoPost) ev.push({ evenement: a.autoPost ? "programme" : "deprogramme" });
  if ("publishedAt" in a && !avant.publishedAt && a.publishedAt) ev.push({ evenement: "publie" });
  return ev;
}

/**
 * La ligne à créer pour dupliquer un post vers une marque (ou sans marque) : texte, médias,
 * format et options de publication. Jamais la publication elle-même : un brouillon, sans
 * programmation, sans compte (celui de la nouvelle marque sera choisi à la programmation),
 * sans campagne ni tâche d'origine.
 */
export function copiePourDuplication(
  post: Record<string, any>,
  cible: { projectId: number | null; scheduledFor?: Date | null },
): Record<string, any> {
  const statut = norme(post.contentStatus) === "idea" ? "idea" : "draft";
  return {
    userId: post.userId,
    projectId: cible.projectId,
    title: post.title,
    body: post.body,
    platform: post.platform,
    contentType: post.contentType,
    pillar: post.pillar,
    goal: post.goal,
    intent: post.intent ?? null,
    consigne: post.consigne ?? null,
    angle: post.angle ?? null,
    formatCreatif: post.formatCreatif ?? null,
    mediaIds: Array.isArray(post.mediaIds) ? [...post.mediaIds] : [],
    mediaUrl: post.mediaUrl ?? null,
    mediaFileName: post.mediaFileName ?? null,
    videoMeta: post.videoMeta ?? null,
    postFormat: post.postFormat ?? "feed_image",
    premierCommentaire: post.premierCommentaire ?? null,
    couvertureUrl: post.couvertureUrl ?? null,
    couvertureOffsetMs: post.couvertureOffsetMs ?? null,
    texteAlternatif: post.texteAlternatif ?? null,
    collaborateurs: Array.isArray(post.collaborateurs) ? [...post.collaborateurs] : null,
    reelDansLeFil: post.reelDansLeFil ?? null,
    nomAudio: post.nomAudio ?? null,
    linkedinDocument: post.linkedinDocument ?? null,
    // « À finir sur le téléphone » (lot 10) suit le post : la copie ne partira pas seule non plus.
    finirSurTelephone: post.finirSurTelephone === true,
    scheduledFor: cible.scheduledFor !== undefined ? cible.scheduledFor : (post.scheduledFor ?? null),
    status: "draft",
    contentStatus: statut,
    autoPost: false,
    postStatus: "pending",
    publishedAt: null,
    platformPostId: null,
    providerContainerId: null,
    lastError: null,
    socialAccountId: null,
    campaignId: null,
    crossPostGroupId: null,
    sourceTaskId: null,
  };
}

export type ActionGroupee =
  | { action: "deplacer"; jours: number }
  | { action: "deplacer"; date: string }
  | { action: "dupliquer"; projectIds: number[] }
  | { action: "supprimer" };

const JOUR = /^\d{4}-\d{2}-\d{2}$/;
const entierPositif = (v: unknown) => Number.isInteger(v) && (v as number) > 0;

/** Le corps d'une action groupée, validé ; null s'il est illisible. Ids dédoublonnés. */
export function lireActionGroupee(body: unknown): ({ ids: number[] } & ActionGroupee) | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.ids) || b.ids.length === 0 || !b.ids.every(entierPositif)) return null;
  const ids = Array.from(new Set(b.ids as number[]));
  if (ids.length > IDS_GROUPES_MAX) return null;
  if (b.action === "supprimer") return { ids, action: "supprimer" };
  if (b.action === "dupliquer") {
    if (!Array.isArray(b.projectIds) || b.projectIds.length === 0 || !b.projectIds.every(entierPositif)) return null;
    const projectIds = Array.from(new Set(b.projectIds as number[]));
    return projectIds.length > 20 ? null : { ids, action: "dupliquer", projectIds };
  }
  if (b.action === "deplacer") {
    if (b.jours !== undefined) {
      const j = b.jours;
      if (!Number.isInteger(j) || j === 0 || Math.abs(j as number) > JOURS_MAX) return null;
      return { ids, action: "deplacer", jours: j as number };
    }
    if (typeof b.date === "string" && JOUR.test(b.date) && !Number.isNaN(Date.parse(`${b.date}T00:00:00Z`))) {
      return { ids, action: "deplacer", date: b.date };
    }
  }
  return null;
}

// ── Heure de Paris ───────────────────────────────────────────────────────────────────────
const FMT_PARIS = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});
function partiesParis(d: Date) {
  const p = Object.fromEntries(FMT_PARIS.formatToParts(d).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, j: +p.day, h: +p.hour, min: +p.minute, s: +p.second };
}
/** L'instant qui s'affiche y-m-j h:min:s à Paris. */
function instantParis(y: number, m: number, j: number, h: number, min: number, s = 0, ms = 0): Date {
  const voulu = Date.UTC(y, m - 1, j, h, min, s, ms);
  let t = voulu;
  for (let i = 0; i < 2; i++) {
    const p = partiesParis(new Date(t));
    const affiche = Date.UTC(p.y, p.m - 1, p.j, p.h, p.min, p.s, ms);
    t += voulu - affiche;
  }
  return new Date(t);
}

/**
 * La nouvelle date d'un post déplacé : décalé de n jours (même heure à Paris), ou posé un
 * jour donné (même heure ; 9 h à Paris s'il n'avait pas de date). null : rien à décaler.
 */
export function nouvelleDate(ancienne: Date | string | null | undefined, d: { jours: number } | { date: string }): Date | null {
  const t = instant(ancienne);
  if ("jours" in d) {
    if (t == null) return null;
    const p = partiesParis(new Date(t));
    const jour = new Date(Date.UTC(p.y, p.m - 1, p.j + d.jours));
    return instantParis(jour.getUTCFullYear(), jour.getUTCMonth() + 1, jour.getUTCDate(), p.h, p.min, p.s, new Date(t).getUTCMilliseconds());
  }
  const [y, m, j] = d.date.split("-").map(Number);
  if (t == null) return instantParis(y, m, j, 9, 0);
  const p = partiesParis(new Date(t));
  return instantParis(y, m, j, p.h, p.min, p.s, new Date(t).getUTCMilliseconds());
}

export type RaisonIgnore = "deja_publie" | "en_cours" | "sans_date" | "date_passee";

/**
 * Les posts qu'une action groupée touche vraiment, et ceux qu'elle laisse (avec la raison).
 * Déplacer ou supprimer : jamais un post publié ou en train de partir. Déplacer un post
 * programmé dans le passé : refusé (il partirait en échec).
 */
export function trierPourAction<P extends Record<string, any>>(
  posts: P[],
  a: ActionGroupee,
  maintenant: Date,
): { retenus: Array<{ post: P; scheduledFor?: Date }>; ignores: Array<{ id: number; raison: RaisonIgnore }> } {
  const retenus: Array<{ post: P; scheduledFor?: Date }> = [];
  const ignores: Array<{ id: number; raison: RaisonIgnore }> = [];
  for (const post of posts) {
    if (a.action === "dupliquer") { retenus.push({ post }); continue; }
    const verrou = raisonVerrou(post);
    if (verrou) { ignores.push({ id: post.id, raison: verrou }); continue; }
    if (a.action === "supprimer") { retenus.push({ post }); continue; }
    const d = nouvelleDate(post.scheduledFor, "jours" in a ? { jours: a.jours } : { date: a.date });
    if (!d) { ignores.push({ id: post.id, raison: "sans_date" }); continue; }
    if (post.autoPost === true && d.getTime() < maintenant.getTime()) { ignores.push({ id: post.id, raison: "date_passee" }); continue; }
    retenus.push({ post, scheduledFor: d });
  }
  return { retenus, ignores };
}

/** Le texte d'une note, rogné ; null s'il est vide, pas une chaîne, ou trop long. */
export function lireTexteNote(body: unknown): string | null {
  const t = (body as any)?.texte;
  if (typeof t !== "string") return null;
  const s = t.trim();
  return s && s.length <= TEXTE_NOTE_MAX ? s : null;
}

/** Les posts mis à la corbeille avant cette date n'y sont plus montrés. */
export function dateCorbeilleLimite(maintenant: Date): Date {
  return new Date(maintenant.getTime() - CORBEILLE_JOURS * 24 * 3_600_000);
}
