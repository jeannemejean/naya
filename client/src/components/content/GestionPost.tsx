// Gestion d'un post dans sa fenêtre du calendrier : notes internes (jamais publiées),
// historique des événements, et « Dupliquer vers… » une ou plusieurs marques.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Copy, History, LayoutTemplate, Loader2, Repeat, StickyNote, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { TEXTE_NOTE_MAX } from "@shared/gestion-posts";
import { NOM_MODELE_MAX } from "@shared/bibliotheque";
import { AjouterAAutoliste } from "./Autolistes";

interface Note { id: number; texte: string; createdAt: string }
interface Evenement { id: number | null; evenement: string; details: Record<string, any> | null; createdAt: string }
interface ProjetMin { id: number; name: string }

const quand = (d: string | null | undefined) => (d ? format(new Date(d), "dd/MM/yyyy HH:mm") : "");

/** Le détail lisible d'un événement de l'historique (date déplacée, raison d'un échec…). */
function DetailEvenement({ e, projets }: { e: Evenement; projets: ProjetMin[] }) {
  const { t } = useTranslation();
  const d = e.details ?? {};
  if (e.evenement === "date_modifiee") {
    return <span>{t("gestionPost.historique.dateDeplacee", { avant: quand(d.avant) || t("gestionPost.historique.sansDate"), apres: quand(d.apres) || t("gestionPost.historique.sansDate") })}</span>;
  }
  if (e.evenement === "echec" && d.raison) return <span>{t("gestionPost.historique.raison", { raison: String(d.raison) })}</span>;
  if (e.evenement === "cree" && d.depuis) return <span>{t("gestionPost.historique.depuis", { id: d.depuis })}</span>;
  if (e.evenement === "cree" && d.modele) return <span>{t("gestionPost.historique.depuisModele", { nom: String(d.modele) })}</span>;
  if (e.evenement === "duplique") {
    const nom = d.versProjetId == null ? t("gestionPost.dupliquer.sansProjet") : (projets.find((p) => p.id === d.versProjetId)?.name ?? `#${d.versProjetId}`);
    return <span>{t("gestionPost.historique.versProjet", { projet: nom })}</span>;
  }
  return null;
}

