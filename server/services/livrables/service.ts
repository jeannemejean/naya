// server/services/livrables/service.ts
// Créer, modifier, supprimer un livrable et le ranger là où il sert.
// Spec : docs/superpowers/specs/2026-10-06-naya-livrables-design.md
//
// Dépendances injectées : toute la logique est testable sans base ni R2. L'implémentation
// réelle est dans ./deps.ts.

import type { InsertLivrable, InsertMediaLibrary, Livrable } from "@shared/schema";
import { planDeRangement, titreMemoire, type LivrableKind } from "@shared/livrables";

export interface LivrablesDeps {
  inserer(row: InsertLivrable): Promise<Livrable>;
  maj(id: number, userId: string, patch: Partial<InsertLivrable>): Promise<Livrable | null>;
  lire(id: number, userId: string): Promise<Livrable | undefined>;
  supprimer(id: number, userId: string): Promise<boolean>;
  creerMedia(row: InsertMediaLibrary): Promise<{ id: number }>;
  majMediaAlt(mediaId: number, userId: string, alt: string | null): Promise<void>;
  supprimerMedia(mediaId: number, userId: string): Promise<void>;
  mediaReferenceParUnContenu(userId: string, mediaId: number, url: string | null): Promise<boolean>;
  deposerMemoire(input: { userId: string; projectId: number | null; titre: string; contenu: string }): Promise<{ morceaux: number; ids: number[] }>;
  perimerMemoire(userId: string, ids: number[]): Promise<void>;
  supprimerObjetPublic(url: string): Promise<void>;
  supprimerObjetPrive(key: string): Promise<void>;
}

export interface NouveauLivrable {
  userId: string;
  taskId: number | null;
  taskTitle: string | null;
  projectId: number | null;
  kind: LivrableKind;
  content?: string | null;
  url?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  size?: number | null;
}

/** Dépose en mémoire ; rend les ids et si un rattrapage est nécessaire. Ne lève jamais. */
async function deposer(
  deps: LivrablesDeps,
  args: { userId: string; projectId: number | null; taskTitle: string | null; texte: string | null },
): Promise<{ ids: number[]; pending: boolean }> {
  if (!args.texte) return { ids: [], pending: false };
  try {
    const r = await deps.deposerMemoire({
      userId: args.userId,
      projectId: args.projectId,
      titre: titreMemoire(args.taskTitle),
      contenu: args.texte,
    });
    return { ids: r.ids, pending: r.ids.length === 0 };
  } catch (e: any) {
    console.error("[Livrables] dépôt mémoire en échec — à rattraper:", e?.message ?? e);
    return { ids: [], pending: true };
  }
}

export async function creerLivrable(deps: LivrablesDeps, input: NouveauLivrable): Promise<Livrable> {
  const content = input.content?.trim() || null;
  const plan = planDeRangement({ kind: input.kind, content });

  let mediaId: number | null = null;
  if (plan.mediatheque && input.url) {
    const media = await deps.creerMedia({
      userId: input.userId,
      filename: input.fileName ?? "media",
      originalName: input.fileName ?? "media",
      mimeType: input.mimeType ?? "application/octet-stream",
      size: input.size ?? 0,
      url: input.url,
      alt: content,
      folder: "livrables",
      projectId: input.projectId,
    } as InsertMediaLibrary);
    mediaId = media.id;
  }

  const memoire = await deposer(deps, {
    userId: input.userId, projectId: input.projectId, taskTitle: input.taskTitle, texte: plan.memoire,
  });

  return deps.inserer({
    userId: input.userId,
    taskId: input.taskId,
    taskTitle: input.taskTitle,
    projectId: input.projectId,
    kind: input.kind,
    content,
    url: input.url ?? null,
    mediaId,
    fileName: input.fileName ?? null,
    mimeType: input.mimeType ?? null,
    size: input.size ?? null,
    memoryEntryIds: memoire.ids,
    memoirePending: memoire.pending,
  });
}

export async function modifierLivrable(
  deps: LivrablesDeps,
  id: number,
  userId: string,
  contentBrut: string | null,
): Promise<Livrable | null> {
  const actuel = await deps.lire(id, userId);
  if (!actuel) return null;

  const content = contentBrut?.trim() || null;
  if (content === (actuel.content ?? null)) return actuel;

  await deps.perimerMemoire(userId, (actuel.memoryEntryIds as number[] | null) ?? []);
  if (actuel.mediaId) await deps.majMediaAlt(actuel.mediaId, userId, content);

  const plan = planDeRangement({ kind: actuel.kind as LivrableKind, content });
  const memoire = await deposer(deps, {
    userId, projectId: actuel.projectId, taskTitle: actuel.taskTitle, texte: plan.memoire,
  });

  return deps.maj(id, userId, {
    content,
    memoryEntryIds: memoire.ids,
    memoirePending: memoire.pending,
  });
}

export async function supprimerLivrable(deps: LivrablesDeps, id: number, userId: string): Promise<boolean> {
  const actuel = await deps.lire(id, userId);
  if (!actuel) return false;

  await deps.perimerMemoire(userId, (actuel.memoryEntryIds as number[] | null) ?? []);

  if (actuel.kind === "media" && actuel.mediaId) {
    const utilise = await deps.mediaReferenceParUnContenu(userId, actuel.mediaId, actuel.url);
    if (!utilise) {
      await deps.supprimerMedia(actuel.mediaId, userId);
      if (actuel.url) await deps.supprimerObjetPublic(actuel.url).catch(() => {});
    }
  }
  if (actuel.kind === "fichier" && actuel.url) {
    await deps.supprimerObjetPrive(actuel.url).catch(() => {});
  }

  return deps.supprimer(id, userId);
}

/** Redépose en mémoire les livrables en attente. Best-effort : ne lève jamais. */
export async function rattraperMemoire(deps: LivrablesDeps, liste: Livrable[]): Promise<void> {
  for (const l of liste) {
    if (!l.memoirePending) continue;
    const plan = planDeRangement({ kind: l.kind as LivrableKind, content: l.content });
    const memoire = await deposer(deps, {
      userId: l.userId, projectId: l.projectId, taskTitle: l.taskTitle, texte: plan.memoire,
    });
    if (memoire.pending) continue;
    try {
      await deps.maj(l.id, l.userId, { memoryEntryIds: memoire.ids, memoirePending: false });
    } catch (e: any) {
      console.error("[Livrables] rattrapage non enregistré:", e?.message ?? e);
    }
  }
}
