import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FileText, Link2, Trash2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { LivrableClient } from "@/lib/livrables-api";

export function LivrableCarte({
  livrable, onModifier, onSupprimer, enCours,
}: {
  livrable: LivrableClient;
  onModifier: (content: string | null) => Promise<void>;
  onSupprimer: () => void;
  enCours: boolean;
}) {
  const { t } = useTranslation();
  const [edition, setEdition] = useState(false);
  const [texte, setTexte] = useState(livrable.content ?? "");

  return (
    <div className="rounded-md border border-naya-olive-10 bg-white p-3 space-y-2">
      <div className="flex items-start gap-3">
        {livrable.kind === "media" && livrable.url && (
          livrable.mimeType?.startsWith("video/")
            ? <video src={livrable.url} className="h-16 w-16 rounded object-cover" muted />
            : <img src={livrable.url} alt={livrable.content ?? ""} className="h-16 w-16 rounded object-cover" />
        )}
        {livrable.kind === "fichier" && <FileText className="h-5 w-5 text-naya-olive-55 mt-0.5" />}
        {livrable.kind === "lien" && <Link2 className="h-5 w-5 text-naya-olive-55 mt-0.5" />}
        <div className="flex-1 min-w-0 text-sm">
          {livrable.kind === "fichier" && (
            <a href={`/api/livrables/${livrable.id}/fichier`} target="_blank" rel="noreferrer" className="underline break-all">
              {livrable.fileName ?? t("livrables.open")}
            </a>
          )}
          {livrable.kind === "lien" && livrable.url && (
            <a href={livrable.url} target="_blank" rel="noreferrer" className="underline break-all">{livrable.url}</a>
          )}
          {!edition && livrable.content && <p className="whitespace-pre-wrap text-foreground">{livrable.content}</p>}
        </div>
        <div className="flex gap-1">
          <Button size="icon" variant="ghost" aria-label={t("livrables.edit")} onClick={() => setEdition(true)} disabled={enCours}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" aria-label={t("livrables.remove")} onClick={onSupprimer} disabled={enCours}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      {edition && (
        <div className="space-y-2">
          <Textarea value={texte} onChange={(e) => setTexte(e.target.value)} rows={3} />
          <Button size="sm" disabled={enCours} onClick={async () => {
 // On ne ferme qu'après succès : le texte tapé survit à un échec.
 try { await onModifier(texte.trim() || null); setEdition(false); } catch { /* le parent affiche l'erreur */ }
 }}>
            {t("livrables.save")}
          </Button>
        </div>
      )}
    </div>
  );
}
