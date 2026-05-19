import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

// Baked at build time by Vite — no runtime fetch, no race condition
const waitlistMode = import.meta.env.VITE_WAITLIST_MODE === 'true';

// ── Waitlist form — reused in hero and closing section ──────────────
function WaitlistForm({ dark = false }: { dark?: boolean }) {
  const { t, i18n } = useTranslation();
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (val: string) =>
      apiRequest("POST", "/api/waitlist", { email: val, language: i18n.language }).then(r => r.json()),
    onSuccess: (data: any) => {
      if (data.error === "already_registered") {
        setError(t("landing.waitlistDuplicate"));
      } else {
        setSubmitted(true);
        setError(null);
      }
    },
    onError: () => setError(t("landing.waitlistError")),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !email.includes("@")) return;
    setError(null);
    mutation.mutate(email.trim());
  };

  if (submitted) {
    return (
      <div className="text-center space-y-2 py-2">
        <p className={`font-display text-[11px] tracking-[0.22em] uppercase ${dark ? "text-naya-cream" : "text-naya-olive"}`}>
          {t("landing.waitlistConfirm")}
        </p>
        <p className={`text-[13px] leading-[1.6] ${dark ? "text-naya-cream/60" : "text-naya-olive-55"}`}>
          {t("landing.waitlistConfirmSub")}
        </p>
      </div>
    );
  }

  return (
    <div className="w-full">
      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2">
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder={t("landing.waitlistPlaceholder")}
          required
          className={`
            flex-1 min-w-0 h-11 px-4 text-sm rounded-md border outline-none transition-colors
            ${dark
              ? "bg-white/10 border-white/20 text-naya-cream placeholder:text-naya-cream/40 focus:border-naya-cream/60"
              : "bg-white border-naya-olive-18 text-naya-olive placeholder:text-naya-olive-35 focus:border-naya-olive"
            }
          `}
        />
        <button
          type="submit"
          disabled={mutation.isPending}
          className={`
            shrink-0 h-11 px-6 font-display text-[10px] tracking-[0.2em] uppercase rounded-md
            transition-opacity duration-150 cursor-pointer disabled:opacity-50
            ${dark
              ? "bg-naya-cream text-naya-olive hover:opacity-90"
              : "bg-naya-olive text-naya-cream hover:opacity-85"
            }
          `}
        >
          {mutation.isPending ? t("landing.waitlistCtaLoading") : t("landing.waitlistCta")}
        </button>
      </form>
      {error && (
        <p className={`mt-2 text-[11px] text-center ${dark ? "text-naya-cream/50" : "text-red-500"}`}>
          {error}
        </p>
      )}
    </div>
  );
}

