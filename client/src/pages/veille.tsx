// Page « Veille » d'un projet (dossier Acquisition 360, étape 1) : ce que Naya surveille
// (liste proposée par Naya, validée ici), les quatre routines hebdomadaires, ce qu'elles ont
// relevé, et les tableaux « réponses des IA » et « positions Google ».
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Radar, Sparkles, Loader2, Check, X, Plus, ExternalLink, Eye, Pencil } from "lucide-react";
import Sidebar from "@/components/sidebar";
import { useProject } from "@/lib/project-context";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import RoutineCard, { type RoutineDTO } from "@/components/routines/RoutineCard";

type Item = { id: number; type: TypeItem; libelle: string; valeur: { site?: string; instagram?: string; variantes?: string[] } | null; statut: "propose" | "suivi" | "ecarte"; source: string };
type Constat = { id: number; kind: string; type: string; titre: string; texte: string; preuve: { url?: string; extrait?: string; source?: string } | null; statut: string; createdAt: string };
type DonneesVeille = {
  items: Item[];
  constats: Constat[];
  routines: Record<Kind, RoutineDTO | null>;
  tableaux: {
    geo: Array<{ itemId: number; moteur: string; citee: boolean; position: number | null; concurrentsCites: string[] }>;
    serp: Array<{ itemId: number; position: number | null }>;
  };
  fournisseurs: { recherche: boolean; ia: string[] };
};
type TypeItem = "marque" | "concurrent" | "requete_voc" | "mot_cle" | "prompt_geo";
type Kind = "veille_concurrents" | "veille_voix_client" | "veille_serp" | "veille_geo";

const TYPES: TypeItem[] = ["marque", "concurrent", "requete_voc", "mot_cle", "prompt_geo"];
const KINDS: Kind[] = ["veille_concurrents", "veille_voix_client", "veille_serp", "veille_geo"];
const AVEC_SITE: TypeItem[] = ["marque", "concurrent"];

/** « 409: {"message":"plafond"} » → { message: "plafond" }. */
function corpsErreur(e: unknown): { message?: string; raison?: string } {
  const m = e instanceof Error ? e.message : String(e ?? "");
  try { return JSON.parse(m.replace(/^\d{3}:\s*/, "")); } catch { return {}; }
}

interface VeilleProps { onSearchClick?: () => void }

export default function Veille({ onSearchClick }: VeilleProps) {
  const { t } = useTranslation();
  const { activeProjectId } = useProject();

  return (
    <div className="flex h-screen bg-background">
      <Sidebar onSearchClick={onSearchClick} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-card border-b border-border px-6 py-4 flex-shrink-0">
          <h1 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Radar className="h-5 w-5 text-naya-salvia" />
            {t("veille.titre")}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5 max-w-3xl">{t("veille.description")}</p>
        </header>
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          {activeProjectId == null
            ? <p className="max-w-3xl mx-auto text-sm text-muted-foreground">{t("veille.choisirProjet")}</p>
            : <VeilleProjet projectId={activeProjectId} />}
        </main>
      </div>
    </div>
  );
}

function VeilleProjet({ projectId }: { projectId: number }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const cle = `/api/veille/${projectId}`;
  const { data, isLoading } = useQuery<DonneesVeille>({ queryKey: [cle] });
  const rafraichir = () => queryClient.invalidateQueries({ queryKey: [cle] });

  const proposer = useMutation({
    mutationFn: () => apiRequest("POST", `${cle}/proposer`, undefined, { timeoutMs: 120_000 }).then((r) => r.json()),
    onSuccess: (r: { crees: unknown[] }) => {
      rafraichir();
      toast({ title: r.crees.length ? t("veille.proposition.ok", { n: r.crees.length }) : t("veille.proposition.rien") });
    },
    onError: (e) => {
      const c = corpsErreur(e);
      toast({ title: t("veille.proposition.erreur"), description: c.raison, variant: "destructive" });
    },
  });

  if (isLoading || !data) {
    return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }
  const visibles = data.items.filter((i) => i.statut !== "ecarte");

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <section className="space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground">{t("veille.liste.titre")}</h2>
            <p className="text-xs text-muted-foreground mt-0.5 max-w-2xl">{t("veille.liste.intro")}</p>
          </div>
          <Button size="sm" className="gap-1.5" disabled={proposer.isPending} onClick={() => proposer.mutate()}>
            {proposer.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {t("veille.proposition.bouton")}
          </Button>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {TYPES.map((type) => (
            <GroupeItems key={type} type={type} projectId={projectId} items={visibles.filter((i) => i.type === type)} onChange={rafraichir} />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-foreground">{t("veille.routines.titre")}</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {KINDS.map((kind) => (
            <RoutineCard
              key={kind}
              id={`veille-${kind}`}
              donnees={data.routines[kind]}
              url={`${cle}/routines/${kind}`}
              onChange={rafraichir}
              textes={{
                titre: t(`veille.routines.${kind}.titre`), intro: t(`veille.routines.${kind}.intro`),
                lance: t("veille.routines.lance"), erreur: t("veille.routines.erreur"),
              }}
              avertissement={<Avertissement kind={kind} fournisseurs={data.fournisseurs} />}
            />
          ))}
        </div>
      </section>

      <Constats constats={data.constats} onChange={rafraichir} />

      <Tableaux items={data.items} tableaux={data.tableaux} />
    </div>
  );
}

