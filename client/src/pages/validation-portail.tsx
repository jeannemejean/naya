// Portail PUBLIC de validation client (lot 8) : lien privé /v/:token, sans compte. Sobre, au nom
// de la marque — rien de Naya. Le relecteur se choisit dans la liste de la marque, puis valide,
// refuse ou commente chaque post (aperçu : texte, visuels, réseau, date).
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

interface Decision { id: number; relecteur: string; decision: "validee" | "refusee" | "commentaire"; commentaire: string | null; le: string }
interface Visuel { url: string; type: "image" | "video"; vignette: string | null }
interface PostPortail {
  id: number; titre: string; texte: string; plateforme: string; format: string | null; prevuLe: string | null;
  statut: "a_valider" | "validee" | "refusee" | null; visuels: Visuel[]; couverture: string | null; decisions: Decision[];
}
interface Portail {
  marque: string; langue: "fr" | "en"; regle: "un" | "tous";
  relecteurs: Array<{ nom: string; email: string }>; posts: PostPortail[];
}

const CLE_RELECTEUR = "naya-portail-relecteur";

function lireRelecteur(token: string): string {
  try { return window.localStorage.getItem(`${CLE_RELECTEUR}:${token}`) ?? ""; } catch { return ""; }
}
function garderRelecteur(token: string, email: string) {
  try { window.localStorage.setItem(`${CLE_RELECTEUR}:${token}`, email); } catch { /* navigation privée */ }
}

function CartePost({ p, t, langue, relecteur, onDecision }: {
  p: PostPortail; t: (k: string, o?: any) => string; langue: string; relecteur: string;
  onDecision: (id: number, decision: "validee" | "refusee" | "commentaire", commentaire: string) => Promise<boolean>;
}) {
  const [commentaire, setCommentaire] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const agir = async (decision: "validee" | "refusee" | "commentaire") => {
    setEnvoi(true);
    if (await onDecision(p.id, decision, commentaire)) setCommentaire("");
    setEnvoi(false);
  };
  const date = p.prevuLe
    ? t("validationClient.public.prevu", { date: new Date(p.prevuLe).toLocaleString(langue, { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }) })
    : t("validationClient.public.sansDate");
  const ouvert = p.statut === "a_valider";
  return (
    <article className="rounded-lg border border-neutral-200 p-4 space-y-3" data-testid={`portail-post-${p.id}`}>
      <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
        <span className="uppercase tracking-wide">{p.plateforme}</span>
        <span>{date}</span>
        {p.statut && (
          <span className="ml-auto rounded border border-neutral-300 px-1.5 py-0.5 text-neutral-700">{t(`validationClient.statut.${p.statut}`)}</span>
        )}
      </div>
      {p.visuels.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {p.visuels.slice(0, 10).map((v, i) => (v.type === "video"
            ? <video key={i} src={v.url} poster={v.vignette ?? p.couverture ?? undefined} controls className="w-full rounded bg-neutral-100" />
            : <img key={i} src={v.url} alt={t("validationClient.public.visuel")} className="w-full rounded object-cover bg-neutral-100" loading="lazy" />))}
        </div>
      )}
      <p className="whitespace-pre-wrap break-words text-sm text-neutral-900">{p.texte}</p>
      {p.decisions.length > 0 && (
        <ul className="space-y-1 border-t border-neutral-100 pt-2">
          {p.decisions.map((d) => (
            <li key={d.id} className="text-xs text-neutral-600">
              <span className="font-medium">{t(`validationClient.decision.${d.decision}`, { nom: d.relecteur })}</span>
              {d.commentaire && <p className="whitespace-pre-wrap break-words">{d.commentaire}</p>}
            </li>
          ))}
        </ul>
      )}
      <div className="space-y-2">
        <textarea value={commentaire} onChange={(e) => setCommentaire(e.target.value)} maxLength={2000} rows={2}
          placeholder={t("validationClient.public.commentaire")} aria-label={t("validationClient.public.commentaire")}
          className="w-full rounded border border-neutral-300 p-2 text-sm" disabled={!relecteur || envoi} />
        <div className="flex flex-wrap gap-2">
          {ouvert && (
            <>
              <button type="button" disabled={!relecteur || envoi} onClick={() => void agir("validee")}
                className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-40">{t("validationClient.public.valider")}</button>
              <button type="button" disabled={!relecteur || envoi} onClick={() => void agir("refusee")}
                className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm disabled:opacity-40">{t("validationClient.public.refuser")}</button>
            </>
          )}
          <button type="button" disabled={!relecteur || envoi || !commentaire.trim()} onClick={() => void agir("commentaire")}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm disabled:opacity-40">{t("validationClient.public.commenter")}</button>
        </div>
      </div>
    </article>
  );
}

