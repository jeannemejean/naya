import { useState } from "react";
import { Target, Brain, Calendar, MessageSquare, BarChart3, Lightbulb } from "lucide-react";
import { useTranslation } from "react-i18next";
import AuthDialog from "@/components/auth-dialog";

const FONT_DISPLAY = '"Montserrat", system-ui, sans-serif';
const FONT_BODY    = '"Helvetica Neue", "Helvetica", "Inter", system-ui, sans-serif';

export default function Landing() {
  const { t } = useTranslation();
  const [authDialogOpen, setAuthDialogOpen]   = useState(false);
  const [authDialogTab,  setAuthDialogTab]    = useState<"login" | "register">("login");

  const handleOpenAuth = (tab: "login" | "register" = "login") => {
    setAuthDialogTab(tab);
    setAuthDialogOpen(true);
  };

  const features = [
    { icon: Target,       key: "pilotBoard" },
    { icon: Brain,        key: "weeklyIntelligence" },
    { icon: BarChart3,    key: "campaignEngine" },
    { icon: Calendar,     key: "contentCalendar" },
    { icon: MessageSquare,key: "outreachCrm" },
    { icon: Lightbulb,    key: "operatingProfile" },
  ] as const;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--background)', fontFamily: FONT_BODY }}>

      {/* ── Header ── */}
      <header style={{
        padding: '20px 40px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--card)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        maxWidth: '100%',
      }}>
        {/* Wordmark NAYA */}
        <span style={{
          fontFamily: FONT_DISPLAY,
          fontWeight: 500,
          fontSize: '0.875rem',
          letterSpacing: '0.25em',
          textTransform: 'uppercase',
          color: 'var(--foreground)',
        }}>
          NAYA
        </span>

        <button
          onClick={() => handleOpenAuth("login")}
          data-testid="auth-login"
          style={{
            fontFamily: FONT_BODY,
            fontSize: '0.75rem',
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            fontWeight: 500,
            color: 'var(--muted-foreground)',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '6px 0',
            borderBottom: '1px solid transparent',
            transition: 'color 150ms ease, border-color 150ms ease',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.color = 'var(--foreground)';
            (e.currentTarget as HTMLElement).style.borderBottomColor = 'var(--foreground)';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.color = 'var(--muted-foreground)';
            (e.currentTarget as HTMLElement).style.borderBottomColor = 'transparent';
          }}
        >
          {t('landing.meetNaya')}
        </button>
      </header>

      {/* ── Hero ── */}
      <section style={{ padding: '80px 40px 72px', maxWidth: 740, margin: '0 auto' }}>
        <p style={{
          fontFamily: FONT_BODY,
          fontSize: '0.6875rem',
          fontWeight: 500,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--muted-foreground)',
          marginBottom: 24,
        }}>
          Intelligence stratégique · For builders
        </p>

        <h1 style={{
          fontFamily: FONT_DISPLAY,
          fontWeight: 600,
          fontSize: 'clamp(1.75rem, 3.5vw, 2.75rem)',
          lineHeight: 1.2,
          letterSpacing: '-0.01em',
          color: 'var(--foreground)',
          marginBottom: 20,
          textTransform: 'uppercase',
        }}>
          {t('landing.heroTitle')}
        </h1>

        <p style={{
          fontFamily: FONT_BODY,
          fontSize: '0.9375rem',
          fontWeight: 400,
          lineHeight: 1.7,
          color: 'var(--muted-foreground)',
          marginBottom: 40,
          maxWidth: 500,
        }}>
          {t('landing.heroDescription')}
        </p>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            onClick={() => handleOpenAuth("register")}
            data-testid="auth-register-hero"
            style={{
              padding: '11px 28px',
              background: 'var(--primary)',
              color: 'var(--primary-foreground)',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              fontFamily: FONT_BODY,
              fontSize: '0.75rem',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              fontWeight: 500,
              transition: 'opacity 150ms ease',
            }}
            onMouseEnter={e => ((e.currentTarget as HTMLElement).style.opacity = '0.85')}
            onMouseLeave={e => ((e.currentTarget as HTMLElement).style.opacity = '1')}
          >
            {t('landing.meetNaya')}
          </button>

          <button
            onClick={() => handleOpenAuth("login")}
            style={{
              padding: '11px 28px',
              background: 'transparent',
              color: 'var(--foreground)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              cursor: 'pointer',
              fontFamily: FONT_BODY,
              fontSize: '0.75rem',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              fontWeight: 400,
              transition: 'border-color 150ms ease',
            }}
            onMouseEnter={e => ((e.currentTarget as HTMLElement).style.borderColor = 'var(--foreground)')}
            onMouseLeave={e => ((e.currentTarget as HTMLElement).style.borderColor = 'var(--border)')}
          >
            {t('landing.seeHowItWorks')}
          </button>
        </div>
      </section>

      {/* ── Séparateur ── */}
      <div style={{ borderTop: '1px solid var(--border)', maxWidth: 900, margin: '0 auto 0' }} />

      {/* ── Features ── */}
      <section style={{ padding: '72px 40px', background: 'var(--card)' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <div style={{ marginBottom: 56 }}>
            <h2 style={{
              fontFamily: FONT_DISPLAY,
              fontWeight: 600,
              fontSize: 'clamp(1.25rem, 2.5vw, 1.75rem)',
              letterSpacing: '-0.01em',
              textTransform: 'uppercase',
              color: 'var(--foreground)',
              marginBottom: 12,
            }}>
              {t('landing.notJustSmart')}
            </h2>
            <p style={{
              fontFamily: FONT_BODY,
              fontSize: '0.9375rem',
              color: 'var(--muted-foreground)',
              lineHeight: 1.65,
              maxWidth: 480,
            }}>
              {t('landing.notJustSmartDescription')}
            </p>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: 1,
            border: '1px solid var(--border)',
          }}>
            {features.map(({ icon: Icon, key }) => (
              <div
                key={key}
                style={{
                  padding: '28px 28px',
                  background: 'var(--card)',
                  borderRight: '1px solid var(--border)',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <Icon
                  size={18}
                  strokeWidth={1.5}
                  style={{ color: 'var(--muted-foreground)', marginBottom: 16 }}
                />
                <p style={{
                  fontFamily: FONT_BODY,
                  fontWeight: 600,
                  fontSize: '0.8125rem',
                  color: 'var(--foreground)',
                  marginBottom: 8,
                  letterSpacing: '-0.01em',
                }}>
                  {t(`landing.${key}`)}
                </p>
                <p style={{
                  fontFamily: FONT_BODY,
                  fontSize: '0.8125rem',
                  color: 'var(--muted-foreground)',
                  lineHeight: 1.6,
                }}>
                  {t(`landing.${key}Description`)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA — flat, pas de gradient ── */}
      <section style={{
        padding: '80px 40px',
        background: 'var(--primary)',
      }}>
        <div style={{ maxWidth: 560, margin: '0 auto', textAlign: 'center' }}>
          <h2 style={{
            fontFamily: FONT_DISPLAY,
            fontWeight: 600,
            fontSize: 'clamp(1.25rem, 2.5vw, 1.75rem)',
            letterSpacing: '-0.01em',
            textTransform: 'uppercase',
            color: 'var(--primary-foreground)',
            marginBottom: 16,
          }}>
            {t('landing.ctaTitle')}
          </h2>
          <p style={{
            fontFamily: FONT_BODY,
            fontSize: '0.9375rem',
            color: 'rgba(247, 244, 236, 0.65)',
            lineHeight: 1.65,
            marginBottom: 36,
          }}>
            {t('landing.ctaSubtitle')}
          </p>
          <button
            onClick={() => handleOpenAuth("register")}
            style={{
              padding: '12px 32px',
              background: 'var(--primary-foreground)',
              color: 'var(--primary)',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              fontFamily: FONT_BODY,
              fontSize: '0.75rem',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              fontWeight: 600,
              transition: 'opacity 150ms ease',
            }}
            onMouseEnter={e => ((e.currentTarget as HTMLElement).style.opacity = '0.9')}
            onMouseLeave={e => ((e.currentTarget as HTMLElement).style.opacity = '1')}
          >
            {t('landing.startWithNaya')}
          </button>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer style={{
        padding: '32px 40px',
        background: 'var(--foreground)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 12,
      }}>
        <span style={{
          fontFamily: FONT_DISPLAY,
          fontWeight: 500,
          fontSize: '0.75rem',
          letterSpacing: '0.25em',
          textTransform: 'uppercase',
          color: 'var(--primary-foreground)',
          opacity: 0.9,
        }}>
          NAYA
        </span>
        <p style={{
          fontFamily: FONT_BODY,
          fontSize: '0.75rem',
          color: 'rgba(247, 244, 236, 0.4)',
        }}>
          {t('landing.footer')}
        </p>
      </footer>

      <AuthDialog
        open={authDialogOpen}
        onOpenChange={setAuthDialogOpen}
        defaultTab={authDialogTab}
      />
    </div>
  );
}
