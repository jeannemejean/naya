import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Library, Upload, Loader2, Trash2, AlertTriangle } from "lucide-react";
import Sidebar from "@/components/sidebar";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

interface SavoirProps {
 onSearchClick?: () => void;
}

type Dossier = { titre: string; morceaux: number; vectorises: number; depose_le: string };
type Statut = "depose" | "pas_de_texte" | "illisible" | "pas_un_pdf" | "trop_lourd" | "deja_depose" | "trop_de_pages";
type ResultatPdf = { fichier: string; titre: string; statut: Statut; morceaux?: number };

const QUERY_KEY = ["/api/savoir/dossiers"];
const INDEX_KEY = ["/api/savoir/index"];
type EtatIndex = { disponible: boolean; raison?: string; manquants: number };
type ResultatIndex = { traites: number; indexes: number; echecs: number; raison?: string };
const MAX_FICHIERS = 10;
const MAX_OCTETS = 10 * 1024 * 1024;

export default function Savoir({ onSearchClick }: SavoirProps) {
 const { t, i18n } = useTranslation();
 const { user, isLoading: authEnCours } = useAuth();
 const { toast } = useToast();
 const queryClient = useQueryClient();
 const estOwner = (user as any)?.role === "owner";

 const inputRef = useRef<HTMLInputElement>(null);
 const [survol, setSurvol] = useState(false);
 const [resultats, setResultats] = useState<ResultatPdf[]>([]);
 const [titre, setTitre] = useState("");
 const [contenu, setContenu] = useState("");
 const [aRetirer, setARetirer] = useState<string | null>(null);

 const { data: dossiers = [] } = useQuery<Dossier[]>({
 queryKey: QUERY_KEY,
 enabled: estOwner,
 });

 const { data: etatIndex, refetch: rafraichirIndex, isFetching: verification } = useQuery<EtatIndex>({
 queryKey: INDEX_KEY,
 enabled: estOwner,
 staleTime: 30 * 1000,
 refetchOnWindowFocus: true,
 });

 // « Revérifier » : contourne le cache serveur (?forcer=1) puis met à jour la requête.
 const reverifier = async () => {
 try {
 const res = await fetch("/api/savoir/index?forcer=1", { credentials: "include" });
 if (res.ok) queryClient.setQueryData(INDEX_KEY, await res.json());
 else await rafraichirIndex();
 } catch {
 await rafraichirIndex();
 }
 };

 const libelleRaison = (raison?: string) => {
 if (!raison) return t("savoirPage.reasons.indisponible");
 const cle = `savoirPage.reasons.${raison}`;
 return i18n.exists(cle) ? t(cle) : raison;
 };

 const indexer = useMutation({
 mutationFn: async (): Promise<ResultatIndex> => {
 const res = await apiRequest("POST", "/api/savoir/index", {});
 return res.json();
 },
 onSuccess: (r) => {
 queryClient.invalidateQueries({ queryKey: QUERY_KEY });
 queryClient.invalidateQueries({ queryKey: INDEX_KEY });
 if (r.echecs > 0) {
 toast({
 title: t("savoirPage.indexPartial", { indexes: r.indexes, echecs: r.echecs, raison: libelleRaison(r.raison) }),
 variant: "destructive",
 });
 } else {
 toast({ title: t("savoirPage.indexDone", { indexes: r.indexes }) });
 }
 },
 onError: () => {
 queryClient.invalidateQueries({ queryKey: INDEX_KEY });
 toast({ title: t("savoirPage.indexFailed"), variant: "destructive" });
 },
 });

 const envoyerPdf = useMutation({
 mutationFn: async (fichiers: File[]): Promise<ResultatPdf[]> => {
 const fd = new FormData();
 for (const f of fichiers) fd.append("fichiers", f);
 const res = await fetch("/api/savoir/pdf", { method: "POST", body: fd, credentials: "include" });
 const corps = await res.json().catch(() => ({}));
 if (!res.ok) throw new Error(corps?.message ?? "envoi_invalide");
 return corps.resultats ?? [];
 },
 onSuccess: (r) => {
 setResultats(r);
 queryClient.invalidateQueries({ queryKey: QUERY_KEY });
 },
 onError: (e: Error) => {
 const cle = `savoirPage.errors.${e.message}`;
 toast({ title: i18n.exists(cle) ? t(cle) : t("savoirPage.uploadFailed"), variant: "destructive" });
 },
 });

 const lancerEnvoi = (liste: FileList | File[] | null) => {
 const fichiers = Array.from(liste ?? []);
 if (fichiers.length === 0 || envoyerPdf.isPending) return;
 if (fichiers.length > MAX_FICHIERS) {
 toast({ title: t("savoirPage.errors.trop_de_fichiers"), variant: "destructive" });
 return;
 }
 // Les trop gros ne partent pas : le statut est connu d'avance, inutile de les téléverser.
 const lourds = fichiers.filter((f) => f.size > MAX_OCTETS);
 const aEnvoyer = fichiers.filter((f) => f.size <= MAX_OCTETS);
 const locaux: ResultatPdf[] = lourds.map((f) => ({
 fichier: f.name,
 titre: f.name.replace(/\.pdf$/i, ""),
 statut: "trop_lourd",
 }));
 if (aEnvoyer.length === 0) {
 setResultats(locaux);
 return;
 }
 // Si le serveur rejette tout le lot (toast d'erreur), les « trop lourd » calculés ici
 // restent affichés : ils sont déjà connus et ne dépendent pas du serveur.
 setResultats(locaux);
 envoyerPdf.mutate(aEnvoyer, { onSuccess: (r) => setResultats([...locaux, ...r]) });
 };

 const deposer = useMutation({
 mutationFn: async () => {
 const res = await apiRequest("POST", "/api/savoir/dossiers", { titre, contenu });
 return res.json();
 },
 onSuccess: (r: any) => {
 queryClient.invalidateQueries({ queryKey: QUERY_KEY });
 // `morceaux: 0` n'est pas un succès : le document ne portait aucun texte exploitable.
 if (!r?.morceaux) {
 toast({ title: t("savoirPage.empty"), variant: "destructive" });
 return;
 }
 setTitre("");
 setContenu("");
 toast({ title: t("savoirPage.saved", { count: r.morceaux }) });
 },
 onError: (e: any) => {
 const doublon = String(e?.message ?? "").includes("deja_depose");
 toast({ title: doublon ? t("savoirPage.duplicate") : t("common.error"), variant: "destructive" });
 },
 });

 const retirer = useMutation({
 mutationFn: async (titreDossier: string) => {
 const res = await apiRequest("DELETE", "/api/savoir/dossiers", { titre: titreDossier });
 return res.json();
 },
 onSuccess: () => {
 setARetirer(null);
 queryClient.invalidateQueries({ queryKey: QUERY_KEY });
 toast({ title: t("savoirPage.removed") });
 },
 onError: () => {
 // Y compris 404 (déjà retiré ailleurs) : on rafraîchit la liste pour refléter la réalité.
 setARetirer(null);
 queryClient.invalidateQueries({ queryKey: QUERY_KEY });
 toast({ title: t("savoirPage.removeFailed"), variant: "destructive" });
 },
 });

 const pret = contenu.trim().length > 0 && !deposer.isPending;
 const locale = i18n.language?.startsWith("en") ? "en-US" : "fr-FR";
 const formaterDate = (iso: string) => {
 const d = new Date(iso);
 return Number.isNaN(d.getTime())
 ? ""
 : d.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
 };

 return (
 <div className="flex h-screen bg-background">
 <Sidebar onSearchClick={onSearchClick} />

 <div className="flex-1 flex flex-col overflow-hidden">
 <header className="bg-card border-b border-border px-6 py-4 flex-shrink-0">
 <h1 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
 <Library className="h-5 w-5 text-naya-salvia" />
 {t("savoirPage.title")}
 </h1>
 <p className="text-sm text-muted-foreground mt-0.5">{t("savoirPage.description")}</p>
 </header>

 <main className="flex-1 overflow-y-auto p-6">
 {authEnCours ? (
 <div className="flex justify-center py-8" data-testid="savoir-loading">
 <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
 </div>
 ) : !estOwner ? (
 <p className="max-w-2xl mx-auto text-sm text-muted-foreground">{t("savoirPage.reserved")}</p>
 ) : (
 <div className="max-w-2xl mx-auto space-y-6">
 {etatIndex && !etatIndex.disponible && (
 <div
 role="alert"
 data-testid="savoir-index-warning"
 className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-foreground"
 >
 <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0 text-destructive" />
 <span className="flex-1">{t("savoirPage.indexDown", { raison: libelleRaison(etatIndex.raison) })}</span>
 <button
 type="button"
 data-testid="savoir-index-recheck"
 disabled={verification}
 onClick={reverifier}
 className="flex-shrink-0 underline text-xs disabled:opacity-50"
 >
 {t("savoirPage.recheck")}
 </button>
 </div>
 )}
 {etatIndex && etatIndex.manquants > 0 && (
 <div className="flex justify-end">
 <Button
 size="sm"
 variant="outline"
 data-testid="savoir-index-button"
 disabled={indexer.isPending || !etatIndex.disponible}
 onClick={() => indexer.mutate()}
 >
 {indexer.isPending ? (
 <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />{t("savoirPage.indexing")}</>
 ) : (
 t("savoirPage.indexMissing", { count: etatIndex.manquants })
 )}
 </Button>
 </div>
 )}
 <Card>
 <CardHeader className="pb-3">
 <CardTitle className="text-base">{t("savoirPage.pdfTitle")}</CardTitle>
 </CardHeader>
 <CardContent className="space-y-3">
 <div
 onDragOver={(e) => { e.preventDefault(); setSurvol(true); }}
 onDragLeave={() => setSurvol(false)}
 onDrop={(e) => {
 e.preventDefault();
 setSurvol(false);
 lancerEnvoi(e.dataTransfer.files);
 }}
 className={`flex flex-col items-center gap-3 rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
 survol ? "border-primary bg-primary/5" : "border-border"
 }`}
 >
 {envoyerPdf.isPending ? (
 <>
 <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
 <p className="text-sm text-muted-foreground">{t("savoirPage.uploading")}</p>
 </>
 ) : (
 <>
 <Upload className="h-6 w-6 text-muted-foreground" />
 <p className="text-sm text-muted-foreground">{t("savoirPage.dropText")}</p>
 <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()}>
 {t("savoirPage.chooseFiles")}
 </Button>
 </>
 )}
 <input
 ref={inputRef}
 type="file"
 accept="application/pdf"
 multiple
 hidden
 data-testid="savoir-pdf-input"
 onChange={(e) => {
 lancerEnvoi(e.target.files);
 e.target.value = "";
 }}
 />
 </div>

 {resultats.length > 0 && (
 <ul className="space-y-1.5">
 {resultats.map((r, i) => (
 <li key={`${r.fichier}-${i}`} className="flex items-start justify-between gap-3 text-xs">
 <span className="text-foreground truncate">{r.fichier}</span>
 <span className={`flex-shrink-0 text-right ${r.statut === "depose" ? "text-emerald-700" : "text-destructive"}`}>
 {t(`savoirPage.status.${r.statut}`, { count: r.morceaux ?? 0 })}
 </span>
 </li>
 ))}
 </ul>
 )}
 </CardContent>
 </Card>

 <Card>
 <CardHeader className="pb-3">
 <CardTitle className="text-base">{t("savoirPage.textTitle")}</CardTitle>
 </CardHeader>
 <CardContent className="space-y-3">
 <Input
 placeholder={t("savoirPage.titlePlaceholder")}
 value={titre}
 onChange={(e) => setTitre(e.target.value)}
 />
 <Textarea
 placeholder={t("savoirPage.contentPlaceholder")}
 value={contenu}
 onChange={(e) => setContenu(e.target.value)}
 rows={8}
 className="resize-y"
 />
 <div className="flex items-center justify-between gap-3">
 <span className="text-[11px] text-naya-olive-35">
 {contenu.trim() ? t("savoirPage.charCount", { count: contenu.trim().length }) : ""}
 </span>
 <Button size="sm" onClick={() => deposer.mutate()} disabled={!pret}>
 {deposer.isPending ? (
 <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />{t("savoirPage.saving")}</>
 ) : (
 t("savoirPage.submit")
 )}
 </Button>
 </div>
 </CardContent>
 </Card>

 <Card>
 <CardHeader className="pb-3">
 <CardTitle className="text-base">{t("savoirPage.listTitle")}</CardTitle>
 </CardHeader>
 <CardContent className="space-y-2">
 {dossiers.length === 0 && (
 <p className="text-xs text-muted-foreground">{t("savoirPage.emptyList")}</p>
 )}
 {dossiers.map((d) => (
 <div key={d.titre} className="border-b border-border last:border-0 pb-2 last:pb-0">
 <div className="flex items-center justify-between gap-3 text-sm">
 <div className="min-w-0">
 <p className="truncate text-foreground">{d.titre}</p>
 <p className="text-[11px] text-muted-foreground">
 {t("savoirPage.chunks", { count: d.morceaux })}
 {d.vectorises < d.morceaux && ` · ${t("savoirPage.partial", { count: d.morceaux - d.vectorises })}`}
 {formaterDate(d.depose_le) && ` · ${formaterDate(d.depose_le)}`}
 </p>
 </div>
 {aRetirer !== d.titre && (
 <Button
 size="sm"
 variant="ghost"
 disabled={retirer.isPending}
 onClick={() => setARetirer(d.titre)}
 >
 <Trash2 className="h-3.5 w-3.5 mr-1" />
 {t("savoirPage.remove")}
 </Button>
 )}
 </div>
 {aRetirer === d.titre && (
 <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted px-3 py-2">
 <span className="text-xs text-foreground">{t("savoirPage.confirmRemove", { titre: d.titre })}</span>
 <span className="flex gap-2">
 <Button size="sm" variant="ghost" disabled={retirer.isPending} onClick={() => setARetirer(null)}>
 {t("savoirPage.cancel")}
 </Button>
 <Button size="sm" variant="destructive" disabled={retirer.isPending} onClick={() => retirer.mutate(d.titre)}>
 {retirer.isPending ? (
 <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />{t("savoirPage.removing")}</>
 ) : (
 t("savoirPage.confirmYes")
 )}
 </Button>
 </span>
 </div>
 )}
 </div>
 ))}
 </CardContent>
 </Card>
 </div>
 )}
 </main>
 </div>
 </div>
 );
}