function Avertissement({ kind, fournisseurs }: { kind: Kind; fournisseurs: DonneesVeille["fournisseurs"] }) {
  const { t } = useTranslation();
  if (kind === "veille_geo") {
    return (
      <p className="text-[11px] text-muted-foreground">
        {fournisseurs.ia.length ? t("veille.routines.coutGeo") : t("veille.routines.sansIa")}
      </p>
    );
  }
  if (!fournisseurs.recherche) return <p className="text-[11px] text-naya-mauve">{t("veille.routines.sansRecherche")}</p>;
  return null;
}

function GroupeItems({ type, projectId, items, onChange }: { type: TypeItem; projectId: number; items: Item[]; onChange: () => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [libelle, setLibelle] = useState("");
  const [site, setSite] = useState("");
  const [instagram, setInstagram] = useState("");

  const erreur = (e: unknown) => {
    const m = corpsErreur(e).message;
    const cle = m === "plafond" || m === "deja_present" ? `veille.erreurs.${m}` : "veille.erreurs.generique";
    toast({ title: t(cle), variant: "destructive" });
  };
  const ajouter = useMutation({
    mutationFn: () => apiRequest("POST", `/api/veille/${projectId}/items`, {
      type, libelle, valeur: { ...(site.trim() ? { site: site.trim() } : {}), ...(instagram.trim() ? { instagram: instagram.trim() } : {}) },
    }),
    onSuccess: () => { setLibelle(""); setSite(""); setInstagram(""); onChange(); },
    onError: erreur,
  });
  const statut = useMutation({
    mutationFn: ({ id, s }: { id: number; s: Item["statut"] }) => apiRequest("PATCH", `/api/veille/items/${id}`, { statut: s }),
    onSuccess: onChange,
    onError: erreur,
  });

  return (
    <Card className="p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{t(`veille.types.${type}.titre`)}</h3>
        <p className="text-xs text-muted-foreground mt-0.5">{t(`veille.types.${type}.aide`)}</p>
      </div>
      {items.length === 0 && <p className="text-xs text-muted-foreground italic">{t("veille.liste.vide")}</p>}
      <ul className="space-y-1.5">
        {items.map((i) => (
          <LigneItem key={i.id} item={i} type={type} enCours={statut.isPending}
            onStatut={(st) => statut.mutate({ id: i.id, s: st })} onChange={onChange} onErreur={erreur} />
        ))}
      </ul>
      <form className="flex flex-col gap-1.5" onSubmit={(e) => { e.preventDefault(); if (libelle.trim()) ajouter.mutate(); }}>
        <div className="flex gap-1.5">
          <Input value={libelle} onChange={(e) => setLibelle(e.target.value)} className="h-8 text-xs" placeholder={t(`veille.types.${type}.exemple`)} />
          <Button type="submit" size="sm" variant="outline" className="h-8 px-2" disabled={!libelle.trim() || ajouter.isPending} aria-label={t("veille.liste.ajouter")}>
            <Plus className="w-3.5 h-3.5" />
          </Button>
        </div>
        {AVEC_SITE.includes(type) && libelle.trim() && (
          <div className="flex gap-1.5">
            <Input value={site} onChange={(e) => setSite(e.target.value)} className="h-8 text-xs" placeholder={t("veille.liste.site")} />
            {type === "concurrent" && (
              <Input value={instagram} onChange={(e) => setInstagram(e.target.value)} className="h-8 text-xs" placeholder={t("veille.liste.instagram")} />
            )}
          </div>
        )}
      </form>
    </Card>
  );
}

function LigneItem({ item: i, type, enCours, onStatut, onChange, onErreur }: {
  item: Item; type: TypeItem; enCours: boolean;
  onStatut: (s: Item["statut"]) => void; onChange: () => void; onErreur: (e: unknown) => void;
}) {
  const { t } = useTranslation();
  const [edition, setEdition] = useState(false);
  const [site, setSite] = useState(i.valeur?.site ?? "");
  const [instagram, setInstagram] = useState(i.valeur?.instagram ?? "");
  const [variantes, setVariantes] = useState((i.valeur?.variantes ?? []).join(", "));
  const enregistrer = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/veille/items/${i.id}`, {
      valeur: {
        ...(site.trim() ? { site: site.trim() } : {}),
        ...(instagram.trim() ? { instagram: instagram.trim() } : {}),
        variantes: variantes.split(",").map((v) => v.trim()).filter(Boolean),
      },
    }),
    onSuccess: () => { setEdition(false); onChange(); },
    onError: onErreur,
  });
  const editable = AVEC_SITE.includes(type);

  return (
    <li className="text-sm space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className={i.statut === "suivi" ? "text-foreground" : "text-muted-foreground"}>{i.libelle}</span>
          {(i.valeur?.site || i.valeur?.instagram) && (
            <span className="block text-[11px] text-muted-foreground truncate">
              {[i.valeur?.site, i.valeur?.instagram].filter(Boolean).join(" · ")}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {i.statut === "propose" ? (
            <>
              <Badge variant="outline" className="text-[10px]">{t("veille.liste.propose")}</Badge>
              <Button size="sm" variant="ghost" className="h-7 px-2 gap-1 text-xs" disabled={enCours} onClick={() => onStatut("suivi")}>
                <Check className="w-3.5 h-3.5" />{t("veille.liste.suivre")}
              </Button>
            </>
          ) : (
            <Badge variant="secondary" className="text-[10px]">{t("veille.liste.suivi")}</Badge>
          )}
          {editable && (
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" aria-label={t("veille.liste.modifier")} title={t("veille.liste.modifier")}
              onClick={() => setEdition((x) => !x)}>
              <Pencil className="w-3.5 h-3.5" />
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" aria-label={t("veille.liste.ecarter")} title={t("veille.liste.ecarter")}
            disabled={enCours} onClick={() => onStatut("ecarte")}>
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
      {edition && (
        <form className="flex flex-col gap-1.5" onSubmit={(e) => { e.preventDefault(); enregistrer.mutate(); }}>
          <Input value={site} onChange={(e) => setSite(e.target.value)} className="h-8 text-xs" placeholder={t("veille.liste.site")} />
          {type === "concurrent" && (
            <Input value={instagram} onChange={(e) => setInstagram(e.target.value)} className="h-8 text-xs" placeholder={t("veille.liste.instagram")} />
          )}
          <Input value={variantes} onChange={(e) => setVariantes(e.target.value)} className="h-8 text-xs" placeholder={t("veille.liste.variantes")} />
          <div className="flex justify-end">
            <Button type="submit" size="sm" className="h-7 text-xs" disabled={enregistrer.isPending}>{t("veille.liste.enregistrer")}</Button>
          </div>
        </form>
      )}
    </li>
  );
}

function Constats({ constats, onChange }: { constats: Constat[]; onChange: () => void }) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const statut = useMutation({
    mutationFn: ({ id, s }: { id: number; s: "vu" | "ecarte" }) => apiRequest("PATCH", `/api/veille/constats/${id}`, { statut: s }),
    onSuccess: onChange,
    onError: () => toast({ title: t("veille.erreurs.generique"), variant: "destructive" }),
  });
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-semibold text-foreground">{t("veille.constats.titre")}</h2>
        <p className="text-xs text-muted-foreground mt-0.5 max-w-2xl">{t("veille.constats.intro")}</p>
      </div>
      {constats.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("veille.constats.vide")}</p>
      ) : (
        <div className="space-y-2">
          {constats.map((c) => (
            <Card key={c.id} className={`p-3 space-y-1 ${c.statut === "nouveau" ? "" : "opacity-80"}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="text-[10px]">{t(`veille.constats.types.${c.type}`, { defaultValue: c.type })}</Badge>
                    <span className="text-sm font-medium text-foreground">{c.titre}</span>
                    <span className="text-[11px] text-muted-foreground">{new Date(c.createdAt).toLocaleDateString(i18n.language)}</span>
                  </div>
                  <p className="text-sm text-foreground/90 mt-1">{c.texte}</p>
                  {c.preuve?.extrait && <p className="text-xs text-muted-foreground italic mt-1">« {c.preuve.extrait} »</p>}
                  {c.preuve?.url && (
                    <a href={c.preuve.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-naya-salvia hover:underline mt-1 break-all">
                      <ExternalLink className="w-3 h-3 shrink-0" />{c.preuve.source || c.preuve.url}
                    </a>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {c.statut === "nouveau" && (
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" aria-label={t("veille.constats.vu")} title={t("veille.constats.vu")}
                      disabled={statut.isPending} onClick={() => statut.mutate({ id: c.id, s: "vu" })}>
                      <Eye className="w-3.5 h-3.5" />
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" aria-label={t("veille.constats.ecarter")} title={t("veille.constats.ecarter")}
                    disabled={statut.isPending} onClick={() => statut.mutate({ id: c.id, s: "ecarte" })}>
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}

function Tableaux({ items, tableaux }: { items: Item[]; tableaux: DonneesVeille["tableaux"] }) {
  const { t } = useTranslation();
  const prompts = items.filter((i) => i.type === "prompt_geo" && i.statut === "suivi");
  const motsCles = items.filter((i) => i.type === "mot_cle" && i.statut === "suivi");
  const moteurs = Array.from(new Set(tableaux.geo.map((g) => g.moteur)));
  if ((prompts.length === 0 || tableaux.geo.length === 0) && (motsCles.length === 0 || tableaux.serp.length === 0)) return null;

  return (
    <section className="space-y-6">
      {prompts.length > 0 && tableaux.geo.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-base font-semibold text-foreground">{t("veille.tableaux.geo")}</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1.5 pr-3 font-medium">{t("veille.tableaux.question")}</th>
                  {moteurs.map((m) => <th key={m} className="py-1.5 pr-3 font-medium">{t(`veille.moteurs.${m}`, { defaultValue: m })}</th>)}
                </tr>
              </thead>
              <tbody>
                {prompts.map((p) => (
                  <tr key={p.id} className="border-t border-border align-top">
                    <td className="py-1.5 pr-3 text-foreground">{p.libelle}</td>
                    {moteurs.map((m) => {
                      const g = tableaux.geo.find((x) => x.itemId === p.id && x.moteur === m);
                      return (
                        <td key={m} className="py-1.5 pr-3">
                          {!g ? <span className="text-muted-foreground">{t("veille.tableaux.pasEncore")}</span> : (
                            <>
                              <span className={g.citee ? "text-naya-salvia font-medium" : "text-muted-foreground"}>
                                {g.citee ? (g.position ? t("veille.tableaux.citeePosition", { n: g.position }) : t("veille.tableaux.citee")) : t("veille.tableaux.absente")}
                              </span>
                              {g.concurrentsCites.length > 0 && (
                                <span className="block text-[11px] text-muted-foreground">{t("veille.tableaux.aCote", { noms: g.concurrentsCites.join(", ") })}</span>
                              )}
                            </>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {motsCles.length > 0 && tableaux.serp.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-base font-semibold text-foreground">{t("veille.tableaux.serp")}</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1.5 pr-3 font-medium">{t("veille.tableaux.motCle")}</th>
                  <th className="py-1.5 pr-3 font-medium">{t("veille.tableaux.position")}</th>
                </tr>
              </thead>
              <tbody>
                {motsCles.map((k) => {
                  const s = tableaux.serp.find((x) => x.itemId === k.id);
                  return (
                    <tr key={k.id} className="border-t border-border">
                      <td className="py-1.5 pr-3 text-foreground">{k.libelle}</td>
                      <td className="py-1.5 pr-3">
                        {!s ? <span className="text-muted-foreground">{t("veille.tableaux.pasEncore")}</span>
                          : s.position ? <span className="text-foreground">{s.position}</span>
                          : <span className="text-muted-foreground">{t("veille.tableaux.horsTop")}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
