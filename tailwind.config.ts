import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./client/index.html", "./client/src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        /* Unbounded — titres, wordmark, headers (alternative gratuite à Anantason Ultra Expanded) */
        /* Si Anantason est acheté plus tard : ajouter en premier dans ce tableau */
        display: ['"Anantason Ultra Expanded"', '"Unbounded"', 'system-ui', 'sans-serif'],
        /* Helvetica Neue — corps de texte (fallback Inter pour Windows/Android) */
        sans: ['"Helvetica Neue"', '"Helvetica"', '"Inter"', 'system-ui', '-apple-system', 'sans-serif'],
        /* Inter — garanti cross-platform */
        inter: ['"Inter"', 'system-ui', 'sans-serif'],
      },
      colors: {
        /* ── Palette principale Naya ── */
        cream: {
          DEFAULT: "#F7F4EC",
          dark:    "#EDE9DC",
          light:   "#FAFAF5",
        },
        olive: {
          DEFAULT: "#2B2D1C",
          light:   "#3D4028",
          muted:   "#5C6040",
          faint:   "rgba(43, 45, 28, 0.08)",
        },

        /* ── Accents Sanzo Wada — palette 321 uniquement ── */
        /* いおうこう — Sulphur Yellow */
        sulphur: {
          DEFAULT: "#D4C97A",
          subtle:  "rgba(212, 201, 122, 0.15)",
          text:    "#7A6C1A",
        },
        /* セージブルー — Salvia Blue */
        salvia: {
          DEFAULT: "#7D8FA8",
          subtle:  "rgba(125, 143, 168, 0.15)",
          text:    "#3A4F68",
        },
        /* くすみばら — Dusty Mauve */
        mauve: {
          DEFAULT: "#9E7E87",
          subtle:  "rgba(158, 126, 135, 0.15)",
          text:    "#5E3040",
        },

        /* ── Variables shadcn/ui ── */
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

        /* ── Tâches — tons sur fond crème ── */
        task: {
          sulphur: "rgba(212, 201, 122, 0.18)",
          salvia:  "rgba(125, 143, 168, 0.18)",
          mauve:   "rgba(158, 126, 135, 0.18)",
          olive:   "rgba(43, 45, 28, 0.10)",
        },
      },
      borderRadius: {
        none:    "0px",
        sm:      "4px",
        DEFAULT: "6px",
        md:      "6px",
        lg:      "10px",
        xl:      "14px",
        "2xl":   "18px",
        "3xl":   "24px",
        full:    "9999px",
      },
      boxShadow: {
        sm:          "0 1px 2px rgba(43, 45, 28, 0.08)",
        DEFAULT:     "0 2px 6px rgba(43, 45, 28, 0.10)",
        md:          "0 4px 12px rgba(43, 45, 28, 0.10)",
        lg:          "0 8px 24px rgba(43, 45, 28, 0.12)",
        xl:          "0 16px 40px rgba(43, 45, 28, 0.14)",
        "2xl":       "0 24px 60px rgba(43, 45, 28, 0.16)",
        card:        "0 1px 3px rgba(43, 45, 28, 0.08)",
        "card-hover":"0 4px 16px rgba(43, 45, 28, 0.12)",
        float:       "0 8px 28px rgba(43, 45, 28, 0.16)",
        inner:       "inset 0 1px 0 rgba(255, 255, 255, 0.6)",
        none:        "none",
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
