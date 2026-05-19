import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

// Baked at build time by Vite — no runtime fetch, no race condition
const waitlistMode = import.meta.env.VITE_WAITLIST_MODE === 'true';

// ── Shared waitlist submission logic ────────────────────────────────────────
function useWaitlist() {
  const { t, i18n } = useTranslation();
  const [email, setEmail] = useState("");
  const [description, setDescription] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (data: { email: string; description?: string }) =>
      apiRequest("POST", "/api/waitlist", { ...data, language: i18n.language }).then(r => r.json()),
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
    mutation.mutate({ email: email.trim(), description: description.trim() || undefined });
  };

  return { email, setEmail, description, setDescription, submitted, error, mutation, handleSubmit, t };
}

// ── Waitlist form — full version (email + description) ──────────────────────
function WaitlistForm() {
  const { email, setEmail, description, setDescription, submitted, error, mutation, handleSubmit, t } = useWaitlist();

  if (submitted) {
    return (
      <div className="py-6 space-y-3">
        <p className="eyebrow text-[11px] tracking-[0.22em] text-naya-cream">
          {t("landing.waitlistConfirm")}
        </p>
        <p className="text-[14px] text-naya-cream/50 leading-relaxed">
          {t("landing.waitlistConfirmSub")}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <label className="block font-mono text-[10px] uppercase tracking-[0.1em] text-naya-cream/40 mb-2">
          {t("landing.waitlistEmailLabel")}
        </label>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder={t("landing.waitlistEmailPlaceholder")}
          required
          className="w-full bg-transparent border-0 border-b border-naya-cream/20 pb-3 text-[15px] text-naya-cream placeholder:text-naya-cream/25 focus:outline-none focus:border-naya-cream/50 transition-colors rounded-none"
        />
      </div>
      <div>
        <label className="block font-mono text-[10px] uppercase tracking-[0.1em] text-naya-cream/40 mb-2">
          {t("landing.waitlistDescLabel")}
        </label>
        <input
          type="text"
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder={t("landing.waitlistDescPlaceholder")}
          className="w-full bg-transparent border-0 border-b border-naya-cream/20 pb-3 text-[15px] text-naya-cream placeholder:text-naya-cream/25 focus:outline-none focus:border-naya-cream/50 transition-colors rounded-none"
        />
      </div>
      <button
        type="submit"
        disabled={mutation.isPending}
        className="w-full py-4 bg-naya-cream text-naya-olive font-sans font-medium text-[15px] tracking-[0.01em] hover:bg-white transition-colors disabled:opacity-50 cursor-pointer mt-2"
      >
        {mutation.isPending ? t("landing.waitlistCtaLoading") : t("landing.waitlistCta")}
      </button>
      {error && (
        <p className="text-[11px] text-center text-naya-cream/40">{error}</p>
      )}
      <p className="font-mono text-[11px] text-naya-cream/25 text-center tracking-[0.02em]">
        {t("landing.waitlistFormFooter")}
      </p>
    </form>
  );
}

// ── Section label ────────────────────────────────────────────────────────────
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-naya-olive-35 mb-12">
      {children}
    </p>
  );
}

