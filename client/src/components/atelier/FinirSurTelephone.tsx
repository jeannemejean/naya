// Dans la fiche d'une tâche « Publier — … » : tout pour finir le post sur le téléphone (lot 10,
// mode notification de Metricool). La légende du réseau, le premier commentaire et les hashtags
// à copier ; les médias, dans l'ordre, à télécharger un par un ou tous d'un coup.
import { useTranslation } from "react-i18next";
import { Copy, Download, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { lireContenuTelephone, type MediaATelecharger } from "@shared/finir-telephone";

const NOMS_RESEAUX: Record<string, string> = { instagram: "Instagram", linkedin: "LinkedIn", facebook: "Facebook", tiktok: "TikTok" };

/** Télécharge un fichier sous son nom ; si l'adresse refuse la lecture (autre origine), l'ouvre. */
async function telecharger(m: MediaATelecharger): Promise<void> {
  try {
    const res = await fetch(m.url, { credentials: "include" });
    if (!res.ok) throw new Error(String(res.status));
    const lien = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = lien;
    a.download = m.nom;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(lien), 10_000);
  } catch {
    window.open(m.url, "_blank", "noopener");
  }
}

export function FinirSurTelephone({ actionData }: { actionData: unknown }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const c = lireContenuTelephone(actionData);
  if (!c) return null;

  const copier = async (texte: string) => {
    try { await navigator.clipboard.writeText(texte); toast({ title: t("telephone.copie") }); }
    catch { toast({ title: t("telephone.copieImpossible"), variant: "destructive" }); }
  };
  const toutTelecharger = async () => {
    // L'un après l'autre : un navigateur bloque une rafale de téléchargements simultanés.
    for (const m of c.medias) { await telecharger(m); await new Promise((r) => setTimeout(r, 400)); }
  };

  return (
    <section className="px-5 pt-3 space-y-3" data-testid="finir-sur-telephone">
      <div className="space-y-1">
        <p className="inline-flex items-center gap-1.5 text-sm font-medium text-naya-olive-70">
          <Smartphone className="h-4 w-4" />{t("telephone.titre")}
        </p>
        {c.raisons.map((r) => <p key={r} className="text-[11px] text-naya-olive-55">{t(`telephone.raisons.${r}`)}</p>)}
      </div>

      <div className="space-y-1">
        <p className="text-[10px] text-naya-olive-35">{t("telephone.legende", { reseau: NOMS_RESEAUX[c.reseau] ?? c.reseau })}</p>
        <p className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg border border-naya-olive-18 bg-naya-olive-06 px-3 py-2 text-xs leading-relaxed text-naya-olive-70">{c.legende}</p>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { void copier(c.legende); }} data-testid="copier-legende">
            <Copy className="h-3.5 w-3.5 mr-1" />{t("telephone.copierLegende")}
          </Button>
          {c.hashtags.length > 0 && (
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { void copier(c.hashtags.join(" ")); }}>
              <Copy className="h-3.5 w-3.5 mr-1" />{t("telephone.copierHashtags")}
            </Button>
          )}
        </div>
      </div>

      {c.hashtags.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] text-naya-olive-35">{t("telephone.hashtags")}</p>
          <p className="text-xs text-naya-olive-70 break-words">{c.hashtags.join(" ")}</p>
        </div>
      )}

      {c.premierCommentaire && (
        <div className="space-y-1">
          <p className="text-[10px] text-naya-olive-35">{t("telephone.premierCommentaire")}</p>
          <p className="whitespace-pre-wrap rounded-lg border border-naya-olive-18 px-3 py-2 text-xs text-naya-olive-70">{c.premierCommentaire}</p>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { void copier(c.premierCommentaire!); }}>
            <Copy className="h-3.5 w-3.5 mr-1" />{t("telephone.copierCommentaire")}
          </Button>
        </div>
      )}

      <div className="space-y-1">
        <p className="text-[10px] text-naya-olive-35">{t("telephone.medias")}</p>
        {c.medias.length === 0 ? <p className="text-xs text-naya-olive-55">{t("telephone.aucunMedia")}</p> : (
          <>
            <ol className="space-y-1">
              {c.medias.map((m) => (
                <li key={m.ordre} className="flex items-center gap-2 text-xs text-naya-olive-70">
                  <span className="min-w-0 flex-1 truncate">{t("telephone.media", { ordre: m.ordre, nom: m.nom })}</span>
                  <a href={m.url} download={m.nom} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-naya-olive-55 hover:text-naya-olive-70"
                    onClick={(e) => { e.preventDefault(); void telecharger(m); }}>
                    <Download className="h-3 w-3" />{t("telephone.telecharger")}
                  </a>
                </li>
              ))}
            </ol>
            <Button size="sm" className="h-7 text-xs" onClick={() => { void toutTelecharger(); }} data-testid="telecharger-medias">
              <Download className="h-3.5 w-3.5 mr-1" />{t("telephone.telechargerMedias")}
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
