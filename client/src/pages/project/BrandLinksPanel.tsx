// Fil « liens entre marques » — écran de déclaration des liens d'une marque avec les autres
// marques de l'utilisatrice (spec : docs/superpowers/specs/2026-09-30-naya-liens-entre-marques-design.md).
//
// Doctrine (voir le commentaire sur `projectLinks` dans shared/schema.ts) :
// - L'ABSENCE de lien est un état NORMAL et explicite, pas un vide silencieux ni une anomalie :
//   Naya ne rapproche jamais deux marques d'elle-même quand rien n'a été déclaré. C'est la règle
//   centrale du chantier, dite ici où elle se constate — d'où la phrase d'état vide ci-dessous,
//   qui dit ce que l'absence SIGNIFIE plutôt que d'afficher un compteur à zéro.
// - Un lien se lit dans les deux sens même s'il n'en porte qu'un : cette page montre aussi bien
//   ce que cette marque nourrit que ce qui la nourrit, sans obliger à aller sur l'autre page.
// - Le sens et le recoupement d'audiences sont structurés parce qu'ils font agir le code ; les
//   rôles et la nature sont du texte libre, dans les mots de l'utilisatrice.
import { useState } from "react";
import { Plus } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJson } from "@/lib/fetchJson";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { useEnsembleId } from "@/hooks/use-ensemble-id";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import type { ProjectLink } from "@shared/schema";

interface BrandLinksPanelProps {
  projectId: number;
}

/** Juste ce dont cet écran a besoin de `/api/projects` : l'id et le nom des autres marques. */
interface Projet {
  id: number;
  name: string;
}

interface LiensReponse {
  sortants: ProjectLink[];
  entrants: ProjectLink[];
}

type ChampsLibres = Pick<ProjectLink, "roleAmont" | "roleAval" | "nature">;

function formeVide() {
  return {
    autreProjectId: "",
    sens: "sortant" as "sortant" | "entrant",
    roleAmont: "",
    roleAval: "",
    nature: "",
    audiencesRecoupent: false,
  };
}

