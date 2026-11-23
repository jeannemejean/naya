// SmartLink d'une marque (lot 5, inspiré de Metricool « link in bio ») : la page publique
// hellonaya.app/b/<slug> — titre, bio, photo, boutons (ajouter, ordonner, retirer), et en option
// les dernières publications Instagram, chacune vers un lien. Aperçu, adresse à copier, clics.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Copy, ExternalLink, Link2, Loader2, Plus, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  BIO_MAX, LIBELLE_MAX, slugifier, THEME_DEFAUT, TITRE_SMARTLINK_MAX, type BoutonSmartlink, type ThemeSmartlink,
} from "@shared/liens";

interface SmartlinkServeur {
  id: number; slug: string; titre: string; bio: string; avatarUrl: string | null; theme: Partial<ThemeSmartlink>;
  actif: boolean; boutons: BoutonSmartlink[]; tuilesActives: boolean;
  liensTuiles: Record<string, { url: string }>; urlPublique: string;
}
interface Reponse { smartlink: SmartlinkServeur | null; base: string; publications: Array<{ id: number; imageUrl: string }> }
interface Stats {
  total: number; trenteJours: number;
  boutons: Array<{ id: string; libelle: string; total: number; trenteJours: number }>;
  tuiles: Array<{ contentId: number; total: number; trenteJours: number }>;
}
interface Media { id: number; url: string; mimeType: string; thumbnailUrl?: string | null }

interface Brouillon {
  slug: string; titre: string; bio: string; avatarUrl: string | null; theme: ThemeSmartlink; actif: boolean;
  boutons: Array<{ id: string; libelle: string; url: string; actif: boolean }>;
  tuilesActives: boolean; liensTuiles: Record<string, string>;
}

const idLocal = () => Math.random().toString(36).slice(2, 12);

function depuisServeur(s: SmartlinkServeur | null, nomProjet: string): Brouillon {
  if (!s) {
    return {
      slug: slugifier(nomProjet), titre: nomProjet, bio: "", avatarUrl: null, theme: { ...THEME_DEFAUT }, actif: true,
      boutons: [], tuilesActives: false, liensTuiles: {},
    };
  }
  return {
    slug: s.slug, titre: s.titre, bio: s.bio, avatarUrl: s.avatarUrl, actif: s.actif,
    theme: { ...THEME_DEFAUT, ...(s.theme ?? {}) },
    boutons: (s.boutons ?? []).map((b) => ({ id: b.id, libelle: b.libelle, url: b.url, actif: b.actif !== false })),
    tuilesActives: s.tuilesActives,
    liensTuiles: Object.fromEntries(Object.entries(s.liensTuiles ?? {}).map(([k, v]) => [k, v.url])),
  };
}

