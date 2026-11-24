// Autolistes du calendrier (lot 6, inspiré de Metricool) : une file de posts publiée seule à
// des créneaux récurrents. Création et édition (nom, marque, comptes du périmètre, créneaux,
// boucle, activation), file ordonnée (monter, descendre, retirer, remettre), prochains passages
// des 7 jours et ce qui bloque. « Ajouter à une autoliste » depuis un post ou un modèle.
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ChevronLeft, Loader2, Plus, Repeat, RotateCcw, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { apercuPassages, NOM_AUTOLISTE_MAX, type Creneau, type Materialisation } from "@shared/autolistes";
import type { ContenuModele } from "@shared/bibliotheque";

interface ProjetMin { id: number; name: string }
interface AutolisteClient {
  id: number; nom: string; projectId: number | null; actif: boolean; enBoucle: boolean; creneaux: Creneau[]; comptes: number[];
  fuseau: string; problemes: Array<{ creneau: string; postId: number | null; compteId: number | null; raisons: string[] }>; nbPosts?: number;
}
interface PostClient { id: number; ordre: number; actif: boolean; contenu: ContenuModele; publieFois: number; dernierPassageAt: string | null }
interface CompteClient { id: number; platform: string; accountName: string | null; isActive: boolean }

const CLE_LISTES = ["/api/autolistes"];
const SANS = "aucun";
const JOURS_AFFICHES = [1, 2, 3, 4, 5, 6, 0];
const versProjet = (v: string) => (v === SANS ? null : Number(v));

const json = async (r: Response) => r.json();
/** Le code d'erreur renvoyé par la route (« 400: {"message":"compte_hors_perimetre"} »). */
const codeErreur = (e: unknown): string | null => /"message":"([a-z_]+)"/.exec(String((e as any)?.message ?? ""))?.[1] ?? null;

function useListes() {
  return useQuery<AutolisteClient[]>({ queryKey: CLE_LISTES, queryFn: async () => json(await apiRequest("GET", "/api/autolistes")) });
}

function useComptes(projectId: number | null) {
  return useQuery<CompteClient[]>({
    queryKey: ["/api/autolistes/comptes", projectId],
    queryFn: async () => json(await apiRequest("GET", `/api/autolistes/comptes${projectId != null ? `?projectId=${projectId}` : ""}`)),
  });
}

function apercuTexte(c: ContenuModele | null | undefined): string {
  const textes = c?.textes ?? {};
  return String(textes[String(c?.platform ?? "")] ?? Object.values(textes)[0] ?? "");
}

function useDate() {
  const { i18n } = useTranslation();
  return (d: Date | string) => new Date(d).toLocaleString(i18n.language, {
    weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris",
  });
}

function useErreur() {
  const { t } = useTranslation();
  const { toast } = useToast();
  return (e: unknown) => {
    const code = codeErreur(e);
    toast({ title: code ? t(`autolistes.erreurs.${code}`, { defaultValue: t("autolistes.erreur") }) : t("autolistes.erreur"), variant: "destructive" });
  };
}

