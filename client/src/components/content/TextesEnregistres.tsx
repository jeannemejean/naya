// Textes enregistrés (bibliothèque, lot 3) : sous une zone de texte (légende, premier
// commentaire), « Insérer un texte enregistré » le pose au curseur (ou remplace la sélection,
// ou l'ajoute à la fin), et « Enregistrer ce texte » range la sélection (ou tout le texte).
// À côté, « Raccourcir le lien » (lot 5) remplace un lien du texte par un lien court avec UTM.
import { useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookmarkPlus, Library, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import RaccourcirLien from "@/components/liens/RaccourcirLien";
import { filtrerParNom, insererAuCurseur, TEXTE_ENREGISTRE_MAX, TITRE_TEXTE_MAX } from "@shared/bibliotheque";

export interface TexteEnregistreClient { id: number; titre: string; texte: string; projectId: number | null; updatedAt?: string }

export const CLE_TEXTES = ["/api/bibliotheque/textes"];

export function useTextesEnregistres() {
  return useQuery<TexteEnregistreClient[]>({
    queryKey: CLE_TEXTES,
    queryFn: async () => (await apiRequest("GET", "/api/bibliotheque/textes")).json(),
  });
}

/** Les textes utiles ici : ceux de toutes les marques, et ceux de la marque courante. */
export function textesPourMarque(textes: TexteEnregistreClient[], projectId: number | null | undefined) {
  if (projectId == null) return textes;
  return textes.filter((x) => x.projectId == null || x.projectId === projectId);
}

export default function TextesEnregistres({
  zone, valeur, onChange, projectId, disabled, testId, reseau,
}: {
  zone: RefObject<HTMLTextAreaElement>;
  valeur: string;
  onChange: (v: string) => void;
  projectId?: number | null;
  disabled?: boolean;
  testId?: string;
  /** Réseau du post : utm_source proposé par « Raccourcir le lien » (lot 5). */
  reseau?: string | null;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [ouvertInserer, setOuvertInserer] = useState(false);
  const [ouvertEnregistrer, setOuvertEnregistrer] = useState(false);
  const [q, setQ] = useState("");
  const [titre, setTitre] = useState("");
  const { data: textes = [], isLoading } = useTextesEnregistres();

  const visibles = filtrerParNom(textesPourMarque(textes, projectId), q, (x) => `${x.titre} ${x.texte}`);

  const inserer = (ajout: string) => {
    const el = zone.current;
    const { valeur: v, curseur } = insererAuCurseur(valeur, ajout, el?.selectionStart, el?.selectionEnd);
    onChange(v);
    setOuvertInserer(false);
    setQ("");
    // Le curseur revient juste après le texte inséré.
    requestAnimationFrame(() => {
      const z = zone.current;
      if (!z) return;
      z.focus();
      try { z.setSelectionRange(curseur, curseur); } catch { /* zone non sélectionnable */ }
    });
  };

  /** La sélection de la zone, sinon tout son texte. */
  const aEnregistrer = () => {
    const el = zone.current;
    const sel = el && el.selectionEnd > el.selectionStart ? valeur.slice(el.selectionStart, el.selectionEnd) : valeur;
    return sel.trim();
  };

  const enregistrer = useMutation({
    mutationFn: async (v: { titre: string; texte: string }) =>
      (await apiRequest("POST", "/api/bibliotheque/textes", { ...v, projectId: projectId ?? null })).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CLE_TEXTES });
      setTitre(""); setOuvertEnregistrer(false);
      toast({ title: t("bibliotheque.textes.enregistreToast") });
    },
    onError: () => toast({ title: t("bibliotheque.erreur"), variant: "destructive" }),
  });

  const texteCourant = ouvertEnregistrer ? aEnregistrer() : "";
  const trop = texteCourant.length > TEXTE_ENREGISTRE_MAX;

  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid={testId}>
      <Popover open={ouvertInserer} onOpenChange={setOuvertInserer}>
        <PopoverTrigger asChild>
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={disabled}>
            <Library className="h-3.5 w-3.5 mr-1" />{t("bibliotheque.textes.inserer")}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-2" align="start">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("bibliotheque.rechercher")} className="h-8 text-sm mb-2" />
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : visibles.length === 0 ? (
            <p className="text-xs text-naya-olive-35 p-2">{textes.length === 0 ? t("bibliotheque.textes.aucun") : t("bibliotheque.aucunResultat")}</p>
          ) : (
            <ul className="max-h-64 overflow-y-auto space-y-1">
              {visibles.map((x) => (
                <li key={x.id}>
                  <button type="button" onClick={() => inserer(x.texte)}
                    className="w-full text-left rounded p-2 hover:bg-naya-olive-06" data-testid={`inserer-texte-${x.id}`}>
                    <p className="text-sm text-foreground truncate">{x.titre}</p>
                    <p className="text-xs text-naya-olive-55 line-clamp-2 whitespace-pre-line">{x.texte}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </PopoverContent>
      </Popover>

      <Popover open={ouvertEnregistrer} onOpenChange={setOuvertEnregistrer}>
        <PopoverTrigger asChild>
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={!valeur.trim()}>
            <BookmarkPlus className="h-3.5 w-3.5 mr-1" />{t("bibliotheque.textes.enregistrer")}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-3 space-y-2" align="start">
          <p className="text-xs text-naya-olive-55">{t("bibliotheque.textes.enregistrerAide")}</p>
          <p className="text-xs text-foreground bg-naya-olive-06 rounded p-2 max-h-24 overflow-y-auto whitespace-pre-line">{texteCourant}</p>
          <Input value={titre} onChange={(e) => setTitre(e.target.value)} maxLength={TITRE_TEXTE_MAX}
            placeholder={t("bibliotheque.textes.titrePlaceholder")} className="h-8 text-sm" />
          {trop && <p className="text-xs text-destructive">{t("bibliotheque.textes.tropLong", { max: TEXTE_ENREGISTRE_MAX })}</p>}
          <Button type="button" size="sm" disabled={!titre.trim() || !texteCourant || trop || enregistrer.isPending}
            onClick={() => enregistrer.mutate({ titre: titre.trim(), texte: texteCourant })}>
            {enregistrer.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
            {t("bibliotheque.textes.enregistrerBouton")}
          </Button>
        </PopoverContent>
      </Popover>

      <RaccourcirLien valeur={valeur} onChange={onChange} projectId={projectId} reseau={reseau} disabled={disabled} />
    </div>
  );
}