export default function SmartLinkCard({ projectId, nomProjet }: { projectId: number; nomProjet: string }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const cle = `/api/smartlinks?projectId=${projectId}`;
  const { data, isLoading } = useQuery<Reponse>({ queryKey: [cle], throwOnError: false });
  const s = data?.smartlink ?? null;
  const { data: stats } = useQuery<Stats>({ queryKey: [`/api/smartlinks/${s?.id}/stats`], enabled: !!s, throwOnError: false });
  const { data: medias = [] } = useQuery<Media[]>({ queryKey: ["/api/media-library"], throwOnError: false });
  const images = medias.filter((m) => String(m.mimeType).startsWith("image/") && /^https:\/\//.test(m.url));

  const [b, setB] = useState<Brouillon | null>(null);
  const [edition, setEdition] = useState(false);
  useEffect(() => { if (data) setB(depuisServeur(data.smartlink, nomProjet)); }, [data, nomProjet]);

  const enregistrer = useMutation({
    mutationFn: async (v: Brouillon) => {
      const res = await fetch(s ? `/api/smartlinks/${s.id}` : "/api/smartlinks", {
        method: s ? "PUT" : "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...v, projectId }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.message || "defaut");
      return j;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [cle] });
      if (s) qc.invalidateQueries({ queryKey: [`/api/smartlinks/${s.id}/stats`] });
      setEdition(false);
      toast({ title: t("smartlink.enregistre") });
    },
    onError: (e: any) => toast({
      title: t(`smartlink.erreurs.${e?.message}`, { defaultValue: t("smartlink.erreurs.defaut") }), variant: "destructive",
    }),
  });

  const supprimer = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/smartlinks/${s!.id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error(String(res.status));
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: [cle] }); setEdition(false); toast({ title: t("smartlink.supprimee") }); },
    onError: () => toast({ title: t("smartlink.erreurs.defaut"), variant: "destructive" }),
  });

  const maj = (p: Partial<Brouillon>) => setB((x) => (x ? { ...x, ...p } : x));
  const majBouton = (i: number, p: Partial<Brouillon["boutons"][number]>) =>
    setB((x) => (x ? { ...x, boutons: x.boutons.map((bt, j) => (j === i ? { ...bt, ...p } : bt)) } : x));
  const deplacer = (i: number, d: -1 | 1) => setB((x) => {
    if (!x) return x;
    const j = i + d;
    if (j < 0 || j >= x.boutons.length) return x;
    const l = [...x.boutons];
    [l[i], l[j]] = [l[j], l[i]];
    return { ...x, boutons: l };
  });

  const copier = async () => {
    if (!s) return;
    try { await navigator.clipboard.writeText(s.urlPublique); toast({ title: t("smartlink.copie") }); } catch { /* presse-papiers refusé */ }
  };

  const statBouton = (id: string) => stats?.boutons.find((x) => x.id === id);

  return (
    <Card className="p-5 space-y-4" data-testid="smartlink-card">
      <div>
        <h3 className="text-base font-semibold flex items-center gap-2"><Link2 className="w-4 h-4" />{t("smartlink.titre")}</h3>
        <p className="text-sm text-muted-foreground mt-1">{t("smartlink.intro", { projet: nomProjet })}</p>
      </div>

      {isLoading || !b ? <Loader2 className="w-4 h-4 animate-spin" /> : (
        <>
          {s && (
            <div className="flex flex-wrap items-center gap-2">
              <code className="text-xs bg-muted rounded px-2 py-1 break-all">{s.urlPublique}</code>
              <Button size="sm" variant="outline" onClick={copier}><Copy className="w-3.5 h-3.5 mr-1" />{t("smartlink.copier")}</Button>
              <Button size="sm" variant="outline" asChild>
                <a href={s.urlPublique} target="_blank" rel="noopener noreferrer"><ExternalLink className="w-3.5 h-3.5 mr-1" />{t("smartlink.ouvrir")}</a>
              </Button>
            </div>
          )}

          {s && stats && (
            <div className="text-sm">
              <p className="font-medium">{t("smartlink.stats.titre")} : {t("smartlink.stats.total", { n: stats.total })} · {t("smartlink.stats.trenteJours", { n: stats.trenteJours })}</p>
              {stats.total === 0 ? <p className="text-xs text-muted-foreground">{t("smartlink.stats.aucun")}</p> : (
                <ul className="text-xs text-muted-foreground mt-1 space-y-0.5">
                  {stats.boutons.map((x) => (
                    <li key={x.id}>{x.libelle} — {t("smartlink.stats.total", { n: x.total })} · {t("smartlink.stats.trenteJours", { n: x.trenteJours })}</li>
                  ))}
                  {stats.tuiles.filter((x) => x.total > 0).map((x) => (
                    <li key={x.contentId}>{t("smartlink.stats.tuile")} #{x.contentId} — {t("smartlink.stats.total", { n: x.total })} · {t("smartlink.stats.trenteJours", { n: x.trenteJours })}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {!s && !edition ? (
            <Button size="sm" onClick={() => setEdition(true)}><Plus className="w-3.5 h-3.5 mr-1" />{t("smartlink.creer")}</Button>
          ) : !edition ? (
            <Button size="sm" variant="outline" onClick={() => setEdition(true)}>{t("common.edit")}</Button>
          ) : (
            <div className="grid gap-6 md:grid-cols-[1fr_260px]">
              <div className="space-y-3">
                <label className="block">
                  <span className="text-xs text-muted-foreground">{t("smartlink.slug")}</span>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-muted-foreground whitespace-nowrap">{(data?.base ?? "").replace(/^https?:\/\//, "")}/b/</span>
                    <Input value={b.slug} maxLength={40} className="h-8 text-sm"
                      onChange={(e) => maj({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })} />
                  </div>
                  <span className="text-[11px] text-muted-foreground">{t("smartlink.slugAide")}</span>
                </label>
                <label className="block">
                  <span className="text-xs text-muted-foreground">{t("smartlink.titrePage")}</span>
                  <Input value={b.titre} maxLength={TITRE_SMARTLINK_MAX} className="h-8 text-sm" onChange={(e) => maj({ titre: e.target.value })} />
                </label>
                <label className="block">
                  <span className="text-xs text-muted-foreground">{t("smartlink.bio")}</span>
                  <Textarea value={b.bio} maxLength={BIO_MAX} rows={2} className="text-sm" onChange={(e) => maj({ bio: e.target.value })} />
                </label>
                <label className="block">
                  <span className="text-xs text-muted-foreground">{t("smartlink.avatar")}</span>
                  <select value={b.avatarUrl ?? ""} onChange={(e) => maj({ avatarUrl: e.target.value || null })}
                    className="w-full h-8 text-sm rounded-md border border-input bg-background px-2">
                    <option value="">{t("smartlink.avatarAucun")}</option>
                    {b.avatarUrl && !images.some((m) => m.url === b.avatarUrl) && <option value={b.avatarUrl}>{b.avatarUrl}</option>}
                    {images.map((m) => <option key={m.id} value={m.url}>{m.url.split("/").pop()}</option>)}
                  </select>
                </label>
                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-2 text-xs">
                    {t("smartlink.couleurFond")}
                    <input type="color" value={b.theme.couleurFond} onChange={(e) => maj({ theme: { ...b.theme, couleurFond: e.target.value } })} />
                  </label>
                  <label className="flex items-center gap-2 text-xs">
                    {t("smartlink.couleurTexte")}
                    <input type="color" value={b.theme.couleurTexte} onChange={(e) => maj({ theme: { ...b.theme, couleurTexte: e.target.value } })} />
                  </label>
                  <label className="flex items-center gap-2 text-xs">
                    <Switch checked={b.actif} onCheckedChange={(v) => maj({ actif: v })} />{t("smartlink.enLigne")}
                  </label>
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium">{t("smartlink.boutons")}</p>
                  {b.boutons.map((bt, i) => (
                    <div key={bt.id} className="flex flex-wrap items-center gap-1.5 rounded-md border border-border p-2">
                      <Input value={bt.libelle} maxLength={LIBELLE_MAX} placeholder={t("smartlink.libelle")} className="h-8 text-sm flex-1 min-w-[120px]"
                        onChange={(e) => majBouton(i, { libelle: e.target.value })} />
                      <Input value={bt.url} placeholder={t("smartlink.url")} className="h-8 text-sm flex-[2] min-w-[160px]"
                        onChange={(e) => majBouton(i, { url: e.target.value.trim() })} />
                      <Switch checked={bt.actif} onCheckedChange={(v) => majBouton(i, { actif: v })} aria-label={t("smartlink.boutonActif")} />
                      <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => deplacer(i, -1)} disabled={i === 0} aria-label={t("smartlink.monter")}><ArrowUp className="w-3.5 h-3.5" /></Button>
                      <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => deplacer(i, 1)} disabled={i === b.boutons.length - 1} aria-label={t("smartlink.descendre")}><ArrowDown className="w-3.5 h-3.5" /></Button>
                      <Button type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label={t("smartlink.supprimerBouton")}
                        onClick={() => maj({ boutons: b.boutons.filter((_, j) => j !== i) })}><Trash2 className="w-3.5 h-3.5" /></Button>
                      {statBouton(bt.id) && <span className="text-[11px] text-muted-foreground w-full">{t("smartlink.stats.total", { n: statBouton(bt.id)!.total })}</span>}
                    </div>
                  ))}
                  <Button type="button" size="sm" variant="outline" disabled={b.boutons.length >= 30}
                    onClick={() => maj({ boutons: [...b.boutons, { id: idLocal(), libelle: "", url: "https://", actif: true }] })}>
                    <Plus className="w-3.5 h-3.5 mr-1" />{t("smartlink.ajouterBouton")}
                  </Button>
                </div>

                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm">
                    <Switch checked={b.tuilesActives} onCheckedChange={(v) => maj({ tuilesActives: v })} />{t("smartlink.tuiles")}
                  </label>
                  {b.tuilesActives && (
                    (data?.publications.length ?? 0) === 0 ? <p className="text-xs text-muted-foreground">{t("smartlink.aucunePublication")}</p> : (
                      <>
                        <p className="text-xs text-muted-foreground">{t("smartlink.tuilesAide")}</p>
                        <ul className="space-y-1.5">
                          {data!.publications.map((p) => (
                            <li key={p.id} className="flex items-center gap-2">
                              <img src={p.imageUrl} alt="" className="w-10 h-10 object-cover rounded" />
                              <Input value={b.liensTuiles[String(p.id)] ?? ""} placeholder={t("smartlink.tuileLien")} className="h-8 text-sm"
                                onChange={(e) => maj({ liensTuiles: { ...b.liensTuiles, [String(p.id)]: e.target.value.trim() } })} />
                            </li>
                          ))}
                        </ul>
                      </>
                    )
                  )}
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  <Button size="sm" disabled={enregistrer.isPending} onClick={() => enregistrer.mutate(b)}>
                    {enregistrer.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />}{t("smartlink.enregistrer")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setB(depuisServeur(s, nomProjet)); setEdition(false); }}>{t("common.cancel")}</Button>
                  {s && (
                    <Button size="sm" variant="ghost" className="text-destructive ml-auto" disabled={supprimer.isPending}
                      onClick={() => { if (window.confirm(t("smartlink.confirmerSuppression"))) supprimer.mutate(); }}>
                      <Trash2 className="w-3.5 h-3.5 mr-1" />{t("smartlink.supprimer")}
                    </Button>
                  )}
                </div>
              </div>

              {/* Aperçu : la page telle qu'elle s'affichera sur un téléphone. */}
              <div>
                <p className="text-xs text-muted-foreground mb-1">{t("smartlink.apercu")}</p>
                <div className="rounded-2xl border border-border p-4 flex flex-col items-center gap-2 min-h-[320px]"
                  style={{ background: b.theme.couleurFond, color: b.theme.couleurTexte }}>
                  {b.avatarUrl && <img src={b.avatarUrl} alt="" className="w-14 h-14 rounded-full object-cover" />}
                  <p className="font-semibold text-sm text-center">{b.titre}</p>
                  {b.bio && <p className="text-xs text-center whitespace-pre-line opacity-80">{b.bio}</p>}
                  {b.boutons.filter((x) => x.actif && x.libelle.trim()).map((x) => (
                    <div key={x.id} className="w-full rounded-lg border-2 text-center text-xs font-semibold py-2 px-2 break-words"
                      style={{ borderColor: b.theme.couleurTexte }}>{x.libelle}</div>
                  ))}
                  {b.tuilesActives && (data?.publications.length ?? 0) > 0 && (
                    <div className="grid grid-cols-3 gap-0.5 w-full mt-1">
                      {data!.publications.map((p) => <img key={p.id} src={p.imageUrl} alt="" className="aspect-square object-cover w-full" />)}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
