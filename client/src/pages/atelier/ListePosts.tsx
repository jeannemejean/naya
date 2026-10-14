// Atelier de contenu — la liste des posts de la semaine (colonne de gauche).
import { useTranslation } from "react-i18next";
import { CheckCircle2, Circle, CircleDashed, Loader2, Send } from "lucide-react";
import type { PostAtelier } from "./api";

const PASTILLE: Record<PostAtelier["etat"], { icone: typeof Circle; classe: string }> = {
  a_rediger: { icone: CircleDashed, classe: "text-muted-foreground" },
  brouillon: { icone: Circle, classe: "text-naya-sulphur" },
  valide: { icone: CheckCircle2, classe: "text-naya-salvia" },
  publie: { icone: Send, classe: "text-naya-salvia" },
};

export default function ListePosts({ posts, actif, enRedaction, onChoisir }: {
  posts: PostAtelier[];
  actif: number | null;
  enRedaction: Set<number>;
  onChoisir: (id: number) => void;
}) {
  const { t, i18n } = useTranslation();
  const quand = (d: string) => new Date(d).toLocaleString(i18n.language, { weekday: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <nav aria-label={t("atelier.liste")} className="space-y-1.5">
      {posts.map((p) => {
        const { icone: Icone, classe } = PASTILLE[p.etat];
        const redige = enRedaction.has(p.id);
        const manque = (p.etat === "brouillon" || p.etat === "a_rediger") && p.manques.length > 0 && !redige;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onChoisir(p.id)}
            aria-current={p.id === actif ? "true" : undefined}
            className={`w-full text-left rounded-lg border px-3 py-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              p.id === actif ? "border-foreground bg-card shadow-sm" : "border-border bg-card/60 hover:bg-card"
            }`}
          >
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              {redige ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icone className={`w-3.5 h-3.5 ${classe}`} />}
              <span className="capitalize">{quand(p.scheduledFor)}</span>
              <span className="ml-auto capitalize">{p.platform}</span>
            </div>
            <p className="mt-1 text-sm font-medium text-foreground line-clamp-2">{p.title}</p>
            <div className="mt-1 flex items-center gap-2 text-[11px]">
              <span className="text-muted-foreground">{redige ? t("atelier.etat.redaction") : t(`atelier.etat.${p.etat}`)}</span>
              {manque && <span className="text-naya-mauve">{t("atelier.ilManque")}</span>}
              {p.projet && <span className="ml-auto truncate max-w-[45%] text-muted-foreground">{p.projet}</span>}
            </div>
          </button>
        );
      })}
    </nav>
  );
}
