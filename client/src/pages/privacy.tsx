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
          Dernière mise à jour : juin 2026
        </p>

        <div className="space-y-10 text-[15px] leading-[1.75] text-naya-olive-70">

          <section>
            <h2 className="font-display text-[13px] uppercase tracking-[0.12em] text-naya-olive mb-4">
              Qui sommes-nous
            </h2>
            <p>
              Naya est un OS stratégique IA pour fondateurs indépendants, développé et opéré par Jeanne Méjean (Agence JMD). Pour toute question relative à vos données, contactez-nous à{" "}
              <a href="mailto:naya.ai.app@gmail.com" className="text-naya-olive border-b border-naya-olive-18 hover:border-naya-olive transition-colors">
                naya.ai.app@gmail.com
              </a>.
            </p>
            <p className="mt-4">
              Cette politique couvre deux contextes : (1) la <strong>liste d'attente</strong> sur le site public, et (2) l'<strong>application Naya</strong> elle-même, qui connecte vos comptes de réseaux sociaux pour créer, planifier et publier du contenu en votre nom.
            </p>
          </section>

          <section>
            <h2 className="font-display text-[13px] uppercase tracking-[0.12em] text-naya-olive mb-4">
              Données collectées — liste d'attente
            </h2>
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
              Aucun cookie de tracking ni pixel publicitaire n'est utilisé sur le site vitrine.
            </p>
          </section>

          <section>
            <h2 className="font-display text-[13px] uppercase tracking-[0.12em] text-naya-olive mb-4">
              Données collectées — application
            </h2>
            <p className="mb-4">
              Lorsque vous utilisez l'application, nous traitons :
            </p>
            <ul className="space-y-2 pl-4">
              {[
                "Compte : email, nom, mot de passe haché. Une session technique maintient votre connexion.",
                "Profil business (Brand DNA) : informations que vous saisissez sur votre activité, vos objectifs, vos projets et vos tâches.",
                "Comptes sociaux connectés : lorsque vous reliez Instagram, Facebook, LinkedIn ou X, nous stockons un jeton d'accès, l'identifiant et le nom du compte, et l'identifiant utilisateur fourni par la plateforme.",
                "Contenu : les posts, légendes, images et calendriers de publication que vous créez ou laissez Naya générer.",
                "Métriques publiques : statistiques d'engagement renvoyées par les API des plateformes, pour vous afficher vos performances.",
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
              Comment nous utilisons les données des plateformes
            </h2>
            <p className="mb-4">
              Les données obtenues via les API de Meta (Instagram, Facebook), LinkedIn et X sont utilisées <strong>exclusivement</strong> pour les fonctionnalités que vous activez :
            </p>
            <ul className="space-y-2 pl-4">
              {[
                "Publier et planifier le contenu que vous validez, en votre nom, sur les comptes que vous avez connectés.",
                "Lire les métriques d'engagement de vos publications pour vous les présenter dans Naya.",
              ].map((item, i) => (
                <li key={i} className="flex gap-3 items-start">
                  <span className="font-mono text-[10px] text-naya-olive-35 pt-1 shrink-0">—</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4">
              Nous ne vendons jamais ces données, ne les utilisons pas pour de la publicité ciblée, ne construisons pas de profils à des fins publicitaires, et ne les partageons avec aucun tiers en dehors des sous-traitants techniques listés ci-dessous. Notre usage est conforme aux <strong>Conditions des plateformes Meta</strong> et aux politiques des autres réseaux.
            </p>
          </section>

          <section>
            <h2 className="font-display text-[13px] uppercase tracking-[0.12em] text-naya-olive mb-4">
              Sous-traitants et tiers
            </h2>
            <p className="mb-4">
              Naya s'appuie sur un nombre limité de prestataires, chacun pour une finalité précise :
            </p>
            <ul className="space-y-2 pl-4">
              {[
                "Anthropic (Claude) et OpenAI — génération de contenu et assistance IA. Vos requêtes et le contexte business nécessaire leur sont transmis pour produire une réponse. Ces données ne servent pas à entraîner leurs modèles dans le cadre de notre usage API.",
                "Meta, LinkedIn, X — pour publier et lire les statistiques sur les comptes que vous connectez.",
                "Google — uniquement si vous connectez Google Calendar, pour synchroniser vos rendez-vous.",
                "Railway / Neon (PostgreSQL, région EU) — hébergement et base de données.",
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
              Stockage et sécurité
            </h2>
            <p>
              Vos données sont stockées dans une base PostgreSQL (Railway / Neon, infrastructure AWS, région EU). Les connexions sont chiffrées en transit (TLS) et l'accès est restreint. Les jetons d'accès aux réseaux sociaux ne sont jamais exposés à l'interface : ils sont utilisés uniquement côté serveur pour exécuter les actions que vous demandez.
            </p>
          </section>

          <section>
            <h2 className="font-display text-[13px] uppercase tracking-[0.12em] text-naya-olive mb-4">
              Durée de conservation
            </h2>
            <p>
              Les données de liste d'attente sont conservées jusqu'à l'ouverture de la bêta ou votre demande de suppression (max. 12 mois). Les données de l'application sont conservées tant que votre compte est actif. Lorsque vous déconnectez un réseau social, le jeton et le compte lié sont supprimés immédiatement. À la suppression de votre compte, l'ensemble de vos données est effacé.
            </p>
          </section>

          <section>
            <h2 className="font-display text-[13px] uppercase tracking-[0.12em] text-naya-olive mb-4">
              Suppression de vos données
            </h2>
            <p>
              Vous pouvez déconnecter un réseau à tout moment depuis Réglages → Comptes connectés, retirer Naya depuis les paramètres de Facebook/Instagram (nous sommes notifiés et purgeons automatiquement vos jetons), ou nous écrire. La procédure complète est détaillée sur la page{" "}
              <Link href="/data-deletion" className="text-naya-olive border-b border-naya-olive-18 hover:border-naya-olive transition-colors">
                Suppression des données
              </Link>.
            </p>
          </section>

          <section>
            <h2 className="font-display text-[13px] uppercase tracking-[0.12em] text-naya-olive mb-4">
              Vos droits (RGPD)
            </h2>
            <p className="mb-4">
              Conformément au RGPD, vous disposez des droits d'accès, de rectification, d'effacement, d'opposition et de portabilité de vos données.
            </p>
            <p>
              Pour exercer ces droits, envoyez un email à{" "}
              <a href="mailto:naya.ai.app@gmail.com" className="text-naya-olive border-b border-naya-olive-18 hover:border-naya-olive transition-colors">
                naya.ai.app@gmail.com
              </a>{" "}
              avec l'objet "Données personnelles". Nous répondons sous 72h.
            </p>
          </section>

          <section>
            <h2 className="font-display text-[13px] uppercase tracking-[0.12em] text-naya-olive mb-4">
              Cookies
            </h2>
            <p>
              Le site vitrine n'utilise pas de cookies de tracking, d'analyse ou publicitaires. Un cookie de session technique est créé lorsque vous vous connectez à l'application, uniquement pour maintenir votre session active.
            </p>
          </section>

          <section>
            <h2 className="font-display text-[13px] uppercase tracking-[0.12em] text-naya-olive mb-4">
              Contact
            </h2>
            <p>
              Pour toute question sur cette politique ou le traitement de vos données :{" "}
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
        <Link href="/data-deletion" className="font-mono text-[11px] text-naya-olive-35 hover:text-naya-olive transition-colors cursor-pointer tracking-[0.02em]">
          Suppression des données →
        </Link>
      </footer>
    </div>
  );
}
