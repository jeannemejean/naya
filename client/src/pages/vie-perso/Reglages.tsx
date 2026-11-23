// Réglages de la vie perso : créneaux, repas, batch, courses, équipement, magasins, placard,
// cycle (facultatif) ; le foyer ; les inspirations recettes.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ProfilViePerso } from "@shared/vie-perso";
import { codeErreur, enListe, type Membre, type Recette, type ReponseProfil } from "./commun";

const CLE = "/api/vie-perso/profil";

export function Reglages() {
  const { t } = useTranslation();
  const { data, isLoading } = useQuery<ReponseProfil>({ queryKey: [CLE], throwOnError: false });
  if (isLoading || !data) return <Loader2 className="h-5 w-5 animate-spin text-naya-olive-55" />;
  return (
    <div className="space-y-5">
      <FormProfil initial={data.profil} />
      <Foyer membres={data.membres} />
      <Inspirations recettes={data.recettes} />
      <p className="text-[11px] text-naya-olive-55">{t("viePerso.reglages.cycleAide")}</p>
    </div>
  );
}

function useErreur() {
  const { t } = useTranslation();
  const { toast } = useToast();
  return (e: unknown) => toast({ title: t(`viePerso.erreurs.${codeErreur(e)}`, { defaultValue: t("viePerso.erreurs.erreur") }), variant: "destructive" });
}

const Champ = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="space-y-1 text-xs text-naya-olive-70 block">{label}{children}</label>
);