export default function PortailValidation({ params }: { params: { token: string } }) {
  const { t: tVisiteur, i18n } = useTranslation();
  const [etat, setEtat] = useState<"chargement" | "indisponible" | Portail>("chargement");
  const [relecteur, setRelecteur] = useState(() => lireRelecteur(params.token));
  const [message, setMessage] = useState<string | null>(null);

  const charger = useCallback(() => {
    fetch(`/api/portail-validation/${encodeURIComponent(params.token)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setEtat(j ?? "indisponible"))
      .catch(() => setEtat("indisponible"));
  }, [params.token]);
  useEffect(() => { charger(); }, [charger]);

  if (etat === "chargement") return <div className="min-h-screen bg-white" />;
  const t = typeof etat === "object" ? i18n.getFixedT(etat.langue) : tVisiteur;
  if (etat === "indisponible") {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-6">
        <p className="text-sm text-neutral-600">{t("validationClient.public.indisponible")}</p>
      </div>
    );
  }
  const p = etat;
  const connu = p.relecteurs.some((r) => r.email === relecteur);
  const choisi = connu ? relecteur : "";

  const decider = async (id: number, decision: "validee" | "refusee" | "commentaire", commentaire: string): Promise<boolean> => {
    setMessage(null);
    try {
      const r = await fetch(`/api/portail-validation/${encodeURIComponent(params.token)}/posts/${id}/decision`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ relecteurEmail: choisi, decision, commentaire: commentaire.trim() || null }),
      });
      if (r.ok) { setMessage(t("validationClient.public.merci")); charger(); return true; }
      setMessage(r.status === 429 ? t("validationClient.public.trop") : r.status === 409 ? t("validationClient.public.dejaDecide") : t("validationClient.public.erreur"));
      if (r.status === 409 || r.status === 404) charger();
    } catch {
      setMessage(t("validationClient.public.erreur"));
    }
    return false;
  };

  const aValider = p.posts.filter((x) => x.statut === "a_valider");
  const recents = p.posts.filter((x) => x.statut !== "a_valider");

  return (
    <div className="min-h-screen bg-white text-neutral-900">
      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-10 space-y-8">
        <header className="space-y-1">
          {p.marque && <p className="text-xs text-neutral-500">{p.marque}</p>}
          <h1 className="text-2xl font-semibold">{t("validationClient.public.titre")}</h1>
          <p className="text-sm text-neutral-600">{t(p.regle === "tous" ? "validationClient.public.regleTous" : "validationClient.public.regleUn")}</p>
        </header>

        <section className="space-y-2">
          <label htmlFor="relecteur" className="text-sm font-medium">{t("validationClient.public.qui")}</label>
          <select id="relecteur" value={choisi} className="w-full rounded border border-neutral-300 p-2 text-sm"
            onChange={(e) => { setRelecteur(e.target.value); garderRelecteur(params.token, e.target.value); }}>
            <option value="">{t("validationClient.public.choisir")}</option>
            {p.relecteurs.map((r) => <option key={r.email} value={r.email}>{r.nom === r.email ? r.email : `${r.nom} (${r.email})`}</option>)}
          </select>
          {!choisi && <p className="text-xs text-neutral-500">{t("validationClient.public.identifieAvant")}</p>}
        </section>

        {message && <p role="status" className="text-sm text-neutral-700">{message}</p>}

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-neutral-500">{t("validationClient.public.aValider")}</h2>
          {aValider.length === 0
            ? <p className="text-sm text-neutral-600">{t("validationClient.public.vide")}</p>
            : aValider.map((x) => <CartePost key={x.id} p={x} t={t} langue={p.langue} relecteur={choisi} onDecision={decider} />)}
        </section>

        {recents.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-neutral-500">{t("validationClient.public.recents")}</h2>
            {recents.map((x) => <CartePost key={x.id} p={x} t={t} langue={p.langue} relecteur={choisi} onDecision={decider} />)}
          </section>
        )}
      </main>
    </div>
  );
}
