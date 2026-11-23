// Groupes de marques (lot 9, inspiré des « brand groups » de Metricool) : un paquet de projets
// piloté ensemble. Ici : la liste des groupes (hook partagé) et la fenêtre de gestion — créer,
// renommer, changer la couleur, choisir les marques, supprimer.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Layers, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { COULEUR_GROUPE_DEFAUT, NOM_GROUPE_MAX } from "@shared/groupes-marques";

export interface GroupeMarquesClient { id: number; nom: string; couleur: string; projectIds: number[] }
export interface MarqueMin { id: number; name: string; color?: string | null }

export const CLE_GROUPES = ["/api/groupes-marques"];

export function useGroupesMarques(enabled = true) {
  return useQuery<GroupeMarquesClient[]>({
    queryKey: CLE_GROUPES,
    queryFn: async () => (await apiRequest("GET", "/api/groupes-marques")).json(),
    enabled,
  });
}

/** Les marques d'un groupe, dans l'ordre des projets (seules celles encore connues). */
export function marquesDuGroupe<P extends { id: number }>(groupe: GroupeMarquesClient | null | undefined, projets: P[]): P[] {
  if (!groupe) return [];
  const ids = new Set(groupe.projectIds);
  return projets.filter((p) => ids.has(p.id));
}

interface Brouillon { nom: string; couleur: string; projectIds: number[] }

function EditeurGroupe({ groupe, projets, onFini }: { groupe: GroupeMarquesClient | null; projets: MarqueMin[]; onFini: () => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [b, setB] = useState<Brouillon>({
    nom: groupe?.nom ?? "", couleur: groupe?.couleur ?? COULEUR_GROUPE_DEFAUT, projectIds: groupe?.projectIds ?? [],
  });
  const enregistrer = useMutation({
    mutationFn: async () => (await (groupe
      ? apiRequest("PATCH", `/api/groupes-marques/${groupe.id}`, { ...b, nom: b.nom.trim() })
      : apiRequest("POST", "/api/groupes-marques", { ...b, nom: b.nom.trim() }))).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CLE_GROUPES });
      qc.invalidateQueries({ queryKey: ["/api/content"] });
      toast({ title: t("groupesMarques.enregistre") });
      onFini();
    },
    onError: () => toast({ title: t("groupesMarques.erreur"), variant: "destructive" }),
  });
  const basculer = (id: number) => setB((x) => ({ ...x, projectIds: x.projectIds.includes(id) ? x.projectIds.filter((p) => p !== id) : [...x.projectIds, id] }));
  return (
    <div className="space-y-3 rounded-lg border border-naya-olive-18 p-3" data-testid={`editeur-groupe-${groupe?.id ?? "nouveau"}`}>
      <div className="flex items-center gap-2">
        <input type="color" value={b.couleur} onChange={(e) => setB({ ...b, couleur: e.target.value })}
          aria-label={t("groupesMarques.couleur")} className="h-9 w-9 shrink-0 cursor-pointer rounded border border-naya-olive-18 bg-white p-0.5" />
        <Input value={b.nom} maxLength={NOM_GROUPE_MAX} onChange={(e) => setB({ ...b, nom: e.target.value })}
          placeholder={t("groupesMarques.nom")} aria-label={t("groupesMarques.nom")} />
      </div>
      <fieldset>
        <legend className="text-xs text-naya-olive-55 mb-1.5">{t("groupesMarques.marques")}</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-52 overflow-y-auto">
          {projets.map((p) => (
            <label key={p.id} className="flex items-center gap-2 text-sm">
              <Checkbox checked={b.projectIds.includes(p.id)} onCheckedChange={() => basculer(p.id)} />
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: p.color || "var(--accent)" }} />
              <span className="truncate">{p.name}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onFini}>{t("groupesMarques.annuler")}</Button>
        <Button type="button" size="sm" disabled={!b.nom.trim() || enregistrer.isPending} onClick={() => enregistrer.mutate()}>
          {enregistrer.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : groupe ? t("groupesMarques.enregistrer") : t("groupesMarques.creer")}
        </Button>
      </div>
    </div>
  );
}

function ContenuGestion({ projets }: { projets: MarqueMin[] }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: groupes = [], isLoading } = useGroupesMarques();
  const [edition, setEdition] = useState<number | "nouveau" | null>(null);
  const supprimer = useMutation({
    mutationFn: async (id: number) => (await apiRequest("DELETE", `/api/groupes-marques/${id}`)).json(),
    onSuccess: () => { qc.invalidateQueries({ queryKey: CLE_GROUPES }); toast({ title: t("groupesMarques.supprime") }); },
    onError: () => toast({ title: t("groupesMarques.erreur"), variant: "destructive" }),
  });
  return (
    <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{t("groupesMarques.titre")}</DialogTitle>
      </DialogHeader>
      <p className="text-sm text-naya-olive-55 -mt-2">{t("groupesMarques.intro")}</p>
      {isLoading ? <Loader2 className="h-5 w-5 animate-spin mx-auto" /> : (
        <div className="space-y-2">
          {groupes.length === 0 && edition !== "nouveau" && <p className="text-sm text-naya-olive-35">{t("groupesMarques.vide")}</p>}
          {groupes.map((g) => (edition === g.id ? (
            <EditeurGroupe key={g.id} groupe={g} projets={projets} onFini={() => setEdition(null)} />
          ) : (
            <div key={g.id} className="flex items-center gap-2 rounded-lg border border-naya-olive-18 px-3 py-2">
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: g.couleur }} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{g.nom}</p>
                <p className="truncate text-xs text-naya-olive-55">
                  {marquesDuGroupe(g, projets).map((p) => p.name).join(" · ") || t("groupesMarques.nbMarques", { count: 0 })}
                </p>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setEdition(g.id)}>{t("groupesMarques.modifier")}</Button>
              <Button type="button" variant="ghost" size="sm" aria-label={t("groupesMarques.supprimer")} disabled={supprimer.isPending}
                onClick={() => { if (window.confirm(t("groupesMarques.confirmerSuppression", { nom: g.nom }))) supprimer.mutate(g.id); }}>
                <Trash2 className="h-4 w-4 text-naya-mauve" />
              </Button>
            </div>
          )))}
          {edition === "nouveau" ? (
            <EditeurGroupe groupe={null} projets={projets} onFini={() => setEdition(null)} />
          ) : (
            <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setEdition("nouveau")}>
              <Plus className="h-4 w-4" />{t("groupesMarques.nouveau")}
            </Button>
          )}
        </div>
      )}
    </DialogContent>
  );
}

/** Bouton « Groupes de marques » et sa fenêtre de gestion. */
export function GestionGroupesMarques({ projets, compact = false }: { projets: MarqueMin[]; compact?: boolean }) {
  const { t } = useTranslation();
  const [ouvert, setOuvert] = useState(false);
  return (
    <Dialog open={ouvert} onOpenChange={setOuvert}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size={compact ? "sm" : "default"} className="gap-2" data-testid="ouvrir-groupes-marques">
          <Layers className="h-4 w-4" />{t("groupesMarques.ouvrir")}
        </Button>
      </DialogTrigger>
      {ouvert && <ContenuGestion projets={projets} />}
    </Dialog>
  );
}
