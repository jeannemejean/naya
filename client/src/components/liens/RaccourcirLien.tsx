// « Raccourcir le lien » (lot 5) : sous une légende ou un premier commentaire, repère les liens
// du texte, crée un lien court hellonaya.app/l/<code> avec UTM (par défaut : source = réseau,
// medium = social, campaign = slug de la marque) et le met à la place de l'original.
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { CODE_RE, detecterUrls, remplacerUrl, slugifier, utmParDefaut, type Utm } from "@shared/liens";

interface Projet { id: number; name: string; slug?: string | null }

/** Déjà un lien court de Naya (…/l/<code>) : rien à raccourcir. */
function dejaCourt(url: string): boolean {
  try {
    const p = new URL(url).pathname;
    return p.startsWith("/l/") && CODE_RE.test(p.slice(3));
  } catch { return false; }
}

export default function RaccourcirLien({
  valeur, onChange, projectId, reseau, disabled,
}: {
  valeur: string;
  onChange: (v: string) => void;
  projectId?: number | null;
  reseau?: string | null;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [ouvert, setOuvert] = useState(false);
  const [choisie, setChoisie] = useState("");
  const [utm, setUtm] = useState<Utm>({});

  const { data: projets = [] } = useQuery<Projet[]>({ queryKey: ["/api/projects"], enabled: ouvert && projectId != null, throwOnError: false });
  const urls = useMemo(() => (ouvert ? detecterUrls(valeur).filter((u) => !dejaCourt(u)) : []), [ouvert, valeur]);

  const ouvrir = (o: boolean) => {
    setOuvert(o);
    if (!o) return;
    const liste = detecterUrls(valeur).filter((u) => !dejaCourt(u));
    setChoisie(liste[0] ?? "");
    const p = projets.find((x) => x.id === projectId);
    setUtm(utmParDefaut(reseau, p ? (p.slug || p.name) : null));
  };
  // Les projets arrivent après l'ouverture : la campagne par défaut suit, si elle est encore vide.
  const projet = projets.find((x) => x.id === projectId);
  useEffect(() => {
    if (!ouvert || !projet) return;
    const c = slugifier(projet.slug || projet.name);
    if (c) setUtm((u) => (u.campaign ? u : { ...u, campaign: c }));
  }, [ouvert, projet?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const creer = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/liens", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: choisie, utm, projectId: projectId ?? null }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(j?.message || String(res.status)), { max: j?.max });
      return j as { urlCourte: string };
    },
    onSuccess: (j) => {
      onChange(remplacerUrl(valeur, choisie, j.urlCourte));
      setOuvert(false);
      toast({ title: t("liens.cree") });
    },
    onError: (e: any) => toast({
      title: e?.message === "limite_liens" ? t("liens.limite", { max: e?.max ?? 200 }) : t("liens.erreur"),
      variant: "destructive",
    }),
  });

  const champ = (k: keyof Utm, libelle: string) => (
    <label className="block">
      <span className="text-[11px] text-naya-olive-55">{libelle}</span>
      <Input value={utm[k] ?? ""} maxLength={100} className="h-8 text-sm"
        onChange={(e) => setUtm((u) => ({ ...u, [k]: e.target.value }))} />
    </label>
  );

  return (
    <Popover open={ouvert} onOpenChange={ouvrir}>
      <PopoverTrigger asChild>
        <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={disabled || !valeur.includes("http")}
          data-testid="raccourcir-lien">
          <Link2 className="h-3.5 w-3.5 mr-1" />{t("liens.raccourcir")}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-3 space-y-2" align="start">
        <p className="text-xs text-naya-olive-55">{t("liens.aide")}</p>
        {urls.length === 0 ? (
          <p className="text-xs text-naya-olive-35">{t("liens.aucunLien")}</p>
        ) : (
          <>
            <label className="block">
              <span className="text-[11px] text-naya-olive-55">{t("liens.lienAChoisir")}</span>
              <select value={choisie} onChange={(e) => setChoisie(e.target.value)}
                className="w-full h-8 text-sm rounded-md border border-input bg-background px-2 truncate">
                {urls.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </label>
            {champ("source", t("liens.utmSource"))}
            {champ("medium", t("liens.utmMedium"))}
            {champ("campaign", t("liens.utmCampaign"))}
            {champ("content", t("liens.utmContent"))}
            <Button type="button" size="sm" disabled={!choisie || creer.isPending} onClick={() => creer.mutate()}>
              {creer.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
              {t("liens.creer")}
            </Button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
