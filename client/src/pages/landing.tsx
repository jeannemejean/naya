import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Target, Brain, Calendar, MessageSquare, BarChart3, Lightbulb } from "lucide-react";
import { useTranslation } from "react-i18next";
import AuthDialog from "@/components/auth-dialog";

export default function Landing() {
  const { t } = useTranslation();
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [authDialogTab, setAuthDialogTab] = useState<"login" | "register">("login");

  const handleOpenAuth = (tab: "login" | "register" = "login") => {
    setAuthDialogTab(tab);
    setAuthDialogOpen(true);
  };

  return (
    <div className="min-h-screen" style={{ background: 'var(--background)' }}>
      {/* Header éditorial */}
      <header
        className="px-8 py-5"
        style={{ borderBottom: '1px solid var(--border)', background: 'var(--card)' }}
      >
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              style={{
                width: 36, height: 36,
                background: 'var(--primary)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <span
                style={{
                  fontFamily: '"Unbounded", system-ui, sans-serif',
                  fontWeight: 600,
                  fontSize: '1.25rem',
                  color: 'var(--primary-foreground)',
                  lineHeight: 1,
                }}
              >
                N
              </span>
            </div>
            <span
              style={{
                fontFamily: '"Unbounded", system-ui, sans-serif',
                fontWeight: 500,
                fontSize: '1.25rem',
                color: 'var(--foreground)',
                letterSpacing: '-0.01em',
              }}
            >
              Naya
            </span>
          </div>
          <button
            onClick={() => handleOpenAuth("login")}
            data-testid="auth-login"
            style={{
              fontFamily: '"IBM Plex Mono", monospace',
              fontSize: '0.6875rem',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              fontWeight: 300,
              color: 'var(--muted-foreground)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '6px 0',
              borderBottom: '1px solid transparent',
            }}
            onMouseEnter={e => ((e.currentTarget as HTMLElement).style.borderBottomColor = 'var(--accent)')}
            onMouseLeave={e => ((e.currentTarget as HTMLElement).style.borderBottomColor = 'transparent')}
          >
            {t('landing.meetNaya')}
          </button>
        </div>
      </header>

      {/* Hero — pleine largeur, typographie éditoriale */}
      <section style={{ padding: '96px 32px', maxWidth: 860, margin: '0 auto' }}>
        <h1
          style={{
            fontFamily: '"Unbounded", system-ui, sans-serif',
            fontWeight: 400,
            fontSize: 'clamp(3rem, 7vw, 5.5rem)',
            lineHeight: 1.1,
            letterSpacing: '-0.02em',
            color: 'var(--foreground)',
            marginBottom: 24,
          }}
        >
          {t('landing.heroTitle')}
          <span
            style={{
              display: 'block',
              color: 'var(--accent)',
              marginTop: 8,
            }}
          >
            {t('landing.heroSubtitle')}
          </span>
        </h1>
        <p
          style={{
            fontFamily: '"IBM Plex Mono", monospace',
            fontSize: '0.9rem',
            fontWeight: 300,
            lineHeight: 1.7,
            color: 'var(--muted-foreground)',
            marginBottom: 48,
            maxWidth: 540,
          }}
        >
          {t('landing.heroDescription')}
        </p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button
            onClick={() => handleOpenAuth("register")}
            data-testid="auth-register-hero"
            style={{
              padding: '12px 28px',
              background: 'var(--primary)',
              color: 'var(--primary-foreground)',
              border: 'none',
              cursor: 'pointer',
              fontFamily: '"IBM Plex Mono", monospace',
              fontSize: '0.6875rem',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              fontWeight: 400,
              transition: 'background-color 120ms ease',
            }}
            onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = 'var(--accent)')}
            onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = 'var(--primary)')}
          >
            {t('landing.meetNaya')}
          </button>
          <button
            onClick={() => handleOpenAuth("login")}
            style={{
              padding: '12px 28px',
              background: 'transparent',
              color: 'var(--foreground)',
              border: '1px solid var(--border)',
              cursor: 'pointer',
              fontFamily: '"IBM Plex Mono", monospace',
              fontSize: '0.6875rem',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              fontWeight: 300,
              transition: 'border-color 120ms ease',
            }}
            onMouseEnter={e => ((e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)')}
            onMouseLeave={e => ((e.currentTarget as HTMLElement).style.borderColor = 'var(--border)')}
          >
            {t('landing.seeHowItWorks')}
          </button>
        </div>
      </section>

      {/* Features Section — Clean grid with generous spacing */}
      <section className="px-8 py-24 bg-card">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-20 space-y-4">
            <h2 className="text-4xl md:text-5xl font-display text-foreground tracking-tight">
              {t('landing.notJustSmart')}
            </h2>
            <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto font-sans leading-relaxed">
              {t('landing.notJustSmartDescription')}
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8 md:gap-10">
            <Card className="border-border shadow-editorial hover-lift bg-card">
              <CardHeader className="space-y-4 pb-6">
                <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center">
                  <Target className="w-7 h-7 text-primary" />
                </div>
                <CardTitle className="font-display text-2xl">{t('landing.pilotBoard')}</CardTitle>
                <CardDescription className="text-base leading-relaxed text-muted-foreground">
                  {t('landing.pilotBoardDescription')}
                </CardDescription>
              </CardHeader>
            </Card>

            <Card className="border-border shadow-editorial hover-lift bg-card">
              <CardHeader className="space-y-4 pb-6">
                <div className="w-14 h-14 bg-secondary/10 rounded-2xl flex items-center justify-center">
                  <Brain className="w-7 h-7 text-secondary" />
                </div>
                <CardTitle className="font-display text-2xl">{t('landing.weeklyIntelligence')}</CardTitle>
                <CardDescription className="text-base leading-relaxed text-muted-foreground">
                  {t('landing.weeklyIntelligenceDescription')}
                </CardDescription>
              </CardHeader>
            </Card>

            <Card className="border-border shadow-editorial hover-lift bg-card">
              <CardHeader className="space-y-4 pb-6">
                <div className="w-14 h-14 bg-accent/10 rounded-2xl flex items-center justify-center">
                  <BarChart3 className="w-7 h-7 text-accent" />
                </div>
                <CardTitle className="font-display text-2xl">{t('landing.campaignEngine')}</CardTitle>
                <CardDescription className="text-base leading-relaxed text-muted-foreground">
                  {t('landing.campaignEngineDescription')}
                </CardDescription>
              </CardHeader>
            </Card>

            <Card className="border-border shadow-editorial hover-lift bg-card">
              <CardHeader className="space-y-4 pb-6">
                <div className="w-14 h-14 bg-info/10 rounded-2xl flex items-center justify-center">
                  <Calendar className="w-7 h-7 text-info" />
                </div>
                <CardTitle className="font-display text-2xl">{t('landing.contentCalendar')}</CardTitle>
                <CardDescription className="text-base leading-relaxed text-muted-foreground">
                  {t('landing.contentCalendarDescription')}
                </CardDescription>
              </CardHeader>
            </Card>

            <Card className="border-border shadow-editorial hover-lift bg-card">
              <CardHeader className="space-y-4 pb-6">
                <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center">
                  <MessageSquare className="w-7 h-7 text-primary" />
                </div>
                <CardTitle className="font-display text-2xl">{t('landing.outreachCrm')}</CardTitle>
                <CardDescription className="text-base leading-relaxed text-muted-foreground">
                  {t('landing.outreachCrmDescription')}
                </CardDescription>
              </CardHeader>
            </Card>

            <Card className="border-border shadow-editorial hover-lift bg-card">
              <CardHeader className="space-y-4 pb-6">
                <div className="w-14 h-14 bg-secondary/10 rounded-2xl flex items-center justify-center">
                  <Lightbulb className="w-7 h-7 text-secondary" />
                </div>
                <CardTitle className="font-display text-2xl">{t('landing.operatingProfile')}</CardTitle>
                <CardDescription className="text-base leading-relaxed text-muted-foreground">
                  {t('landing.operatingProfileDescription')}
                </CardDescription>
              </CardHeader>
            </Card>
          </div>
        </div>
      </section>

      {/* CTA Section — Elegant gradient with generous spacing */}
      <section className="px-8 py-28 bg-gradient-to-br from-primary via-primary/90 to-primary/80">
        <div className="max-w-4xl mx-auto text-center space-y-8">
          <h2 className="text-4xl md:text-5xl font-display text-white tracking-tight leading-tight">
            {t('landing.ctaTitle')}
          </h2>
          <p className="text-xl text-white/90 font-sans leading-relaxed max-w-2xl mx-auto">
            {t('landing.ctaSubtitle')}
          </p>
          <Button
            size="lg"
            variant="secondary"
            className="text-base px-12 py-7 rounded-xl shadow-editorial hover-lift bg-white hover:bg-white/95 text-foreground mt-4"
            onClick={() => handleOpenAuth("register")}
          >
            {t('landing.startWithNaya')}
          </Button>
        </div>
      </section>

      {/* Footer — Minimal & elegant */}
      <footer className="px-8 py-12 bg-foreground/95 text-background/80">
        <div className="max-w-7xl mx-auto text-center space-y-6">
          <div className="flex items-center justify-center space-x-4">
            <div className="w-9 h-9 bg-primary/90 rounded-xl flex items-center justify-center shadow-sm">
              <span className="text-white font-display text-base">N</span>
            </div>
            <span className="text-2xl font-display text-background">Naya</span>
          </div>
          <p className="text-sm text-background/60 font-sans">
            {t('landing.footer')}
          </p>
        </div>
      </footer>

      <AuthDialog
        open={authDialogOpen}
        onOpenChange={setAuthDialogOpen}
        defaultTab={authDialogTab}
      />
    </div>
  );
}