export default function BrandLinksPanel({ projectId }: BrandLinksPanelProps) {
  const qc = useQueryClient();
  const { toast } = useToast();

  // Panneau best-effort, comme les autres sections secondaires de cette page (même raison que
  // requetes-de-veille.tsx et dashboard.tsx/AppelRevue) : la règle globale de
  // client/src/lib/queryClient.ts (`throwOnError: (error) => !is401(error)`) ferait remonter un
  // échec ici jusqu'à l'UNIQUE ErrorBoundary du routeur (client/src/App.tsx), qui casserait toute
  // l'application — dashboard, planning, compagnon compris — pour la panne d'un seul panneau
  // secondaire de la page projet. `throwOnError: false` neutralise ça localement : `liens` reste
  // `undefined` sur erreur, et les replis `?? []` plus bas suffisent à afficher le panneau vide.
  const liensQuery = useQuery<LiensReponse>({
    queryKey: [`/api/projects/${projectId}/links`],
    queryFn: () => fetchJson(`/api/projects/${projectId}/links`),
    throwOnError: false,
  });

  // Même raison : sert uniquement à retrouver le nom des autres marques et à peupler le
  // formulaire d'ajout, ce n'est pas une donnée dont la perte doit casser la page.
  const projetsQuery = useQuery<Projet[]>({
    queryKey: ["/api/projects"],
    queryFn: () => fetchJson("/api/projects"),
    throwOnError: false,
  });

  const projets = projetsQuery.data ?? [];
  // `project_links` référence `projects` en `onDelete: cascade` (shared/schema.ts) : un lien ne
  // survit jamais à la marque qu'il désigne. Ce repli ne devrait donc se déclencher qu'après un
  // échec de lecture de `/api/projects` — jamais parce que la marque aurait disparu sans que son
  // lien disparaisse avec elle. On le dit tel quel plutôt que d'afficher un nom générique qui
  // laisserait croire qu'on connaît la marque et qu'elle s'appelle juste « Autre marque ».
  const nomAutreMarque = (id: number) => {
    const trouvee = projets.find((p) => p.id === id)?.name;
    if (trouvee) return trouvee;
    return projetsQuery.isError ? "Marque non chargée" : "Autre marque";
  };
  // Une marque ne se lie jamais à elle-même — le serveur le refuse déjà (valideLien), autant ne
  // pas la proposer dans le formulaire d'ajout.
  const autresMarques = projets.filter((p) => p.id !== projectId);

  const invaliderLiens = () => qc.invalidateQueries({ queryKey: [`/api/projects/${projectId}/links`] });

  const signalerEchec = (titre: string, description: string) =>
    toast({ title: titre, description, variant: "destructive" });

  // Un échec HTTP arrive ici sous la forme posée par `throwIfResNotOk`
  // (client/src/lib/queryClient.ts) : `new Error(`${status}: ${corpsBrut}`)`. `fetchJson` ne
  // fait rien d'autre que relayer cette erreur. Pour certains statuts, la bonne réponse n'est
  // PAS « réessaie » : réessayer produit déterministiquement le même échec, parce que la cause
  // n'est pas transitoire. Deux cas dans cette doctrine, tous les deux via `project_links` :
  // - 409 sur l'ajout : l'index unique (userId, from, to) refuse un doublon (server/routes.ts,
  //   POST /api/projects/:id/links) — le lien dans ce sens existe déjà, rien ne le fera
  //   disparaître en réessayant la même requête ;
  // - 404 sur la modification ou la suppression : le lien visé a déjà disparu (PATCH et DELETE
  //   /api/project-links/:id) — `project_links` est en cascade sur `projects` (shared/schema.ts),
  //   la ligne ne revient jamais, et réessayer la même requête échouera toujours pareil.
  // Dans ces deux cas on affiche ce que le serveur a dit — un message pensé pour l'utilisatrice,
  // pas un texte de debug — plutôt que d'inventer une invite à réessayer qui mentirait. Même
  // lecture d'erreur qu'ailleurs dans ce dépôt (client/src/pages/outreach/PipelineBoard.tsx,
  // LeadDetail.tsx) : extraire le JSON embarqué dans le message, lire son `message`.
  const messageDefinitif = (error: unknown, statuts: readonly number[]): string | null => {
    if (!(error instanceof Error)) return null;
    if (!statuts.some((s) => error.message.startsWith(`${s}:`))) return null;
    const corps = error.message.match(/\{[\s\S]*\}/);
    if (!corps) return null;
    try {
      const { message } = JSON.parse(corps[0]);
      return typeof message === "string" ? message : null;
    } catch {
      return null;
    }
  };

  const modifier = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Partial<ChampsLibres> | { audiencesRecoupent: boolean } }) =>
      fetchJson(`/api/project-links/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }),
    onSuccess: invaliderLiens,
    // Une déclaration perdue en silence est une déclaration que l'utilisatrice croira faite :
    // sans ce toast, un champ modifié à l'écran mais jamais enregistré côté serveur redeviendrait
    // muettement faux au prochain rechargement, sans qu'elle sache pourquoi.
    onError: (error: unknown) =>
      signalerEchec(
        "Non enregistré",
        messageDefinitif(error, [404]) ?? "La modification n'a pas été enregistrée : réessaie.",
      ),
  });

  // Suivi PAR LIEN de la suppression en cours : la mutation est partagée par toutes les cartes
  // (une seule instance `useMutation`), donc son `isPending` global désactiverait le bouton de
  // TOUS les liens dès qu'un seul est en cours de suppression. `useEnsembleId` isole chaque ligne
  // (même motif que requetes-de-veille.tsx).
  const [suppressionEnCours, marquerSuppressionEnCours, retirerSuppressionEnCours] = useEnsembleId();

  const supprimer = useMutation({
    mutationFn: (id: number) => fetchJson(`/api/project-links/${id}`, { method: "DELETE" }),
    onMutate: (id: number) => marquerSuppressionEnCours(id),
    onSuccess: invaliderLiens,
    onError: (error: unknown) =>
      signalerEchec(
        "Non supprimé",
        messageDefinitif(error, [404]) ?? "Le lien n'a pas été supprimé : réessaie.",
      ),
    onSettled: (_data, _erreur, id: number) => retirerSuppressionEnCours(id),
  });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(formeVide());

  const ajouter = useMutation({
    mutationFn: (input: ReturnType<typeof formeVide>) => {
      const autreId = Number(input.autreProjectId);
      const fromProjectId = input.sens === "sortant" ? projectId : autreId;
      const toProjectId = input.sens === "sortant" ? autreId : projectId;
      return fetchJson(`/api/projects/${fromProjectId}/links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toProjectId,
          roleAmont: input.roleAmont.trim() || undefined,
          roleAval: input.roleAval.trim() || undefined,
          nature: input.nature.trim() || undefined,
          audiencesRecoupent: input.audiencesRecoupent,
        }),
      });
    },
    onSuccess: () => {
      invaliderLiens();
      setOpen(false);
      setForm(formeVide());
    },
    // Le 409 (lien déjà déclaré dans ce sens) n'est pas un aléa : réessayer la même déclaration
    // échoue toujours pareil. C'est le seul geste délibéré de cet écran — le mentir ici coûte
    // plus cher qu'ailleurs sur ce panneau. On affiche donc le message précis du serveur plutôt
    // que l'invite à réessayer, qui serait fausse dans ce cas précis.
    onError: (error: unknown) =>
      signalerEchec(
        "Non enregistré",
        messageDefinitif(error, [409]) ?? "Le lien n'a pas été déclaré : réessaie.",
      ),
  });

  const sortants = liensQuery.data?.sortants ?? [];
  const entrants = liensQuery.data?.entrants ?? [];
  const chargement = liensQuery.isLoading || projetsQuery.isLoading;
  // Distingue une liste VRAIMENT vide d'un simple échec de lecture. La phrase d'état vide plus bas
  // énonce la règle centrale du produit (l'absence de lien vaut interdiction, Naya ne rapprochera
  // pas cette marque des autres) : elle ne doit JAMAIS s'afficher sur la foi du repli `?? []`
  // provoqué par une panne de `/api/projects/:id/links`, sous peine de faire mentir Naya sur sa
  // propre doctrine alors qu'on n'a simplement pas réussi à lire les liens déjà déclarés.
  const erreurLiens = liensQuery.isError;
  const aucunLien = !chargement && !erreurLiens && sortants.length === 0 && entrants.length === 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">Liens avec d'autres marques</h2>
        <Dialog
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) setForm(formeVide());
          }}
        >
          <DialogTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={autresMarques.length === 0}
              data-testid="lien-declarer"
            >
              <Plus className="w-3.5 h-3.5" />
              Déclarer un lien
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Déclarer un lien entre deux marques</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 pt-1">
              <div>
                <Label htmlFor="lien-marque">Autre marque</Label>
                <Select
                  value={form.autreProjectId}
                  onValueChange={(v) => setForm((f) => ({ ...f, autreProjectId: v }))}
                >
                  <SelectTrigger id="lien-marque" data-testid="lien-marque">
                    <SelectValue placeholder="Choisir une marque" />
                  </SelectTrigger>
                  <SelectContent>
                    {autresMarques.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="lien-sens">Sens du lien</Label>
                <Select
                  value={form.sens}
                  onValueChange={(v) => setForm((f) => ({ ...f, sens: v as "sortant" | "entrant" }))}
                >
                  <SelectTrigger id="lien-sens" data-testid="lien-sens">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sortant">Cette marque nourrit l'autre</SelectItem>
                    <SelectItem value="entrant">L'autre marque nourrit celle-ci</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="lien-role-amont">Ce que fait la marque qui nourrit</Label>
                <Textarea
                  id="lien-role-amont"
                  value={form.roleAmont}
                  onChange={(e) => setForm((f) => ({ ...f, roleAmont: e.target.value }))}
                  data-testid="lien-role-amont"
                />
              </div>
              <div>
                <Label htmlFor="lien-role-aval">Ce que fait la marque nourrie</Label>
                <Textarea
                  id="lien-role-aval"
                  value={form.roleAval}
                  onChange={(e) => setForm((f) => ({ ...f, roleAval: e.target.value }))}
                  data-testid="lien-role-aval"
                />
              </div>
              <div>
                <Label htmlFor="lien-nature">Pourquoi elles sont liées, et les interdits</Label>
                <Textarea
                  id="lien-nature"
                  value={form.nature}
                  onChange={(e) => setForm((f) => ({ ...f, nature: e.target.value }))}
                  data-testid="lien-nature"
                />
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="lien-recoupement"
                  checked={form.audiencesRecoupent}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, audiencesRecoupent: v === true }))}
                  data-testid="lien-recoupement"
                />
                <Label htmlFor="lien-recoupement" className="font-normal">
                  Les audiences des deux marques se recoupent
                </Label>
              </div>
              <div className="flex justify-end">
                <Button
                  disabled={!form.autreProjectId || ajouter.isPending}
                  onClick={() => ajouter.mutate(form)}
                  data-testid="lien-enregistrer"
                >
                  {ajouter.isPending ? "Enregistrement…" : "Enregistrer"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {chargement ? (
        <Skeleton className="h-20 w-full" />
      ) : erreurLiens ? (
        <Card className="p-4">
          <p className="text-sm text-naya-olive-55">
            Les liens de cette marque n'ont pas pu être chargés pour l'instant.
          </p>
        </Card>
      ) : aucunLien ? (
        <Card className="p-4">
          <p className="text-sm text-naya-olive-55">
            Aucun lien déclaré. Naya traite cette marque comme indépendante des autres.
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {sortants.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Cette marque nourrit</p>
              {sortants.map((lien) => (
                <LienCard
                  key={lien.id}
                  lien={lien}
                  phraseSens={`Cette marque nourrit ${nomAutreMarque(lien.toProjectId)}`}
                  onModifier={(patch) => modifier.mutate({ id: lien.id, patch })}
                  onSupprimer={() => supprimer.mutate(lien.id)}
                  suppressionEnCours={suppressionEnCours.has(lien.id)}
                />
              ))}
            </div>
          )}
          {entrants.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Cette marque est nourrie par</p>
              {entrants.map((lien) => (
                <LienCard
                  key={lien.id}
                  lien={lien}
                  phraseSens={`${nomAutreMarque(lien.fromProjectId)} nourrit cette marque`}
                  onModifier={(patch) => modifier.mutate({ id: lien.id, patch })}
                  onSupprimer={() => supprimer.mutate(lien.id)}
                  suppressionEnCours={suppressionEnCours.has(lien.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LienCard({
  lien,
  phraseSens,
  onModifier,
  onSupprimer,
  suppressionEnCours,
}: {
  lien: ProjectLink;
  phraseSens: string;
  onModifier: (patch: Partial<ChampsLibres> | { audiencesRecoupent: boolean }) => void;
  onSupprimer: () => void;
  suppressionEnCours: boolean;
}) {
  // Brouillon local pour les trois textes libres : ils se valident au blur, comme dans
  // requetes-de-veille.tsx, pour ne pas déclencher une écriture à chaque frappe.
  const [roleAmont, setRoleAmont] = useState(lien.roleAmont ?? "");
  const [roleAval, setRoleAval] = useState(lien.roleAval ?? "");
  const [nature, setNature] = useState(lien.nature ?? "");

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <p className="text-sm font-medium text-foreground">{phraseSens}</p>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="ghost" data-testid={`lien-supprimer-${lien.id}`}>
              Supprimer
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Supprimer ce lien ?</AlertDialogTitle>
              <AlertDialogDescription>
                Cette déclaration disparaît. Aucune campagne déjà décidée avec cette marque n'est modifiée.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Annuler</AlertDialogCancel>
              <AlertDialogAction
                onClick={onSupprimer}
                disabled={suppressionEnCours}
                data-testid={`lien-supprimer-confirmer-${lien.id}`}
              >
                Supprimer
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <div className="space-y-2">
        <div>
          <Label htmlFor={`lien-${lien.id}-role-amont`} className="text-xs text-muted-foreground">
            Ce que fait la marque qui nourrit
          </Label>
          <Textarea
            id={`lien-${lien.id}-role-amont`}
            value={roleAmont}
            onChange={(e) => setRoleAmont(e.target.value)}
            onBlur={() => {
              const v = roleAmont.trim();
              if (v !== (lien.roleAmont ?? "")) onModifier({ roleAmont: v || null });
            }}
            data-testid={`lien-${lien.id}-role-amont`}
          />
        </div>
        <div>
          <Label htmlFor={`lien-${lien.id}-role-aval`} className="text-xs text-muted-foreground">
            Ce que fait la marque nourrie
          </Label>
          <Textarea
            id={`lien-${lien.id}-role-aval`}
            value={roleAval}
            onChange={(e) => setRoleAval(e.target.value)}
            onBlur={() => {
              const v = roleAval.trim();
              if (v !== (lien.roleAval ?? "")) onModifier({ roleAval: v || null });
            }}
            data-testid={`lien-${lien.id}-role-aval`}
          />
        </div>
        <div>
          <Label htmlFor={`lien-${lien.id}-nature`} className="text-xs text-muted-foreground">
            Pourquoi elles sont liées, et les interdits
          </Label>
          <Textarea
            id={`lien-${lien.id}-nature`}
            value={nature}
            onChange={(e) => setNature(e.target.value)}
            onBlur={() => {
              const v = nature.trim();
              if (v !== (lien.nature ?? "")) onModifier({ nature: v || null });
            }}
            data-testid={`lien-${lien.id}-nature`}
          />
        </div>
        <div className="flex items-center gap-2 pt-1">
          <Checkbox
            checked={lien.audiencesRecoupent}
            onCheckedChange={(v) => onModifier({ audiencesRecoupent: v === true })}
            data-testid={`lien-${lien.id}-recoupement`}
          />
          <Label className="text-xs text-muted-foreground font-normal">
            Les audiences des deux marques se recoupent
          </Label>
        </div>
      </div>
    </Card>
  );
}
