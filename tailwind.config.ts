import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./client/index.html", "./client/src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        /* Inter — corps de texte, UI générale */
        sans:    ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        /* IBM Plex Mono — labels, tags, données, navigation */
        mono:    ['"IBM Plex Mono"', '"Fira Code"', 'monospace'],
        /* Cormorant Garamond — titres display, logo, éléments signature */
        serif:   ['"Cormorant Garamond"', 'Georgia', 'serif'],
        display: ['"Cormorant Garamond"', 'Georgia', 'serif'],
      },
      borderRadius: {
        /* Modern SaaS — arrondis subtils et naturels */
        none:    "0px",
        sm:      "6px",
        DEFAULT: "8px",
        md:      "8px",
        lg:      "12px",
        xl:      "16px",
        "2xl":   "20px",
        "3xl":   "24px",
        full:    "9999px",
      },
      colors: {
        /* ── Palette Naya Dark ── */
        /* Bleu nuit ardoise — fond principal */
        night: {
          DEFAULT: "#1E2030",
          deep:    "#181A2A",
          soft:    "#222540",
        },
        /* Gris bleuté foncé — surfaces secondaires */
        slate: {
          surface: "#252840",
          elevated:"#2D3050",
          subtle:  "#2A2D45",
        },
        /* Blanc lavandé — texte principal */
        lavender: {
          DEFAULT: "#E8E6F0",
          muted:   "#9896B0",
          dim:     "#6E6C88",
        },
        /* Mauve poussiéreux — accent primaire */
        mauve: {
          DEFAULT: "#8B7FA8",
          light:   "#A699C0",
          dark:    "#6D628A",
          subtle:  "rgba(139,127,168,0.12)",
        },
        /* Vert sauge profond — micro-accent */
        sage: {
          DEFAULT: "#5C7A6B",
          light:   "#7A9A8A",
          dark:    "#445A50",
          subtle:  "rgba(92,122,107,0.12)",
        },

        /* ── Variables shadcn/ui mappées ── */
        background:  "var(--background)",
        foreground:  "var(--foreground)",
        card: {
          DEFAULT:    "var(--card)",
          foreground: "var(--card-foreground)",
        },
        popover: {
          DEFAULT:    "var(--popover)",
          foreground: "var(--popover-foreground)",
        },
        primary: {
          DEFAULT:    "var(--primary)",
          foreground: "var(--primary-foreground)",
        },
        secondary: {
          DEFAULT:    "var(--secondary)",
          foreground: "var(--secondary-foreground)",
        },
        muted: {
          DEFAULT:    "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
        accent: {
          DEFAULT:    "var(--accent)",
          foreground: "var(--accent-foreground)",
        },
        destructive: {
          DEFAULT:    "var(--destructive)",
          foreground: "var(--destructive-foreground)",
        },
        border: "var(--border)",
        input:  "var(--input)",
        ring:   "var(--ring)",
        chart: {
          "1": "var(--chart-1)",
          "2": "var(--chart-2)",
          "3": "var(--chart-3)",
          "4": "var(--chart-4)",
          "5": "var(--chart-5)",
        },
        sidebar: {
          DEFAULT:              "var(--sidebar-background)",
          foreground:           "var(--sidebar-foreground)",
          primary:              "var(--sidebar-primary)",
          "primary-foreground": "var(--sidebar-primary-foreground)",
          accent:               "var(--sidebar-accent)",
          "accent-foreground":  "var(--sidebar-accent-foreground)",
          border:               "var(--sidebar-border)",
          ring:                 "var(--sidebar-ring)",
        },

        /* ── Palette tâches — tons discrets sur fond sombre ── */
        task: {
          purple:  "rgba(139,127,168,0.18)",
          teal:    "rgba(92,122,107,0.18)",
          rose:    "rgba(168,100,120,0.18)",
          amber:   "rgba(168,140,80,0.18)",
          indigo:  "rgba(100,110,200,0.18)",
          slate:   "rgba(100,110,150,0.18)",
          mauve:   "rgba(120,100,150,0.18)",
        },
      },
      boxShadow: {
        /* Ombres adaptées au dark mode — profondes, subtiles */
        sm:          "0 1px 3px rgba(0,0,0,0.35)",
        DEFAULT:     "0 2px 6px rgba(0,0,0,0.4), 0 1px 2px rgba(0,0,0,0.25)",
        md:          "0 4px 10px rgba(0,0,0,0.4), 0 2px 4px rgba(0,0,0,0.25)",
        lg:          "0 8px 24px rgba(0,0,0,0.45), 0 4px 8px rgba(0,0,0,0.3)",
        xl:          "0 16px 40px rgba(0,0,0,0.5), 0 8px 16px rgba(0,0,0,0.3)",
        "2xl":       "0 24px 60px rgba(0,0,0,0.55)",
        card:        "0 1px 3px rgba(0,0,0,0.3), 0 1px 2px rgba(0,0,0,0.2)",
        "card-hover":"0 4px 16px rgba(0,0,0,0.45), 0 2px 6px rgba(0,0,0,0.3)",
        float:       "0 8px 28px rgba(0,0,0,0.55), 0 4px 12px rgba(0,0,0,0.3)",
        inner:       "inset 0 1px 0 rgba(255,255,255,0.05)",
        glow:        "0 0 20px rgba(139,127,168,0.25)",
        "glow-sm":   "0 0 10px rgba(139,127,168,0.2)",
        none:        "none",
        editorial:   "0 2px 8px rgba(0,0,0,0.4)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to:   { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to:   { height: "0" },
        },
        "fade-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to:   { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to:   { opacity: "1" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.97)" },
          to:   { opacity: "1", transform: "scale(1)" },
        },
        "slide-left": {
          from: { opacity: "0", transform: "translateX(-12px)" },
          to:   { opacity: "1", transform: "translateX(0)" },
        },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(12px)" },
          to:   { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%":      { opacity: "0.6" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up":   "accordion-up 0.2s ease-out",
        "fade-up":        "fade-up 0.3s cubic-bezier(0.22, 1, 0.36, 1) both",
        "fade-in":        "fade-in 0.2s ease both",
        "scale-in":       "scale-in 0.2s cubic-bezier(0.22, 1, 0.36, 1) both",
        "slide-left":     "slide-left 0.25s cubic-bezier(0.22, 1, 0.36, 1) both",
        "slide-up":       "slide-up 0.3s cubic-bezier(0.22, 1, 0.36, 1) both",
        "pulse-soft":     "pulse-soft 2s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
} satisfies Config;