// ── Main Landing ─────────────────────────────────────────────────────────────
export default function Landing() {
  const { t, i18n } = useTranslation();
  const toggleLanguage = () => i18n.changeLanguage(i18n.language === "fr" ? "en" : "fr");
  const scrollToWaitlist = () =>
    document.getElementById("waitlist")?.scrollIntoView({ behavior: "smooth" });

  const phases = [
    { label: t("landing.mockupP1Label"), title: t("landing.mockupP1Title"), meta: t("landing.mockupP1Meta") },
    { label: t("landing.mockupP2Label"), title: t("landing.mockupP2Title"), meta: t("landing.mockupP2Meta") },
    { label: t("landing.mockupP3Label"), title: t("landing.mockupP3Title"), meta: t("landing.mockupP3Meta") },
  ];

  const compRows = [
    { before: t("landing.comp1Before"), after: t("landing.comp1After") },
    { before: t("landing.comp2Before"), after: t("landing.comp2After") },
    { before: t("landing.comp3Before"), after: t("landing.comp3After") },
    { before: t("landing.comp4Before"), after: t("landing.comp4After") },
  ];

  const perks = [
    t("landing.perk1"),
    t("landing.perk2"),
    t("landing.perk3"),
    t("landing.perk4"),
  ];

  return (
    <div className="min-h-screen naya-paper flex flex-col text-naya-olive">

      {/* ── ① Header ─────────────────────────────────────────────────── */}
      <header
        className="px-6 sm:px-10 py-7 flex items-center justify-between sticky top-0 z-20 border-b border-naya-olive-10"
        style={{ background: "rgba(247,244,236,0.92)", backdropFilter: "blur(8px)" }}
      >
        <div className="flex items-center gap-3">
          <img src="/naya-mark-elephant.png" alt="Naya" className="w-16 h-16 object-contain" />
          <span className="wordmark text-base">NAYA</span>
        </div>
        <div className="flex items-center gap-6">
          <span className="font-mono text-[11px] text-naya-olive-35 tracking-[0.04em] hidden sm:block">
            {t("landing.heroMeta")}
          </span>
          <button
            onClick={toggleLanguage}
            className="eyebrow text-[10px] text-naya-olive-35 hover:text-naya-olive transition-colors cursor-pointer"
          >
            {i18n.language === "fr" ? "EN" : "FR"}
          </button>
        </div>
      </header>

      {/* ── ② Hero ───────────────────────────────────────────────────── */}
      <section className="px-6 sm:px-10 lg:px-16 pt-20 pb-24 sm:pt-28 sm:pb-32 w-full max-w-screen-xl mx-auto">
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-naya-olive-35 mb-10">
          {t("landing.heroEyebrow")}
        </p>

        <h1
          className="font-sans font-medium text-naya-olive leading-[1.07] mb-8"
          style={{ fontSize: "clamp(2.5rem, 5.5vw, 4.5rem)", letterSpacing: "-0.025em", maxWidth: 860 }}
        >
          {t("landing.heroH1")}
        </h1>

        <p
          className="text-naya-olive-55 leading-[1.55] mb-12 max-w-[600px]"
          style={{ fontSize: "clamp(1rem, 1.8vw, 1.2rem)" }}
        >
          {t("landing.heroSub")}
        </p>

        <div className="flex flex-wrap gap-4 items-center">
          <button
            onClick={scrollToWaitlist}
            className="group flex items-center gap-3 bg-naya-olive text-naya-cream py-4 px-7 font-sans font-medium text-[15px] tracking-[0.01em] hover:opacity-85 transition-opacity cursor-pointer"
          >
            {t("landing.heroCta")}
            <span className="inline-block transition-transform duration-150 group-hover:translate-x-1">→</span>
          </button>
          <span className="font-mono text-[11px] text-naya-olive-35 tracking-[0.02em]">
            {t("landing.heroMeta")}
          </span>
        </div>
      </section>

      {/* ── ③ Le constat ─────────────────────────────────────────────── */}
      <section className="border-t border-naya-olive-10 px-6 sm:px-10 lg:px-16 py-20 sm:py-24 w-full max-w-screen-xl mx-auto">
        <SectionLabel>{t("landing.constatLabel")}</SectionLabel>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 lg:gap-20 items-start">
          {/* Stat block */}
          <div
            className="font-sans leading-[1.3] tracking-tight"
            style={{ fontSize: "clamp(1.25rem, 2.5vw, 1.75rem)" }}
          >
            <p className="mb-6">
              {t("landing.constatText1")}{" "}
              <strong className="font-semibold">{t("landing.constatStat")}</strong>{" "}
              {t("landing.constatText2")}
            </p>
            <p className="text-naya-olive-55">{t("landing.constatText3")}</p>
          </div>

          {/* Tool list */}
          <ul>
            {[1, 2, 3, 4].map(i => (
              <li key={i} className="flex gap-4 py-5 border-b border-naya-olive-10 last:border-0 items-start">
                <span className="font-mono text-[10px] text-naya-olive-35 pt-0.5 min-w-[28px] shrink-0">
                  0{i}
                </span>
                <span className="text-[15px] text-naya-olive-70 leading-relaxed">
                  {t(`landing.constatTool${i}`)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── ④ La mécanique ───────────────────────────────────────────── */}
      <section className="border-t border-naya-olive-10 px-6 sm:px-10 lg:px-16 py-20 sm:py-24 w-full max-w-screen-xl mx-auto">
        <SectionLabel>{t("landing.mechaniqueLabel")}</SectionLabel>

        <div className="max-w-2xl mb-14">
          <h2
            className="font-display font-light uppercase text-naya-olive leading-[1.12] mb-6"
            style={{ fontSize: "clamp(1.5rem, 3.2vw, 2.4rem)", letterSpacing: "0.07em" }}
          >
            {t("landing.mechaniqueH2")}
          </h2>
          <p className="text-naya-olive-55 leading-[1.6]" style={{ fontSize: "clamp(1rem, 1.5vw, 1.1rem)" }}>
            {t("landing.mechaniqueSub")}
          </p>
        </div>

        {/* UI Mockup */}
        <div
          className="naya-paper-inverse rounded-2xl p-8 sm:p-10 mb-6"
          style={{ boxShadow: "0 24px 60px -20px rgba(43,45,28,0.35)" }}
        >
          {/* Chrome bar */}
          <div className="flex items-center gap-2 mb-8 pb-5 border-b border-naya-cream/10">
            <div className="w-2.5 h-2.5 rounded-full bg-naya-cream/15" />
            <div className="w-2.5 h-2.5 rounded-full bg-naya-cream/15" />
            <div className="w-2.5 h-2.5 rounded-full bg-naya-cream/15" />
            <span className="ml-3 font-mono text-[11px] text-naya-cream/30 tracking-[0.02em]">
              naya.app · campaign engine
            </span>
          </div>

          <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-naya-cream/40 mb-3">
            {t("landing.mockupObjectiveLabel")}
          </p>
          <p className="font-sans font-medium text-naya-cream text-[20px] sm:text-[22px] leading-tight mb-2" style={{ letterSpacing: "-0.01em" }}>
            {t("landing.mockupObjective")}
          </p>
          <p className="font-mono text-[11px] text-naya-cream/30 mb-8 tracking-[0.01em]">
            {t("landing.mockupContext")}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {phases.map((phase, i) => (
              <div key={i} className="bg-naya-cream/5 rounded-xl p-5">
                <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-naya-cream/35 mb-3">
                  {phase.label}
                </p>
                <p className="text-naya-cream text-[14px] leading-snug mb-2 font-medium">
                  {phase.title}
                </p>
                <p className="font-mono text-[11px] text-naya-cream/30">
                  {phase.meta}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* 3 use cases */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">

          {/* Case 01 — Plan */}
          <div
            className="naya-paper-inverse rounded-2xl p-7 flex flex-col"
            style={{ boxShadow: "0 24px 60px -20px rgba(43,45,28,0.25)" }}
          >
            <p className="font-mono text-[10px] text-naya-cream/30 tracking-[0.1em] uppercase mb-6">01</p>
            <h3 className="font-sans font-medium text-naya-cream text-[18px] sm:text-[20px] leading-[1.25] mb-3">
              {t("landing.case1Title")}
            </h3>
            <p className="text-[13px] text-naya-cream/45 leading-relaxed mb-6">
              {t("landing.case1Desc")}
            </p>
            <div className="flex-1 bg-naya-cream/5 rounded-lg p-4 space-y-3 text-[12px]">
              <div className="bg-naya-cream/8 px-3 py-2 rounded border-l-2 border-naya-mauve font-mono text-naya-cream/80">
                {t("landing.case1Input")}
              </div>
              <div className="text-center text-naya-cream/25 text-sm">↓</div>
              <div className="bg-naya-cream/5 rounded px-3 py-2 space-y-1.5">
                {([1, 2, 3, 4] as const).map(n => (
                  <div key={n} className="flex justify-between text-naya-cream/70 py-1 border-b border-naya-cream/8 last:border-0">
                    <span>{t(`landing.case1Step${n}`)}</span>
                    <span className="font-mono text-[10px] text-naya-cream/35">{t(`landing.case1W${n}`)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Case 02 — Memory */}
          <div
            className="naya-paper-inverse rounded-2xl p-7 flex flex-col"
            style={{ boxShadow: "0 24px 60px -20px rgba(43,45,28,0.25)" }}
          >
            <p className="font-mono text-[10px] text-naya-cream/30 tracking-[0.1em] uppercase mb-6">02</p>
            <h3 className="font-sans font-medium text-naya-cream text-[18px] sm:text-[20px] leading-[1.25] mb-3">
              {t("landing.case2Title")}
            </h3>
            <p className="text-[13px] text-naya-cream/45 leading-relaxed mb-6">
              {t("landing.case2Desc")}
            </p>
            <div className="flex-1 bg-naya-cream/5 rounded-lg p-4 space-y-2 text-[12px]">
              {([1, 2, 3] as const).map(n => (
                <div key={n}>
                  <div className="bg-naya-cream/5 rounded px-3 py-2">
                    <p className="font-mono text-[9px] uppercase tracking-[0.08em] text-naya-cream/30 mb-1">
                      {t(`landing.case2L${n}`)}
                    </p>
                    <p className="text-naya-cream/80">{t(`landing.case2V${n}`)}</p>
                  </div>
                  <p className="flex items-center gap-2 text-[10px] font-mono text-naya-cream/30 pl-3 mt-1 mb-1">
                    <span className="text-naya-mauve">↳</span>
                    {t(`landing.case2Sub${n}`)}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Case 03 — Decision */}
          <div
            className="naya-paper-inverse rounded-2xl p-7 flex flex-col"
            style={{ boxShadow: "0 24px 60px -20px rgba(43,45,28,0.25)" }}
          >
            <p className="font-mono text-[10px] text-naya-cream/30 tracking-[0.1em] uppercase mb-6">03</p>
            <h3 className="font-sans font-medium text-naya-cream text-[18px] sm:text-[20px] leading-[1.25] mb-3">
              {t("landing.case3Title")}
            </h3>
            <p className="text-[13px] text-naya-cream/45 leading-relaxed mb-6">
              {t("landing.case3Desc")}
            </p>
            <div className="flex-1 bg-naya-cream/5 rounded-lg p-4 space-y-3 text-[12px]">
              <div className="px-3 py-2.5 bg-naya-cream/5 rounded border-l-2 border-naya-mauve italic text-naya-cream/70 leading-snug">
                {t("landing.case3Q")}
              </div>
              <div className="bg-naya-cream/5 rounded px-3 py-3">
                <span className="inline-block bg-naya-mauve/60 text-naya-cream font-mono text-[9px] px-2 py-0.5 rounded tracking-[0.05em] uppercase mb-2">
                  {t("landing.case3Tag")}
                </span>
                <p className="text-naya-cream/70 text-[11px] leading-[1.6]">
                  {t("landing.case3A")}
                </p>
              </div>
            </div>
          </div>

        </div>
      </section>

      {/* ── ⑤ Le positionnement ──────────────────────────────────────── */}
      <section className="border-t border-naya-olive-10 px-6 sm:px-10 lg:px-16 py-20 sm:py-24 w-full max-w-screen-xl mx-auto">
        <SectionLabel>{t("landing.positionLabel")}</SectionLabel>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 lg:gap-20 items-center">
          {/* Text side */}
          <div>
            <h2
              className="font-display font-light uppercase text-naya-olive leading-[1.12] mb-7"
              style={{ fontSize: "clamp(1.5rem, 3vw, 2.2rem)", letterSpacing: "0.07em" }}
            >
              {t("landing.positionH2")}
            </h2>
            <p className="text-[16px] text-naya-olive-55 leading-[1.65] mb-5">
              {t("landing.positionText1")}
            </p>
            <p className="text-[16px] text-naya-olive-55 leading-[1.65] mb-5">
              {t("landing.positionText2")}
            </p>
            <p className="text-[16px] font-medium text-naya-olive leading-[1.65]">
              {t("landing.positionText3")}
            </p>
          </div>

          {/* Comparison panel */}
          <div
            className="naya-paper-inverse rounded-2xl p-8 sm:p-9"
            style={{ boxShadow: "0 24px 60px -20px rgba(43,45,28,0.35)" }}
          >
            {compRows.map((row, i) => (
              <div
                key={i}
                className={`grid grid-cols-2 gap-6 py-5 ${i < compRows.length - 1 ? "border-b border-naya-cream/10" : ""}`}
              >
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-naya-cream/30 mb-2">
                    {t("landing.compBefore")}
                  </p>
                  <p className="text-[14px] text-naya-cream/40 leading-snug">{row.before}</p>
                </div>
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-naya-cream/30 mb-2">
                    {t("landing.compAfter")}
                  </p>
                  <p className="text-[14px] text-naya-cream font-medium leading-snug">{row.after}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── ⑥ Waitlist ───────────────────────────────────────────────── */}
      <section
        id="waitlist"
        className="border-t border-naya-olive-10 px-6 sm:px-10 lg:px-16 py-20 sm:py-24 w-full max-w-screen-xl mx-auto"
      >
        <div
          className="naya-paper-inverse rounded-2xl p-8 sm:p-12 lg:p-16 grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center"
          style={{ boxShadow: "0 24px 60px -20px rgba(43,45,28,0.35)" }}
        >
          {/* Left — content */}
          <div>
            <h2
              className="font-sans font-medium text-naya-cream leading-[1.15] mb-6"
              style={{ fontSize: "clamp(1.6rem, 3vw, 2.2rem)", letterSpacing: "-0.015em" }}
            >
              {t("landing.waitlistH2")}
            </h2>
            <p className="text-[15px] text-naya-cream/50 leading-relaxed mb-9">
              {t("landing.waitlistDesc")}
            </p>
            <ul>
              {perks.map((perk, i) => (
                <li key={i} className="flex gap-4 py-4 border-b border-naya-cream/10 last:border-0 items-start">
                  <span className="font-mono text-[10px] text-naya-cream/30 pt-0.5 min-w-[24px] shrink-0">
                    0{i + 1}
                  </span>
                  <span className="text-[13px] text-naya-cream/60 leading-snug">{perk}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Right — form */}
          <div className="bg-naya-cream/5 rounded-xl p-7 sm:p-9">
            <WaitlistForm />
          </div>
        </div>
      </section>

      {/* ── ⑦ Footer ─────────────────────────────────────────────────── */}
      <footer className="border-t border-naya-olive-10 px-6 sm:px-10 py-7 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <img src="/naya-mark-elephant.png" alt="" className="w-7 h-7 object-contain opacity-25" />
          <span className="wordmark text-[10px] text-naya-olive-35">NAYA</span>
        </div>
        <p className="font-mono text-[11px] text-naya-olive-35 tracking-[0.02em]">
          {t("landing.footerTagline")}
        </p>
      </footer>

    </div>
  );
}