// ── Éditeur des créneaux ─────────────────────────────────────────────────────────────────
function EditeurCreneaux({ creneaux, onChange }: { creneaux: Creneau[]; onChange: (c: Creneau[]) => void }) {
  const { t } = useTranslation();
  const maj = (i: number, c: Creneau) => onChange(creneaux.map((x, j) => (j === i ? c : x)));
  return (
    <div className="space-y-2">
      {creneaux.map((c, i) => (
        <div key={i} className="flex flex-wrap items-center gap-1.5" data-testid={`creneau-${i}`}>
          <Input type="time" value={c.heure} onChange={(e) => maj(i, { ...c, heure: e.target.value })} className="h-8 w-28 text-sm" aria-label={t("autolistes.heure")} />
          {JOURS_AFFICHES.map((j) => {
            const pris = c.jours.includes(j);
            return (
              <Button key={j} type="button" size="sm" variant={pris ? "default" : "outline"} className="h-8 px-2 text-xs"
                aria-pressed={pris}
                onClick={() => maj(i, { ...c, jours: pris ? c.jours.filter((x) => x !== j) : [...c.jours, j].sort((a, b) => a - b) })}>
                {t(`autolistes.jours.${j}`)}
              </Button>
            );
          })}
          <Button type="button" size="sm" variant="ghost" className="h-8" aria-label={t("autolistes.retirerCreneau")} title={t("autolistes.retirerCreneau")}
            onClick={() => onChange(creneaux.filter((_, j) => j !== i))}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" onClick={() => onChange([...creneaux, { heure: "09:00", jours: [1, 2, 3, 4, 5] }])}>
        <Plus className="h-3.5 w-3.5 mr-1" />{t("autolistes.ajouterCreneau")}
      </Button>
    </div>
  );
}

type Formulaire = { nom: string; marque: string; comptes: number[]; creneaux: Creneau[]; enBoucle: boolean; actif: boolean };

// ── Formulaire de la liste ───────────────────────────────────────────────────────────────
function FormulaireListe({ liste, projets, projetCourantId, onEnregistre }: {
  liste: AutolisteClient | null; projets: ProjetMin[]; projetCourantId: number | null; onEnregistre: (id: number) => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const erreur = useErreur();
  const qc = useQueryClient();
  const initial = (): Formulaire => ({
    nom: liste?.nom ?? "", marque: String(liste ? liste.projectId ?? SANS : projetCourantId ?? SANS),
    comptes: liste?.comptes ?? [], creneaux: liste?.creneaux ?? [{ heure: "09:00", jours: [1, 3, 5] }],
    enBoucle: liste?.enBoucle ?? true, actif: liste?.actif ?? true,
  });
  const [f, setF] = useState<Formulaire>(initial);
  useEffect(() => { setF(initial()); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [liste?.id]);
  const { data: comptes = [], isLoading } = useComptes(versProjet(f.marque));

  const enregistrer = useMutation({
    mutationFn: async () => {
      const corps = {
        nom: f.nom, projectId: versProjet(f.marque), enBoucle: f.enBoucle, actif: f.actif,
        creneaux: f.creneaux.filter((c) => c.jours.length > 0), comptes: f.comptes.filter((id) => comptes.some((c) => c.id === id)),
      };
      return json(await (liste ? apiRequest("PATCH", `/api/autolistes/${liste.id}`, corps) : apiRequest("POST", "/api/autolistes", corps)));
    },
    onSuccess: (l: AutolisteClient) => {
      qc.invalidateQueries({ queryKey: CLE_LISTES });
      qc.invalidateQueries({ queryKey: ["/api/content"] });
      toast({ title: t("autolistes.enregistreToast") });
      onEnregistre(l.id);
    },
    onError: erreur,
  });

  return (
    <div className="space-y-3 rounded border border-naya-olive-18 p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="space-y-1 text-xs text-naya-olive-55">
          <span>{t("autolistes.nom")}</span>
          <Input value={f.nom} maxLength={NOM_AUTOLISTE_MAX} onChange={(e) => setF({ ...f, nom: e.target.value })}
            placeholder={t("autolistes.nomPlaceholder")} className="h-8 text-sm" data-testid="autoliste-nom" />
        </label>
        <div className="space-y-1 text-xs text-naya-olive-55">
          <span>{t("autolistes.marque")}</span>
          <Select value={f.marque} onValueChange={(v) => setF({ ...f, marque: v, comptes: [] })}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={SANS}>{t("autolistes.sansMarque")}</SelectItem>
              {projets.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1">
        <p className="text-xs text-naya-olive-55">{t("autolistes.comptes")}</p>
        {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : comptes.length === 0 ? (
          <p className="text-xs text-naya-olive-35">{t("autolistes.aucunCompte")}</p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {comptes.map((c) => (
              <label key={c.id} className="flex items-center gap-1.5 text-sm">
                <Checkbox checked={f.comptes.includes(c.id)}
                  onCheckedChange={(v) => setF({ ...f, comptes: v ? [...f.comptes, c.id] : f.comptes.filter((x) => x !== c.id) })} />
                <span>{t(`bibliotheque.reseaux.${c.platform}`, { defaultValue: c.platform })}</span>
                {c.accountName && <span className="text-naya-olive-35">{c.accountName}</span>}
              </label>
            ))}
          </div>
        )}
      </div>
      <div className="space-y-1">
        <p className="text-xs text-naya-olive-55">{t("autolistes.creneaux")}</p>
        <EditeurCreneaux creneaux={f.creneaux} onChange={(creneaux) => setF({ ...f, creneaux })} />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex items-start gap-2 text-sm">
          <Switch checked={f.enBoucle} onCheckedChange={(v) => setF({ ...f, enBoucle: v })} />
          <span>{t("autolistes.enBoucle")}<span className="block text-xs text-naya-olive-55">{t("autolistes.enBoucleAide")}</span></span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <Switch checked={f.actif} onCheckedChange={(v) => setF({ ...f, actif: v })} />
          <span>{t("autolistes.actif")}<span className="block text-xs text-naya-olive-55">{t("autolistes.actifAide")}</span></span>
        </label>
      </div>
      <div className="flex justify-end">
        <Button size="sm" type="button" disabled={!f.nom.trim() || enregistrer.isPending} onClick={() => enregistrer.mutate()} data-testid="autoliste-enregistrer">
          {enregistrer.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
          {liste ? t("autolistes.enregistrer") : t("autolistes.creer")}
        </Button>
      </div>
    </div>
  );
}

// ── Détail d'une liste : formulaire, file, passages, blocages ────────────────────────────
function DetailListe({ id, projets, projetCourantId, onSupprimee }: { id: number; projets: ProjetMin[]; projetCourantId: number | null; onSupprimee: () => void }) {
  const { t } = useTranslation();
  const erreur = useErreur();
  const date = useDate();
  const qc = useQueryClient();
  const cle = ["/api/autolistes", id];
  const { data, isLoading } = useQuery<{ autoliste: AutolisteClient; posts: PostClient[]; materialisations: Materialisation[] }>({
    queryKey: cle, queryFn: async () => json(await apiRequest("GET", `/api/autolistes/${id}`)),
  });
  const liste = data?.autoliste ?? null;
  const { data: comptes = [] } = useComptes(liste?.projectId ?? null);
  const rafraichir = () => {
    qc.invalidateQueries({ queryKey: cle });
    qc.invalidateQueries({ queryKey: CLE_LISTES });
    qc.invalidateQueries({ queryKey: ["/api/content"] });
  };
  const action = useMutation({
    mutationFn: async (a: { methode: string; url: string; corps?: unknown }) => json(await apiRequest(a.methode, a.url, a.corps)),
    onSuccess: rafraichir,
    onError: erreur,
  });
  const supprimer = useMutation({
    mutationFn: async () => json(await apiRequest("DELETE", `/api/autolistes/${id}`)),
    onSuccess: () => { rafraichir(); onSupprimee(); },
    onError: erreur,
  });

  const posts = data?.posts ?? [];
  const passages = useMemo(() => (liste ? apercuPassages({
    creneaux: liste.creneaux ?? [], fuseau: liste.fuseau, enBoucle: liste.enBoucle, actif: liste.actif,
    posts, materialisations: data?.materialisations ?? [], maintenant: new Date(),
  }) : []), [liste, posts, data?.materialisations]);
  const parId = new Map(posts.map((p) => [p.id, p]));
  const nomCompte = (cid: number | null) => {
    const c = comptes.find((x) => x.id === cid);
    return c ? `${t(`bibliotheque.reseaux.${c.platform}`, { defaultValue: c.platform })}${c.accountName ? ` ${c.accountName}` : ""}` : "—";
  };

  if (isLoading || !liste) return <Loader2 className="h-5 w-5 animate-spin mx-auto" />;

  const deplacer = (i: number, sens: -1 | 1) => {
    const ids = posts.map((p) => p.id);
    const j = i + sens;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    action.mutate({ methode: "PUT", url: `/api/autolistes/${id}/ordre`, corps: { ids } });
  };

  return (
    <div className="space-y-4">
      <FormulaireListe liste={liste} projets={projets} projetCourantId={projetCourantId} onEnregistre={() => rafraichir()} />

      {liste.problemes?.length > 0 && (
        <div className="rounded bg-naya-olive-06 p-2 space-y-1" data-testid="autoliste-problemes">
          <p className="text-xs font-medium text-foreground">{t("autolistes.problemes")}</p>
          {liste.problemes.map((p, i) => (
            <p key={i} className="text-xs text-naya-olive-55">
              {t("autolistes.problemeLigne", {
                date: date(p.creneau), compte: p.compteId == null ? "—" : nomCompte(p.compteId),
                raisons: p.raisons.map((r) => t(`autolistes.raisons.${r}`, { defaultValue: r })).join(", "),
              })}
            </p>
          ))}
        </div>
      )}

      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{t("autolistes.file")}</p>
        <p className="text-xs text-naya-olive-55">{t("autolistes.fileAide")}</p>
        {posts.length === 0 ? <p className="text-sm text-naya-olive-35 py-3 text-center">{t("autolistes.fileVide")}</p> : (
          <ol className="divide-y divide-naya-olive-18">
            {posts.map((p, i) => (
              <li key={p.id} className={`py-1.5 flex items-start gap-2 ${p.actif ? "" : "opacity-60"}`} data-testid={`autoliste-post-${p.id}`}>
                <span className="text-xs text-naya-olive-35 w-6 pt-0.5">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground line-clamp-2 whitespace-pre-line">{apercuTexte(p.contenu) || t("autolistes.sansTexte")}</p>
                  <p className="text-xs text-naya-olive-35">
                    {p.publieFois > 0 && t("autolistes.publieFois", { count: p.publieFois })}
                    {!p.actif && ` · ${t("autolistes.consomme")}`}
                  </p>
                </div>
                <Button size="sm" variant="ghost" type="button" className="h-7 px-1.5" disabled={i === 0 || action.isPending}
                  aria-label={t("autolistes.monter")} title={t("autolistes.monter")} onClick={() => deplacer(i, -1)}>
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="ghost" type="button" className="h-7 px-1.5" disabled={i === posts.length - 1 || action.isPending}
                  aria-label={t("autolistes.descendre")} title={t("autolistes.descendre")} onClick={() => deplacer(i, 1)}>
                  <ArrowDown className="h-3.5 w-3.5" />
                </Button>
                {!p.actif && (
                  <Button size="sm" variant="ghost" type="button" className="h-7 px-1.5" disabled={action.isPending}
                    aria-label={t("autolistes.remettre")} title={t("autolistes.remettre")}
                    onClick={() => action.mutate({ methode: "PATCH", url: `/api/autolistes/${id}/posts/${p.id}`, corps: { actif: true } })}>
                    <RotateCcw className="h-3.5 w-3.5" />
                  </Button>
                )}
                <Button size="sm" variant="ghost" type="button" className="h-7 px-1.5" disabled={action.isPending}
                  aria-label={t("autolistes.retirer")} title={t("autolistes.retirer")}
                  onClick={() => { if (window.confirm(t("autolistes.confirmerRetrait"))) action.mutate({ methode: "DELETE", url: `/api/autolistes/${id}/posts/${p.id}` }); }}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{t("autolistes.passages")}</p>
        {passages.length === 0 ? <p className="text-xs text-naya-olive-35">{t("autolistes.passagesAucun")}</p> : (
          <ul className="space-y-0.5" data-testid="autoliste-passages">
            {passages.map((x) => {
              const post = x.postId != null ? parId.get(x.postId) : undefined;
              return (
                <li key={x.instant.toISOString()} className="text-xs flex gap-2">
                  <span className="w-36 shrink-0 text-naya-olive-55">{date(x.instant)}</span>
                  <span className="flex-1 min-w-0 truncate text-foreground">{post ? apercuTexte(post.contenu) || t("autolistes.sansTexte") : t("autolistes.passageVide")}</span>
                  <span className="shrink-0 text-naya-olive-35">{x.pose ? t("autolistes.passagePose") : t("autolistes.passagePrevu")}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex justify-end">
        <Button size="sm" variant="outline" type="button" disabled={supprimer.isPending}
          onClick={() => { if (window.confirm(t("autolistes.confirmerSuppression"))) supprimer.mutate(); }}>
          <Trash2 className="h-3.5 w-3.5 mr-1" />{t("autolistes.supprimer")}
        </Button>
      </div>
    </div>
  );
}

/** `marquesFiltre` (groupe de marques, lot 9) : seules les listes de ces marques ; null = toutes. */
export default function Autolistes({ projets, projetCourantId, marquesFiltre = null }: { projets: ProjetMin[]; projetCourantId: number | null; marquesFiltre?: number[] | null }) {
  const { t } = useTranslation();
  const { data: toutes = [], isLoading } = useListes();
  const listes = marquesFiltre ? toutes.filter((l) => l.projectId != null && marquesFiltre.includes(l.projectId)) : toutes;
  const [vue, setVue] = useState<number | "nouvelle" | null>(null);
  const nomMarque = (id: number | null) => (id == null ? t("autolistes.sansMarque") : projets.find((p) => p.id === id)?.name ?? `#${id}`);

  return (
    <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{t("autolistes.titre")}</DialogTitle>
      </DialogHeader>
      {vue == null ? (
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="space-y-1">
              <p className="text-xs text-naya-olive-55">{t("autolistes.aide")}</p>
              {marquesFiltre && <p className="text-[11px] text-naya-olive-55">{t("groupesMarques.autolistesDuGroupe")}</p>}
            </div>
            <Button size="sm" variant="outline" type="button" onClick={() => setVue("nouvelle")} data-testid="autoliste-nouvelle">
              <Plus className="h-3.5 w-3.5 mr-1" />{t("autolistes.nouvelle")}
            </Button>
          </div>
          {isLoading ? <Loader2 className="h-5 w-5 animate-spin mx-auto" /> : listes.length === 0 ? (
            <p className="text-sm text-naya-olive-35 py-6 text-center">{t("autolistes.aucune")}</p>
          ) : (
            <ul className="divide-y divide-naya-olive-18">
              {listes.map((l) => (
                <li key={l.id}>
                  <button type="button" className="w-full text-left py-2 flex items-start gap-2" onClick={() => setVue(l.id)} data-testid={`autoliste-${l.id}`}>
                    <Repeat className={`h-4 w-4 mt-0.5 ${l.actif ? "text-foreground" : "text-naya-olive-35"}`} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm text-foreground truncate">{l.nom}</span>
                      <span className="block text-xs text-naya-olive-35">
                        {nomMarque(l.projectId)} · {t("autolistes.resume", {
                          count: l.nbPosts ?? 0, creneaux: (l.creneaux ?? []).length,
                          etat: `${l.actif ? t("autolistes.etatActive") : t("autolistes.etatInactive")}${l.enBoucle ? `, ${t("autolistes.boucle")}` : ""}`,
                        })}
                      </span>
                      {l.problemes?.length > 0 && (
                        <span className="block text-xs text-naya-olive-55">
                          {t("autolistes.problemes")} : {Array.from(new Set(l.problemes.flatMap((p) => p.raisons))).map((r) => t(`autolistes.raisons.${r}`, { defaultValue: r })).join(", ")}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <Button size="sm" variant="ghost" type="button" onClick={() => setVue(null)}>
            <ChevronLeft className="h-3.5 w-3.5 mr-1" />{t("autolistes.retour")}
          </Button>
          {vue === "nouvelle" ? (
            <FormulaireListe liste={null} projets={projets} projetCourantId={projetCourantId} onEnregistre={(id) => setVue(id)} />
          ) : (
            <DetailListe id={vue} projets={projets} projetCourantId={projetCourantId} onSupprimee={() => setVue(null)} />
          )}
        </div>
      )}
    </DialogContent>
  );
}

/** « Ajouter à une autoliste » : depuis un post du calendrier ou un modèle de la bibliothèque. */
export function AjouterAAutoliste({ source, onFini }: { source: { contentId: number } | { modeleId: number }; onFini?: () => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const erreur = useErreur();
  const qc = useQueryClient();
  const { data: listes = [], isLoading } = useListes();
  const [choix, setChoix] = useState("");
  const ajouter = useMutation({
    mutationFn: async () => json(await apiRequest("POST", `/api/autolistes/${Number(choix)}/posts`, source)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CLE_LISTES });
      qc.invalidateQueries({ queryKey: ["/api/autolistes", Number(choix)] });
      qc.invalidateQueries({ queryKey: ["/api/content"] });
      toast({ title: t("autolistes.ajouter.toast") });
      onFini?.();
    },
    onError: erreur,
  });
  if (isLoading) return <Loader2 className="h-4 w-4 animate-spin" />;
  if (listes.length === 0) return <p className="text-xs text-naya-olive-35">{t("autolistes.ajouter.aucune")}</p>;
  return (
    <div className="space-y-2" data-testid="ajouter-autoliste">
      <p className="text-xs text-naya-olive-55">{t("autolistes.ajouter.aide")}</p>
      <div className="flex gap-2">
        <Select value={choix} onValueChange={setChoix}>
          <SelectTrigger className="h-8 text-sm"><SelectValue placeholder={t("autolistes.ajouter.choisir")} /></SelectTrigger>
          <SelectContent>
            {listes.map((l) => <SelectItem key={l.id} value={String(l.id)}>{l.nom}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button size="sm" type="button" disabled={!choix || ajouter.isPending} onClick={() => ajouter.mutate()}>
          {ajouter.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Repeat className="h-3.5 w-3.5 mr-1" />}
          {t("autolistes.ajouter.valider")}
        </Button>
      </div>
    </div>
  );
}
