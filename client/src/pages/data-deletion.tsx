import { Link } from "wouter";

export default function DataDeletion() {
  const code =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("code")
      : null;

  return (
    <div className="min-h-screen naya-paper text-naya-olive">
      {/* Header */}
      <header
        className="px-6 sm:px-10 py-7 flex items-center justify-between border-b border-naya-olive-10 sticky top-0 z-20"
        style={{ background: "rgba(247,244,236,0.92)", backdropFilter: "blur(8px)" }}
      >
        <Link href="/" className="flex items-center gap-3 cursor-pointer">
          <img src="/naya-mark-elephant.png" alt="Naya" className="w-16 h-16 object-contain" />
          <span className="wordmark text-sm">NAYA</span>
        </Link>
        <Link href="/" className="font-mono text-[11px] text-naya-olive-35 hover:text-naya-olive transition-colors tracking-[0.04em] cursor-pointer">
          ← Retour
        </Link>
      </header>

      {/* Content */}
      <main className="max-w-2xl mx-auto px-6 sm:px-10 py-16 sm:py-24">

        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-naya-olive-35 mb-8">
          Suppression des données
        </p>

        <h1
          className="font-display font-light uppercase text-naya-olive leading-[1.1] mb-4"
          style={{ fontSize: "clamp(1.6rem, 3.5vw, 2.6rem)", letterSpacing: "0.07em" }}
        >
          Supprimer vos données.
        </h1>

        <p className="font-mono text-[11px] text-naya-olive-35 tracking-[0.02em] mb-14">
          Dernière mise à jour : juin 2026
        </p>

        <div className="space-y-10 text-[15px] leading-[1.75] text-naya-olive-70">

          {code && (
            <section className="rounded-lg border border-naya-olive-18 bg-card p-5">
              <h2 className="font-display text-[13px] uppercase tracking-[0.12em] text-naya-olive mb-3">
                Demande reçue
              </h2>
              <p>
                Votre demande de suppression a bien été enregistrée et traitée. Les comptes
                sociaux liés et les jetons d'accès associés ont été supprimés de nos serveurs.
              </p>
              <p className="mt-3">
                Code de confirmation :{" "}
                <span className="font-mono text-[13px] text-naya-olive">{code}</span>
              </p>
            </section>
          )}

          <section>
            <h2 className="font-display text-[13px] uppercase tracking-[0.12em] text-naya-olive mb-4">
              Comment supprimer vos données
            </h2>
            <p className="mb-4">
              Vous pouvez demander la suppression des données que Naya détient sur vous de deux façons :
            </p>
            <ul className="space-y-2 pl-4">
              {[
                "Depuis l'app : Réglages → Comptes connectés → Déconnecter. Cela révoque le jeton d'accès et supprime le compte social lié.",
                "Depuis Facebook/Instagram : Paramètres → Apps et sites web → Naya → Supprimer. Meta nous notifie automatiquement et nous purgeons vos jetons et comptes liés.",
                "Par email : écrivez à naya.ai.app@gmail.com avec l'objet « Suppression de données ». Nous traitons la demande sous 30 jours.",
              ].map((item, i) => (
                <li key={i} className="flex gap-3 items-start">
                  <span className="font-mono text-[10px] text-naya-olive-35 pt-1 shrink-0">—</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="font-display text-[13px] uppercase tracking-[0.12em] text-naya-olive mb-4">
              Ce qui est supprimé
            </h2>
            <p>
              Les jetons d'accès (Instagram, Facebook, LinkedIn, X), les identifiants de comptes
              sociaux connectés, et les contenus programmés non publiés associés à ces comptes.
              Les contenus déjà publiés sur vos réseaux restent sous votre contrôle directement
              sur ces plateformes.
            </p>
          </section>

          <section>
            <h2 className="font-display text-[13px] uppercase tracking-[0.12em] text-naya-olive mb-4">
              Contact
            </h2>
            <p>
              Pour toute question sur la suppression de vos données :{" "}
              <a href="mailto:naya.ai.app@gmail.com" className="text-naya-olive border-b border-naya-olive-18 hover:border-naya-olive transition-colors">
                naya.ai.app@gmail.com
              </a>
            </p>
          </section>

        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-naya-olive-10 px-6 sm:px-10 py-7 flex items-center justify-between gap-4 flex-wrap max-w-2xl mx-auto">
        <span className="wordmark text-[10px] text-naya-olive-35">NAYA · 2026</span>
        <Link href="/privacy" className="font-mono text-[11px] text-naya-olive-35 hover:text-naya-olive transition-colors cursor-pointer tracking-[0.02em]">
          Politique de confidentialité →
        </Link>
      </footer>
    </div>
  );
}
