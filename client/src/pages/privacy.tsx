import { Link } from "wouter";

export default function Privacy() {
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
          Politique de confidentialité
        </p>

        <h1
          className="font-display font-light uppercase text-naya-olive leading-[1.1] mb-4"
          style={{ fontSize: "clamp(1.6rem, 3.5vw, 2.6rem)", letterSpacing: "0.07em" }}
        >
          Vos données, en clair.
        </h1>

        <p className="font-mono text-[11px] text-naya-olive-35 tracking-[0.02em] mb-14">
          Dernière mise à jour : mai 2026
        </p>

        <div className="space-y-10 text-[15px] leading-[1.75] text-naya-olive-70">

          <section>
            <h2 className="font-display text-[13px] uppercase tracking-[0.12em] text-naya-olive mb-4">
              Qui sommes-nous
            </h2>
            <p>
              Naya est un OS stratégique IA pour fondateurs indépendants, développé et opéré par Jeanne Méjean (Agence JMD). Pour toute question relative à vos données, vous pouvez nous contacter à{" "}
              <a href="mailto:hello@naya.so" className="text-naya-olive border-b border-naya-olive-18 hover:border-naya-olive transition-colors">
                hello@naya.so
              </a>.
            </p>
          </section>

          <section>
            <h2 className="font-display text-[13px] uppercase tracking-[0.12em] text-naya-olive mb-4">
              Données collectées
            </h2>
            <p className="mb-4">
              Sur la page d'accueil, nous collectons uniquement :
            </p>
            <ul className="space-y-2 pl-4">
              {[
                "Votre adresse email — pour vous contacter lors de l'ouverture de la bêta.",
                "Une description optionnelle de ce que vous construisez — pour filtrer les profils pertinents.",
                "La langue de votre navigateur — pour vous répondre dans votre langue.",
              ].map((item, i) => (
                <li key={i} className="flex gap-3 items-start">
                  <span className="font-mono text-[10px] text-naya-olive-35 pt-1 shrink-0">—</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4">
              Aucune donnée de navigation, aucun cookie de tracking, aucun pixel publicitaire n'est utilisé sur ce site.
            </p>
          </section>

          <section>
            <h2 className="font-display text-[13px] uppercase tracking-[0.12em] text-naya-olive mb-4">
              Pourquoi nous collectons ces données
            </h2>
            <p>
              Uniquement pour gérer la liste d'attente de la bêta privée Naya : vous informer de l'ouverture des accès, filtrer les profils selon la cible produit, et vous envoyer un seul email de confirmation à votre inscription.
            </p>
            <p className="mt-4">
              Nous ne faisons pas de prospection commerciale, de newsletter non sollicitée, ni de revente de données. Point.
            </p>
          </section>

          <section>
            <h2 className="font-display text-[13px] uppercase tracking-[0.12em] text-naya-olive mb-4">
              Stockage et sécurité
            </h2>
            <p>
              Vos données sont stockées dans une base de données PostgreSQL hébergée sur Railway (infrastructure AWS, région EU). L'accès est restreint et les connexions sont chiffrées (TLS). Aucune donnée n'est transmise à des tiers.
            </p>
          </section>

          <section>
            <h2 className="font-display text-[13px] uppercase tracking-[0.12em] text-naya-olive mb-4">
              Durée de conservation
            </h2>
            <p>
              Vos données sont conservées jusqu'à l'ouverture de la bêta ou jusqu'à votre demande de suppression, selon ce qui arrive en premier. Si la bêta ne se concrétise pas, les données sont supprimées dans un délai de 12 mois suivant votre inscription.
            </p>
          </section>

          <section>
            <h2 className="font-display text-[13px] uppercase tracking-[0.12em] text-naya-olive mb-4">
              Vos droits (RGPD)
            </h2>
            <p className="mb-4">
              Conformément au Règlement Général sur la Protection des Données (RGPD), vous disposez des droits suivants :
            </p>
            <ul className="space-y-2 pl-4">
              {[
                "Droit d'accès — consulter les données que nous détenons sur vous.",
                "Droit de rectification — corriger une donnée inexacte.",
                "Droit à l'effacement — demander la suppression de vos données.",
                "Droit d'opposition — vous opposer à tout traitement.",
              ].map((item, i) => (
                <li key={i} className="flex gap-3 items-start">
                  <span className="font-mono text-[10px] text-naya-olive-35 pt-1 shrink-0">—</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4">
              Pour exercer ces droits, envoyez un email à{" "}
              <a href="mailto:hello@naya.so" className="text-naya-olive border-b border-naya-olive-18 hover:border-naya-olive transition-colors">
                hello@naya.so
              </a>{" "}
              avec l'objet "Données personnelles". Nous répondons sous 72h.
            </p>
          </section>

          <section>
            <h2 className="font-display text-[13px] uppercase tracking-[0.12em] text-naya-olive mb-4">
              Cookies
            </h2>
            <p>
              Ce site n'utilise pas de cookies de tracking, d'analyse ou publicitaires. Un cookie de session technique peut être créé si vous vous connectez à l'application Naya (bêta), uniquement pour maintenir votre session active.
            </p>
          </section>

          <section>
            <h2 className="font-display text-[13px] uppercase tracking-[0.12em] text-naya-olive mb-4">
              Contact
            </h2>
            <p>
              Pour toute question sur cette politique ou sur le traitement de vos données :{" "}
              <a href="mailto:hello@naya.so" className="text-naya-olive border-b border-naya-olive-18 hover:border-naya-olive transition-colors">
                hello@naya.so
              </a>
            </p>
          </section>

        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-naya-olive-10 px-6 sm:px-10 py-7 flex items-center justify-between gap-4 flex-wrap max-w-2xl mx-auto">
        <span className="wordmark text-[10px] text-naya-olive-35">NAYA · 2026</span>
        <Link href="/" className="font-mono text-[11px] text-naya-olive-35 hover:text-naya-olive transition-colors cursor-pointer tracking-[0.02em]">
          ← Retour à l'accueil
        </Link>
      </footer>
    </div>
  );
}
