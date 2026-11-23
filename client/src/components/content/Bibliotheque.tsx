// Bibliothèque du calendrier (lot 3, inspiré de Metricool) : textes enregistrés et posts
// modèles. Recherche par nom ; un modèle s'utilise en brouillon (jamais programmé) dans la
// marque et à la date choisies ; un texte se copie, s'ajoute, se supprime.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Copy, FileText, LayoutTemplate, Loader2, Plus, Repeat, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { filtrerParNom, reseauxDuModele, TEXTE_ENREGISTRE_MAX, TITRE_TEXTE_MAX, type ContenuModele } from "@shared/bibliotheque";
import { CLE_TEXTES, useTextesEnregistres } from "./TextesEnregistres";
import { AjouterAAutoliste } from "./Autolistes";

interface ProjetMin { id: number; name: string }
interface ModeleClient { id: number; nom: string; projectId: number | null; contenu: ContenuModele; createdAt: string }

export const CLE_MODELES = ["/api/bibliotheque/modeles"];
const SANS = "aucun";
const versProjet = (v: string) => (v === SANS ? null : Number(v));

function ChoixMarque({ projets, valeur, onChange }: { projets: ProjetMin[]; valeur: string; onChange: (v: string) => void }) {
  const { t } = useTranslation();
  return (
    <Select value={valeur} onValueChange={onChange}>
      <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={SANS}>{t("bibliotheque.sansMarque")}</SelectItem>
        {projets.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function UtiliserModele({ modele, projets, projetCourantId, onFini }: { modele: ModeleClient; projets: ProjetMin[]; projetCourantId: number | null; onFini: () => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const reseaux = reseauxDuModele(modele.contenu);
  const [marque, setMarque] = useState(String(projetCourantId ?? modele.projectId ?? SANS));
  const [quand, setQuand] = useState("");
  const [reseau, setReseau] = useState(String(modele.contenu?.platform ?? reseaux[0] ?? ""));
  const utiliser = useMutation({
    mutationFn: async () => {
      const d = quand ? new Date(quand) : null;
      const r = await apiRequest("POST", `/api/bibliotheque/modeles/${modele.id}/utiliser`, {
        projectId: versProjet(marque), scheduledFor: d && !isNaN(d.getTime()) ? d.toISOString() : null, platform: reseau || null,
      });
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/content"] });
      toast({ title: t("bibliotheque.modeles.utiliseToast") });
      onFini();
    },
    onError: () => toast({ title: t("bibliotheque.erreur"), variant: "destructive" }),
  });
  return (
    <div className="mt-2 grid gap-2 sm:grid-cols-3 bg-naya-olive-06 rounded p-2" data-testid={`utiliser-modele-${modele.id}`}>
      <ChoixMarque projets={projets} valeur={marque} onChange={setMarque} />
      <Input type="datetime-local" value={quand} onChange={(e) => setQuand(e.target.value)} className="h-8 text-sm" aria-label={t("bibliotheque.modeles.date")} />
      <Select value={reseau} onValueChange={setReseau}>
        <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
        <SelectContent>
          {reseaux.map((r) => <SelectItem key={r} value={r}>{t(`bibliotheque.reseaux.${r}`, { defaultValue: r })}</SelectItem>)}
        </SelectContent>
      </Select>
      <p className="text-xs text-naya-olive-55 sm:col-span-2">{t("bibliotheque.modeles.utiliserAide")}</p>
      <Button size="sm" type="button" disabled={!reseau || utiliser.isPending} onClick={() => utiliser.mutate()}>
        {utiliser.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
        {t("bibliotheque.modeles.creerBrouillon")}
      </Button>
    </div>
  );
}

export default function Bibliotheque({ projets, projetCourantId }: { projets: ProjetMin[]; projetCourantId: number | null }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [enUsage, setEnUsage] = useState<number | null>(null);
  const [versAutoliste, setVersAutoliste] = useState<number | null>(null);
  const [nouveau, setNouveau] = useState<{ titre: string; texte: string; marque: string } | null>(null);
  const { data: textes = [], isLoading: chargeTextes } = useTextesEnregistres();
  const { data: modeles = [], isLoading: chargeModeles } = useQuery<ModeleClient[]>({
    queryKey: CLE_MODELES,
    queryFn: async () => (await apiRequest("GET", "/api/bibliotheque/modeles")).json(),
  });
  const nomMarque = (id: number | null) => (id == null ? t("bibliotheque.toutesMarques") : projets.find((p) => p.id === id)?.name ?? `#${id}`);

  const supprimerTexte = useMutation({
    mutationFn: async (id: number) => (await apiRequest("DELETE", `/api/bibliotheque/textes/${id}`)).json(),
    onSuccess: () => qc.invalidateQueries({ queryKey: CLE_TEXTES }),
    onError: () => toast({ title: t("bibliotheque.erreur"), variant: "destructive" }),
  });
  const creerTexte = useMutation({
    mutationFn: async (v: { titre: string; texte: string; marque: string }) =>
      (await apiRequest("POST", "/api/bibliotheque/textes", { titre: v.titre, texte: v.texte, projectId: versProjet(v.marque) })).json(),
    onSuccess: () => { qc.invalidateQueries({ queryKey: CLE_TEXTES }); setNouveau(null); toast({ title: t("bibliotheque.textes.enregistreToast") }); },
    onError: () => toast({ title: t("bibliotheque.erreur"), variant: "destructive" }),
  });
  const supprimerModele = useMutation({
    mutationFn: async (id: number) => (await apiRequest("DELETE", `/api/bibliotheque/modeles/${id}`)).json(),
    onSuccess: () => qc.invalidateQueries({ queryKey: CLE_MODELES }),
    onError: () => toast({ title: t("bibliotheque.erreur"), variant: "destructive" }),
  });

  const copier = async (texte: string) => {
    try { await navigator.clipboard.writeText(texte); toast({ title: t("bibliotheque.textes.copie") }); }
    catch { toast({ title: t("bibliotheque.erreur"), variant: "destructive" }); }
  };

  const textesVus = filtrerParNom(textes, q, (x) => x.titre);
  const modelesVus = filtrerParNom(modeles, q, (x) => x.nom);

  return (
    <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{t("bibliotheque.titre")}</DialogTitle>
      </DialogHeader>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("bibliotheque.rechercherNom")} className="h-9 text-sm" data-testid="bibliotheque-recherche" />
      <Tabs defaultValue="modeles">
        <TabsList>
          <TabsTrigger value="modeles" className="flex items-center gap-1.5"><LayoutTemplate className="h-3.5 w-3.5" />{t("bibliotheque.onglets.modeles")}</TabsTrigger>
          <TabsTrigger value="textes" className="flex items-center gap-1.5"><FileText className="h-3.5 w-3.5" />{t("bibliotheque.onglets.textes")}</TabsTrigger>
        </TabsList>

        <TabsContent value="modeles" className="space-y-2">
          <p className="text-xs text-naya-olive-55">{t("bibliotheque.modeles.aide")}</p>
          {chargeModeles ? <Loader2 className="h-5 w-5 animate-spin mx-auto" /> : modelesVus.length === 0 ? (
            <p className="text-sm text-naya-olive-35 py-6 text-center">{modeles.length === 0 ? t("bibliotheque.modeles.aucun") : t("bibliotheque.aucunResultat")}</p>
          ) : (
            <ul className="divide-y divide-naya-olive-18">
              {modelesVus.map((m) => {
                const reseaux = reseauxDuModele(m.contenu);
                const apercu = m.contenu?.textes?.[m.contenu?.platform] ?? Object.values(m.contenu?.textes ?? {})[0] ?? "";
                const nbMedias = Array.isArray(m.contenu?.mediaIds) ? m.contenu.mediaIds.length : 0;
                return (
                  <li key={m.id} className="py-2" data-testid={`modele-${m.id}`}>
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-foreground truncate">{m.nom}</p>
                        <p className="text-xs text-naya-olive-35">
                          {t("bibliotheque.modeles.resume", {
                            reseaux: reseaux.map((r) => t(`bibliotheque.reseaux.${r}`, { defaultValue: r })).join(", "),
                            count: nbMedias, marque: nomMarque(m.projectId), date: m.createdAt ? format(new Date(m.createdAt), "dd/MM/yyyy") : "",
                          })}
                        </p>
                        <p className="text-xs text-naya-olive-55 line-clamp-2 whitespace-pre-line mt-0.5">{apercu}</p>
                      </div>
                      <Button size="sm" variant="outline" type="button" onClick={() => setEnUsage(enUsage === m.id ? null : m.id)}>
                        {t("bibliotheque.modeles.utiliser")}
                      </Button>
                      <Button size="sm" variant="outline" type="button" onClick={() => setVersAutoliste(versAutoliste === m.id ? null : m.id)}
                        aria-label={t("autolistes.ajouter.bouton")} title={t("autolistes.ajouter.bouton")} data-testid={`modele-autoliste-${m.id}`}>
                        <Repeat className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="outline" type="button" disabled={supprimerModele.isPending}
                        aria-label={t("bibliotheque.supprimer")} title={t("bibliotheque.supprimer")}
                        onClick={() => { if (window.confirm(t("bibliotheque.modeles.confirmer"))) supprimerModele.mutate(m.id); }}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    {versAutoliste === m.id && (
                      <div className="mt-2 bg-naya-olive-06 rounded p-2">
                        <AjouterAAutoliste source={{ modeleId: m.id }} onFini={() => setVersAutoliste(null)} />
                      </div>
                    )}
                    {enUsage === m.id && (
                      <UtiliserModele modele={m} projets={projets} projetCourantId={projetCourantId} onFini={() => setEnUsage(null)} />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="textes" className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-naya-olive-55">{t("bibliotheque.textes.aide")}</p>
            {!nouveau && (
              <Button size="sm" variant="outline" type="button" onClick={() => setNouveau({ titre: "", texte: "", marque: String(projetCourantId ?? SANS) })}>
                <Plus className="h-3.5 w-3.5 mr-1" />{t("bibliotheque.textes.nouveau")}
              </Button>
            )}
          </div>
          {nouveau && (
            <div className="space-y-2 bg-naya-olive-06 rounded p-2">
              <Input value={nouveau.titre} maxLength={TITRE_TEXTE_MAX} onChange={(e) => setNouveau({ ...nouveau, titre: e.target.value })}
                placeholder={t("bibliotheque.textes.titrePlaceholder")} className="h-8 text-sm" />
              <Textarea value={nouveau.texte} maxLength={TEXTE_ENREGISTRE_MAX} rows={3} onChange={(e) => setNouveau({ ...nouveau, texte: e.target.value })}
                placeholder={t("bibliotheque.textes.textePlaceholder")} />
              <ChoixMarque projets={projets} valeur={nouveau.marque} onChange={(v) => setNouveau({ ...nouveau, marque: v })} />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" type="button" onClick={() => setNouveau(null)}>{t("bibliotheque.annuler")}</Button>
                <Button size="sm" type="button" disabled={!nouveau.titre.trim() || !nouveau.texte.trim() || creerTexte.isPending}
                  onClick={() => creerTexte.mutate(nouveau)}>
                  {t("bibliotheque.textes.enregistrerBouton")}
                </Button>
              </div>
            </div>
          )}
          {chargeTextes ? <Loader2 className="h-5 w-5 animate-spin mx-auto" /> : textesVus.length === 0 ? (
            <p className="text-sm text-naya-olive-35 py-6 text-center">{textes.length === 0 ? t("bibliotheque.textes.aucun") : t("bibliotheque.aucunResultat")}</p>
          ) : (
            <ul className="divide-y divide-naya-olive-18">
              {textesVus.map((x) => (
                <li key={x.id} className="py-2 flex items-start gap-3" data-testid={`texte-${x.id}`}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground truncate">{x.titre}</p>
                    <p className="text-xs text-naya-olive-35">{nomMarque(x.projectId)}</p>
                    <p className="text-xs text-naya-olive-55 line-clamp-3 whitespace-pre-line mt-0.5">{x.texte}</p>
                  </div>
                  <Button size="sm" variant="outline" type="button" onClick={() => void copier(x.texte)}
                    aria-label={t("bibliotheque.textes.copier")} title={t("bibliotheque.textes.copier")}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="outline" type="button" disabled={supprimerTexte.isPending}
                    aria-label={t("bibliotheque.supprimer")} title={t("bibliotheque.supprimer")}
                    onClick={() => { if (window.confirm(t("bibliotheque.textes.confirmer"))) supprimerTexte.mutate(x.id); }}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>
    </DialogContent>
  );
}
