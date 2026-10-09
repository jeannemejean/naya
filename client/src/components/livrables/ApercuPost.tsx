// Aperçu du post auquel une tâche de production est rattachée, en tête de « Ce que tu as
// produit » : on voit ce qui sera publié, et ce que le dépôt de cette étape y changera.
import { useTranslation } from "react-i18next";
import type { PostDeTache } from "@/lib/livrables-api";

function consigne(post: PostDeTache): string {
  if (!post.modifiable) return "livrables.postLocked";
  const { texte, media } = post.effet;
  if (texte && media) return "livrables.postHintBoth";
  if (texte) return "livrables.postHintTexte";
  if (media) return "livrables.postHintMedia";
  return "livrables.postHintNone";
}

export function ApercuPost({ post }: { post: PostDeTache }) {
  const { t, i18n } = useTranslation();
  const quand = post.scheduledFor
    ? new Date(post.scheduledFor).toLocaleString(i18n.language, {
        weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris",
      })
    : null;

  return (
    <div className="rounded-lg border border-naya-olive-18 bg-naya-olive-06 p-3 space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[10px] uppercase tracking-wider text-naya-olive-35">{t("livrables.postTitle")}</p>
        {quand && <p className="text-[11px] text-naya-olive-55">{t("livrables.postWhen", { date: quand })}</p>}
      </div>
      <p className="text-xs font-medium text-foreground">{post.title}</p>
      {post.body?.trim() ? (
        <p className="text-xs text-naya-olive-70 whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto">{post.body}</p>
      ) : (
        <p className="text-xs text-naya-olive-35 italic">{t("livrables.postEmpty")}</p>
      )}
      {post.medias.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {post.medias.map((m) =>
            m.mimeType.startsWith("video/") ? (
              <video key={`${m.id}-${m.url}`} src={m.url} className="h-16 w-16 rounded object-cover" muted />
            ) : (
              <img key={`${m.id}-${m.url}`} src={m.url} alt="" className="h-16 w-16 rounded object-cover" />
            ),
          )}
        </div>
      )}
      <p className="text-[11px] text-naya-olive-55">{t(consigne(post))}</p>
    </div>
  );
}