function FormProfil({ initial }: { initial: ProfilViePerso }) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const erreur = useErreur();
  const [p, setP] = useState(initial);
  const [listes, setListes] = useState({ equipement: initial.equipement.join(", "), magasins: initial.magasins.join(", "), placard: initial.placard.join(", ") });
  useEffect(() => { setP(initial); }, [initial]);
  // 4 janvier 2026 : un dimanche (0), comme batchJour et coursesJour.
  const jours = Array.from({ length: 7 }, (_, i) => new Date(2026, 0, 4 + i).toLocaleDateString(i18n.language, { weekday: "long" }));
  const maj = <K extends keyof ProfilViePerso>(k: K, v: ProfilViePerso[K]) => setP((x) => ({ ...x, [k]: v }));
  const heure = (k: keyof ProfilViePerso) => (
    <Input type="time" value={p[k] as string} onChange={(e) => maj(k, e.target.value as any)} className="w-28" />
  );
  const nombre = (k: "batchDureeMax" | "coursesDuree") => (
    <Input type="number" value={p[k]} onChange={(e) => maj(k, Number(e.target.value) || 0)} className="w-24" />
  );
  const choixJour = (k: "batchJour" | "coursesJour") => (
    <select value={p[k]} onChange={(e) => maj(k, Number(e.target.value))} className="h-10 rounded-md border border-input bg-background px-2 text-sm">
      {jours.map((j, i) => <option key={i} value={i}>{j}</option>)}
    </select>
  );

  const enregistrer = useMutation({
    mutationFn: () => apiRequest("PUT", CLE, {
      ...p, equipement: enListe(listes.equipement), magasins: enListe(listes.magasins), placard: enListe(listes.placard),
      dernieresRegles: p.dernieresRegles || null, dureeCycle: p.dureeCycle || null,
    }),
    onSuccess: () => { toast({ title: t("viePerso.reglages.enregistre") }); queryClient.invalidateQueries({ queryKey: [CLE] }); },
    onError: erreur,
  });

  return (
    <section className="rounded-lg border border-naya-olive-10 bg-card p-4 space-y-4">
      <h3 className="text-sm font-semibold">{t("viePerso.reglages.creneaux")}</h3>
      <div className="grid gap-4 md:grid-cols-2">
        <Champ label={t("viePerso.reglages.soirs")}><div className="flex items-center gap-2">{heure("soirDebut")}<span>{t("viePerso.reglages.a")}</span>{heure("soirFin")}</div></Champ>
        <Champ label={t("viePerso.reglages.weekend")}><div className="flex items-center gap-2">{heure("weekendDebut")}<span>{t("viePerso.reglages.a")}</span>{heure("weekendFin")}</div></Champ>
        <Champ label={t("viePerso.reglages.dejeuner")}>{heure("heureDejeuner")}</Champ>
        <Champ label={t("viePerso.reglages.diner")}>{heure("heureDiner")}</Champ>
        <Champ label={t("viePerso.reglages.batch")}><div className="flex flex-wrap items-center gap-2">{choixJour("batchJour")}{heure("batchHeure")}{nombre("batchDureeMax")}</div></Champ>
        <Champ label={t("viePerso.reglages.courses")}><div className="flex flex-wrap items-center gap-2">{choixJour("coursesJour")}{heure("coursesHeure")}{nombre("coursesDuree")}</div></Champ>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Champ label={t("viePerso.reglages.jeune")}><Input value={p.jeune} onChange={(e) => maj("jeune", e.target.value.slice(0, 200))} placeholder={t("viePerso.reglages.jeunePlaceholder")} /></Champ>
        {(["equipement", "magasins", "placard"] as const).map((k) => (
          <Champ key={k} label={`${t(`viePerso.reglages.${k}`)} (${t("viePerso.reglages.virgules")})`}>
            <Input value={listes[k]} onChange={(e) => setListes((x) => ({ ...x, [k]: e.target.value }))} placeholder={t(`viePerso.reglages.${k}Placeholder`)} />
          </Champ>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Champ label={`${t("viePerso.reglages.cycle")} · ${t("viePerso.reglages.dernieresRegles")}`}>
          <Input type="date" value={p.dernieresRegles ?? ""} onChange={(e) => maj("dernieresRegles", e.target.value || null)} className="w-44" />
        </Champ>
        <Champ label={t("viePerso.reglages.dureeCycle")}>
          <Input type="number" value={p.dureeCycle ?? ""} onChange={(e) => maj("dureeCycle", e.target.value ? Number(e.target.value) : null)} className="w-24" />
        </Champ>
      </div>
      <Button onClick={() => enregistrer.mutate()} disabled={enregistrer.isPending}>
        {enregistrer.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}{t("viePerso.reglages.enregistrer")}
      </Button>
    </section>
  );
}

const MEMBRE_VIDE = { prenom: "", estMoi: false, regime: "", exclusions: "", aime: "", aimePas: "", repasMaison: "les_deux" };

function Foyer({ membres }: { membres: Membre[] }) {
  const { t } = useTranslation();
  const erreur = useErreur();
  const rafraichir = () => queryClient.invalidateQueries({ queryKey: [CLE] });
  const ajouter = useMutation({ mutationFn: () => apiRequest("POST", "/api/vie-perso/membres", { ...MEMBRE_VIDE, prenom: "?" }), onSuccess: rafraichir, onError: erreur });
  return (
    <section className="rounded-lg border border-naya-olive-10 bg-card p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold">{t("viePerso.reglages.foyer")}</h3>
        <p className="text-xs text-naya-olive-55">{t("viePerso.reglages.foyerAide")}</p>
      </div>
      {membres.map((m) => <LigneMembre key={m.id} m={m} />)}
      <Button size="sm" variant="outline" onClick={() => ajouter.mutate()}><Plus className="h-3.5 w-3.5 mr-1.5" />{t("viePerso.reglages.ajouterMembre")}</Button>
    </section>
  );
}

function LigneMembre({ m }: { m: Membre }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const erreur = useErreur();
  const [x, setX] = useState(m);
  const rafraichir = () => queryClient.invalidateQueries({ queryKey: [CLE] });
  const { id: _id, ...corps } = x;
  const enregistrer = useMutation({
    mutationFn: () => apiRequest("PUT", `/api/vie-perso/membres/${m.id}`, corps),
    onSuccess: () => { toast({ title: t("viePerso.reglages.enregistre") }); rafraichir(); }, onError: erreur,
  });
  const supprimer = useMutation({ mutationFn: () => apiRequest("DELETE", `/api/vie-perso/membres/${m.id}`), onSuccess: rafraichir, onError: erreur });
  const texte = (k: "prenom" | "regime" | "exclusions" | "aime" | "aimePas") => (
    <Champ label={t(`viePerso.reglages.${k}`)}><Input value={x[k]} onChange={(e) => setX((v) => ({ ...v, [k]: e.target.value.slice(0, k === "prenom" ? 60 : 500) }))} /></Champ>
  );
  return (
    <div className="rounded-md border border-naya-olive-10 p-3 space-y-2">
      <div className="grid gap-2 md:grid-cols-3">
        {texte("prenom")}
        <Champ label={t("viePerso.reglages.repasMaison")}>
          <select value={x.repasMaison} onChange={(e) => setX((v) => ({ ...v, repasMaison: e.target.value }))} className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm">
            {["les_deux", "dejeuner", "diner"].map((r) => <option key={r} value={r}>{t(`viePerso.reglages.repasMaisons.${r}`)}</option>)}
          </select>
        </Champ>
        <label className="flex items-center gap-2 text-xs text-naya-olive-70 pt-5">
          <input type="checkbox" checked={x.estMoi} onChange={(e) => setX((v) => ({ ...v, estMoi: e.target.checked }))} />{t("viePerso.reglages.moi")}
        </label>
      </div>
      <div className="grid gap-2 md:grid-cols-2">{texte("regime")}{texte("exclusions")}{texte("aime")}{texte("aimePas")}</div>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => enregistrer.mutate()} disabled={enregistrer.isPending || !x.prenom.trim()}>{t("viePerso.reglages.enregistrer")}</Button>
        <Button size="sm" variant="outline" onClick={() => supprimer.mutate()} aria-label={t("viePerso.reglages.supprimer")}><Trash2 className="h-3.5 w-3.5" /></Button>
      </div>
    </div>
  );
}

function Inspirations({ recettes }: { recettes: Recette[] }) {
  const { t } = useTranslation();
  const erreur = useErreur();
  const [titre, setTitre] = useState("");
  const [lien, setLien] = useState("");
  const rafraichir = () => queryClient.invalidateQueries({ queryKey: [CLE] });
  const ajouter = useMutation({
    mutationFn: () => apiRequest("POST", "/api/vie-perso/recettes", { titre: titre.trim(), lien: lien.trim() || null }),
    onSuccess: () => { setTitre(""); setLien(""); rafraichir(); }, onError: erreur,
  });
  const avis = useMutation({ mutationFn: (x: { id: number; avis: string }) => apiRequest("PATCH", `/api/vie-perso/recettes/${x.id}`, { avis: x.avis }), onSuccess: rafraichir, onError: erreur });
  const supprimer = useMutation({ mutationFn: (id: number) => apiRequest("DELETE", `/api/vie-perso/recettes/${id}`), onSuccess: rafraichir, onError: erreur });
  return (
    <section className="rounded-lg border border-naya-olive-10 bg-card p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold">{t("viePerso.reglages.inspirations")}</h3>
        <p className="text-xs text-naya-olive-55">{t("viePerso.reglages.inspirationsAide")}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Input value={titre} onChange={(e) => setTitre(e.target.value.slice(0, 200))} placeholder={t("viePerso.reglages.recetteTitre")} className="flex-1 min-w-40" />
        <Input value={lien} onChange={(e) => setLien(e.target.value.slice(0, 1000))} placeholder={t("viePerso.reglages.recetteLien")} className="flex-1 min-w-40" />
        <Button onClick={() => ajouter.mutate()} disabled={!titre.trim() || ajouter.isPending}><Plus className="h-4 w-4 mr-1.5" />{t("viePerso.reglages.ajouterRecette")}</Button>
      </div>
      <ul className="space-y-2">
        {recettes.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="min-w-0 truncate">
              {r.lien ? <a href={r.lien} target="_blank" rel="noreferrer noopener" className="underline">{r.titre}</a> : r.titre}
            </span>
            <span className="flex gap-1">
              {(["aime", "bof", "non"] as const).map((a) => (
                <Button key={a} size="sm" variant={r.avis === a ? "default" : "outline"} onClick={() => avis.mutate({ id: r.id, avis: a })}>{t(`viePerso.reglages.avis.${a}`)}</Button>
              ))}
              <Button size="sm" variant="outline" onClick={() => supprimer.mutate(r.id)} aria-label={t("viePerso.reglages.supprimer")}><Trash2 className="h-3.5 w-3.5" /></Button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
