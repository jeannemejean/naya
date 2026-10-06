import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FileText, Link2 } from "lucide-react";
import { cleLivrablesProjet, type LivrableClient } from "@/lib/livrables-api";

export default function LivrablesPanel({ projectId }: { projectId: number }) {
  const { t } = useTranslation();
  const { data: livrables = [] } = useQuery<LivrableClient[]>({ queryKey: cleLivrablesProjet(projectId) });

  return (
    <div>
      <h2 className="text-sm font-semibold text-foreground mb-2">{t("livrables.projectTitle")}</h2>
      {livrables.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("livrables.projectEmpty")}</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {livrables.map((l) => (
            <li key={l.id} className="rounded-md border border-border bg-white p-3 flex gap-3">
              {l.kind === "media" && l.url && !l.mimeType?.startsWith("video/") && (
                <img src={l.url} alt={l.content ?? ""} className="h-14 w-14 rounded object-cover" />
              )}
              {l.kind === "fichier" && <FileText className="h-5 w-5 text-naya-olive-55" />}
              {l.kind === "lien" && <Link2 className="h-5 w-5 text-naya-olive-55" />}
              <div className="min-w-0 text-sm">
                {l.kind === "fichier" && (
                  <a href={`/api/livrables/${l.id}/fichier`} target="_blank" rel="noreferrer" className="underline break-all">
                    {l.fileName ?? t("livrables.open")}
                  </a>
                )}
                {l.kind === "lien" && l.url && (
                  <a href={l.url} target="_blank" rel="noreferrer" className="underline break-all">{l.url}</a>
                )}
                {l.content && <p className="line-clamp-3 whitespace-pre-wrap">{l.content}</p>}
                {l.taskTitle && (
                  <p className="text-xs text-muted-foreground mt-1">{t("livrables.fromTask", { title: l.taskTitle })}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