export default function GestionPost({ postId, projets, projetCourantId }: { postId: number; projets: ProjetMin[]; projetCourantId: number | null }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [texte, setTexte] = useState("");
  const [cibles, setCibles] = useState<number[]>([]);
  const [nomModele, setNomModele] = useState("");

  const cleNotes = ["/api/content", postId, "notes"];
  const cleHistorique = ["/api/content", postId, "historique"];
  const { data: notes = [], isLoading: chargeNotes } = useQuery<Note[]>({
    queryKey: cleNotes,
    queryFn: async () => (await apiRequest("GET", `/api/content/${postId}/notes`)).json(),
  });
  const { data: historique = [], isLoading: chargeHistorique } = useQuery<Evenement[]>({
    queryKey: cleHistorique,
    queryFn: async () => (await apiRequest("GET", `/api/content/${postId}/historique`)).json(),
  });

  const ajouter = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/content/${postId}/notes`, { texte })).json(),
    onSuccess: () => { setTexte(""); qc.invalidateQueries({ queryKey: cleNotes }); qc.invalidateQueries({ queryKey: cleHistorique }); },
    onError: () => toast({ title: t("gestionPost.notes.erreur"), variant: "destructive" }),
  });
  const retirer = useMutation({
    mutationFn: async (noteId: number) => (await apiRequest("DELETE", `/api/content/${postId}/notes/${noteId}`)).json(),
    onSuccess: () => qc.invalidateQueries({ queryKey: cleNotes }),
    onError: () => toast({ title: t("gestionPost.notes.erreur"), variant: "destructive" }),
  });
  const dupliquer = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/content/${postId}/dupliquer`, { projectIds: cibles })).json(),
    onSuccess: (r: { crees: unknown[] }) => {
      setCibles([]);
      qc.invalidateQueries({ queryKey: ["/api/content"] });
      toast({ title: t("gestionPost.dupliquer.toast", { count: r?.crees?.length ?? 0 }) });
    },
    onError: () => toast({ title: t("gestionPost.dupliquer.erreur"), variant: "destructive" }),
  });

  const enregistrerModele = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/content/${postId}/enregistrer-modele`, { nom: nomModele.trim() })).json(),
    onSuccess: () => {
      setNomModele("");
      qc.invalidateQueries({ queryKey: ["/api/bibliotheque/modeles"] });
      toast({ title: t("bibliotheque.modeles.enregistreToast") });
    },
    onError: () => toast({ title: t("bibliotheque.erreur"), variant: "destructive" }),
  });

  const basculer = (id: number) => setCibles((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  const trop = texte.trim().length > TEXTE_NOTE_MAX;

  return (
    <div className="border border-naya-olive-18 rounded-lg p-3" data-testid="gestion-post">
      <Tabs defaultValue="notes">
        <TabsList>
          <TabsTrigger value="notes" className="flex items-center gap-1.5"><StickyNote className="h-3.5 w-3.5" />{t("gestionPost.onglets.notes")}</TabsTrigger>
          <TabsTrigger value="historique" className="flex items-center gap-1.5"><History className="h-3.5 w-3.5" />{t("gestionPost.onglets.historique")}</TabsTrigger>
          <TabsTrigger value="dupliquer" className="flex items-center gap-1.5"><Copy className="h-3.5 w-3.5" />{t("gestionPost.onglets.dupliquer")}</TabsTrigger>
          <TabsTrigger value="modele" className="flex items-center gap-1.5"><LayoutTemplate className="h-3.5 w-3.5" />{t("gestionPost.onglets.modele")}</TabsTrigger>
          <TabsTrigger value="autoliste" className="flex items-center gap-1.5"><Repeat className="h-3.5 w-3.5" />{t("autolistes.onglet")}</TabsTrigger>
        </TabsList>

        <TabsContent value="notes" className="space-y-2">
          <p className="text-xs text-naya-olive-55">{t("gestionPost.notes.aide")}</p>
          {chargeNotes ? <Loader2 className="h-4 w-4 animate-spin" /> : notes.length === 0 ? (
            <p className="text-xs text-naya-olive-35">{t("gestionPost.notes.vide")}</p>
          ) : (
            <ul className="space-y-1.5 max-h-48 overflow-y-auto">
              {notes.map((n) => (
                <li key={n.id} className="group flex items-start gap-2 text-sm bg-naya-olive-06 rounded p-2">
                  <div className="flex-1 min-w-0">
                    <p className="whitespace-pre-wrap break-words">{n.texte}</p>
                    <p className="text-[10px] text-naya-olive-35 mt-0.5">{quand(n.createdAt)}</p>
                  </div>
                  <button type="button" onClick={() => retirer.mutate(n.id)} aria-label={t("gestionPost.notes.supprimer")} title={t("gestionPost.notes.supprimer")}
                    className="opacity-60 hover:opacity-100">
                    <Trash2 className="h-3.5 w-3.5 text-naya-mauve" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Textarea value={texte} onChange={(e) => setTexte(e.target.value)} rows={2} placeholder={t("gestionPost.notes.placeholder")} />
          <div className="flex items-center justify-between">
            <span className={`text-[10px] ${trop ? "text-[#5c3d45]" : "text-naya-olive-35"}`}>{t("gestionPost.notes.compteur", { n: texte.trim().length, max: TEXTE_NOTE_MAX })}</span>
            <Button size="sm" type="button" disabled={!texte.trim() || trop || ajouter.isPending} onClick={() => ajouter.mutate()}>
              {t("gestionPost.notes.ajouter")}
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="historique">
          {chargeHistorique ? <Loader2 className="h-4 w-4 animate-spin" /> : historique.length === 0 ? (
            <p className="text-xs text-naya-olive-35">{t("gestionPost.historique.vide")}</p>
          ) : (
            <ol className="space-y-1.5 max-h-56 overflow-y-auto">
              {historique.map((e, i) => (
                <li key={e.id ?? `s${i}`} className="text-sm flex gap-2">
                  <span className="text-[11px] text-naya-olive-35 w-28 flex-shrink-0">{quand(e.createdAt)}</span>
                  <span className="flex-1">
                    <span className="text-foreground">{t(`gestionPost.historique.evenement.${e.evenement}`, { defaultValue: e.evenement })}</span>
                    {" "}<span className="text-xs text-naya-olive-55"><DetailEvenement e={e} projets={projets} /></span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </TabsContent>

        <TabsContent value="dupliquer" className="space-y-2">
          <p className="text-xs text-naya-olive-55">{t("gestionPost.dupliquer.aide")}</p>
          <div className="max-h-40 overflow-y-auto space-y-1">
            {projets.map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox checked={cibles.includes(p.id)} onCheckedChange={() => basculer(p.id)} />
                <span>{p.name}</span>
                {p.id === projetCourantId && <span className="text-[10px] text-naya-olive-35">{t("gestionPost.dupliquer.marqueActuelle")}</span>}
              </label>
            ))}
          </div>
          <Button size="sm" type="button" disabled={cibles.length === 0 || dupliquer.isPending} onClick={() => dupliquer.mutate()}>
            {dupliquer.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
            {t("gestionPost.dupliquer.bouton", { count: cibles.length })}
          </Button>
        </TabsContent>

        <TabsContent value="modele" className="space-y-2">
          <p className="text-xs text-naya-olive-55">{t("bibliotheque.modeles.enregistrerAide")}</p>
          <div className="flex gap-2">
            <Input value={nomModele} maxLength={NOM_MODELE_MAX} onChange={(e) => setNomModele(e.target.value)}
              placeholder={t("bibliotheque.modeles.nomPlaceholder")} className="h-8 text-sm" data-testid="nom-modele" />
            <Button size="sm" type="button" disabled={!nomModele.trim() || enregistrerModele.isPending} onClick={() => enregistrerModele.mutate()}>
              {enregistrerModele.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <LayoutTemplate className="h-3.5 w-3.5 mr-1" />}
              {t("bibliotheque.modeles.enregistrer")}
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="autoliste" className="space-y-2">
          <AjouterAAutoliste source={{ contentId: postId }} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