// ── Main Landing ─────────────────────────────────────────────────────
export default function Landing() {
  const { t, i18n } = useTranslation();

  const toggleLanguage = () =>
    i18n.changeLanguage(i18n.language === "fr" ? "en" : "fr");

  const pains = [
    t("landing.pain1"),
    t("landing.pain2"),
    t("landing.pain3"),
  ];

  const transforms = [
    { before: t("landing.before1"), after: t("landing.after1") },
    { before: t("landing.before2"), after: t("landing.after2") },
    { before: t("landing.before3"), after: t("landing.after3") },
  ];

  return (
    <div className="min-h-screen naya-paper flex flex-col text-naya-olive">

      {/* ── ① Header ─────────────────────────────────────────────── */}
      <header
        className="px-6 sm:px-10 py-4 flex items-center justify-between sticky top-0 z-20 border-b border-naya-olive-10"
        style={{ background: "rgba(247,244,236,0.92)", backdropFilter: "blur(8px)" }}
      >
        <div className="flex items-center gap-3">
          <img src="/naya-mark-elephant.png" alt="Naya" className="w-9 h-9 object-contain" />
          <span className="wordmark text-xs">NAYA</span>
        </div>
        <button
          onClick={toggleLanguage}
          className="eyebrow text-[10px] text-naya-olive-35 hover:text-naya-olive transition-colors border-b border-transparent hover:border-naya-olive-18 pb-px cursor-pointer"
        >
          {i18n.language === "fr" ? "EN" : "FR"}
        </button>
      </header>

      {/* ── ② Hero ───────────────────────────────────────────────── */}
      <section className="flex flex-col items-center justify-center text-center px-6 pt-16 pb-16 sm:pt-24 sm:pb-24 min-h-[calc(100dvh-57px)]">

        <p className="eyebrow text-[10px] text-naya-olive-35 tracking-[0.28em] mb-10">
          {t("landing.heroEyebrow")}
        </p>

        {/* Title — deux temps */}
        <div className="mb-8" style={{ maxWidth: 680 }}>
          <h1
            className="font-display font-light uppercase leading-[1.08] text-naya-olive mb-0"
            style={{ fontSize: "clamp(2rem, 5.5vw, 4.2rem)", letterSpacing: "0.06em" }}
          >
            {t("landing.heroLine1")}
          </h1>
          <p
            className="font-display font-light uppercase leading-[1.6] text-naya-olive-35 mt-3"
            style={{ fontSize: "clamp(0.9rem, 2vw, 1.25rem)", letterSpacing: "0.1em" }}
          >
            {t("landing.heroLine2")}
          </p>
          <p
            className="font-display font-light uppercase leading-[1.08] text-naya-olive mt-4"
            style={{ fontSize: "clamp(1.6rem, 3.5vw, 2.8rem)", letterSpacing: "0.06em" }}
          >
            {t("landing.heroLine3")}
          </p>
        </div>

        {/* Sous-titre */}
        <p className="text-[15px] sm:text-base text-naya-olive-55 leading-[1.75] mb-10 max-w-[440px]">
          {t("landing.heroSub")}
        </p>

        {/* CTA */}
        <div className="w-full max-w-[420px]">
          <WaitlistForm />
        </div>

      </section>

      {/* ── ③ La douleur en 3 lignes ─────────────────────────────── */}
      <section className="border-t border-naya-olive-10">
        {pains.map((pain, i) => (
          <div key={i}>
            <div className="px-6 sm:px-16 py-9 sm:py-11 flex items-center justify-center">
              <p
                className="font-display uppercase text-center text-naya-olive leading-[1.3]"
                style={{
                  fontSize: "clamp(0.9rem, 2.2vw, 1.35rem)",
                  letterSpacing: "0.1em",
                  maxWidth: 720,
                }}
              >
                {pain}
              </p>
            </div>
            {i < pains.length - 1 && <div className="border-t border-naya-olive-10" />}
          </div>
        ))}
      </section>

      {/* ── ④ Transformation — avant / avec Naya ─────────────────── */}
      <section className="border-t border-naya-olive-10 py-20 px-6 sm:px-10">
        <div className="max-w-[800px] mx-auto">

          <p className="eyebrow text-[10px] text-naya-olive-35 tracking-[0.28em] text-center mb-14">
            {t("landing.transformEyebrow")}
          </p>

          {/* Table header */}
          <div className="grid grid-cols-2 mb-4 px-2">
            <p className="eyebrow text-[9px] text-naya-olive-18 tracking-[0.2em]">
              {t("landing.colBefore")}
            </p>
            <p className="eyebrow text-[9px] text-naya-olive tracking-[0.2em] text-right">
              {t("landing.colAfter")}
            </p>
          </div>

          {/* Rows */}
          <div className="border border-naya-olive-10">
            {transforms.map((row, i) => (
              <div
                key={i}
                className={`grid grid-cols-2 ${i < transforms.length - 1 ? "border-b border-naya-olive-10" : ""}`}
              >
                {/* Before */}
                <div className="p-6 sm:p-8 border-r border-naya-olive-10">
                  <p className="text-[13px] sm:text-sm text-naya-olive-35 leading-[1.65]">
                    {row.before}
                  </p>
                </div>
                {/* After */}
                <div className="p-6 sm:p-8 bg-naya-olive-06">
                  <p className="text-[13px] sm:text-sm text-naya-olive leading-[1.65]">
                    {row.after}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── ⑤ Section finale — scarcité douce ────────────────────── */}
      <section className="naya-paper-inverse px-6 py-20 sm:py-28">
        <div className="max-w-[520px] mx-auto text-center">

          <p className="eyebrow text-[10px] text-naya-cream/35 tracking-[0.28em] mb-8">
            {t("landing.scarcityEyebrow")}
          </p>

          <p
            className="font-display font-light uppercase text-naya-cream leading-[1.15] mb-10"
            style={{ fontSize: "clamp(1.4rem, 3.5vw, 2.2rem)", letterSpacing: "0.07em" }}
          >
            {t("landing.scarcityTitle")}
          </p>

          <div className="max-w-[400px] mx-auto">
            <WaitlistForm dark />
          </div>

        </div>
      </section>

      {/* ── ⑥ Footer ─────────────────────────────────────────────── */}
      <footer className="bg-naya-olive px-6 sm:px-10 py-6 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <img src="/naya-mark-elephant.png" alt="" className="w-8 h-8 object-contain opacity-30" />
          <span className="wordmark text-[10px] text-naya-cream/50">NAYA</span>
        </div>
        <p className="eyebrow text-[9px] text-naya-cream/30 tracking-[0.18em]">
          {t("landing.footer")}
        </p>
      </footer>

    </div>
  );
}
