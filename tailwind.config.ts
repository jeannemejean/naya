import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./client/index.html", "./client/src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        /* Cormorant Garamond — pour les titres, dates, noms de projets */
        serif: ['"Cormorant Garamond"', 'Georgia', 'serif'],
        /* IBM Plex Mono — pour les labels, tags, navigation, UI éléments */
        mono:  ['"IBM Plex Mono"', '"Fira Code"', 'monospace'],
        /* Alias pratiques */
        display: ['"Cormorant Garamond"', 'Georgia', 'serif'],
        sans: ['"IBM Plex Mono"', '"Fira Code"', 'monospace'],
      },
      borderRadius: {
        /* Principe : zéro arrondi — géométrie nette, objet de précision */
        none:  "0px",
        sm:    "0px",
        DEFAULT:"0px",
        md:    "0px",
        lg:    "0px",
        xl:    "0px",
        "2xl": "0px",
        "3xl": "0px",
        full:  "0px",
      },
      colors: {
        /* ── Palette Naya Editorial ── */
        /* Crème chaude — fond principal */
        cream: {
          DEFAULT: "#F5EAD5",   /* crème de base */
          warm:    "#EDE0C4",   /* cartes, surfaces */
          deep:    "#E5D5B0",   /* profondeur, hover states */
          dark:    "#D4C09A",   /* éléments discrets */
        },
        /* Brun écorce — primary, navigation, autorité */
        bark: {
          light:   "#7A5240",   /* brun clair, texte secondaire */
          DEFAULT: "#4A2818",   /* brun écorce — primary */
          deep:    "#2E160A",   /* brun profond — sidebar */
          ink:     "#1A0C04",   /* encre — texte principal */
        },
        /* Or mat — accent, interactions, prix, highlights */
        gold: {
          light:   "#D4AC48",   /* or lumineux */
          DEFAULT: "#B8901E",   /* or mat — accent principal */
          deep:    "#8B6A14",   /* or profond */
          muted:   "#C9A86A",   /* or atténué, états discrets */
        },
        /* Sable — borders, muted, séparateurs */
        sand: {
          light:   "#E8D8BC",
          DEFAULT: "#C8B59A",   /* borders */
          deep:    "#A89070",   /* borders marqués */
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

        /* ── Palette tâches — tons terre, chaleur, pas de couleurs vives ── */
        task: {
          ochre:   "#F5E6C4",   /* ocre clair */
          umber:   "#E8D4B8",   /* ombre naturelle */
          sage:    "#D8E4D0",   /* sauge désaturée */
          dusk:    "#DDD5E8",   /* crépuscule */
          rust:    "#F0D8CC",   /* rouille douce */
          flax:    "#EDE8C8",   /* lin */
          clay:    "#E4D4C8",   /* argile */
        },
      },
      boxShadow: {
        /* Principe : pas d'ombres portées. Seulement des séparateurs 1px. */
        /* Garder pour des éléments de profondeur minimale si nécessaire */
        "inset-sm": "inset 0 1px 0 rgba(0,0,0,0.06)",
        "inset-md": "inset 0 2px 0 rgba(0,0,0,0.08)",
        "none": "none",
        card:        "none",
        "card-hover":"none",
        float:       "none",
        inner:       "inset 0 1px 0 rgba(0,0,0,0.06)",
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
          from: { opacity: "0", transform: "scale(0.98)" },
          to:   { opacity: "1", transform: "scale(1)" },
        },
        "slide-left": {
          from: { opacity: "0", transform: "translateX(-12px)" },
          to:   { opacity: "1", transform: "translateX(0)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up":   "accordion-up 0.2s ease-out",
        "fade-up":        "fade-up 0.3s cubic-bezier(0.22, 1, 0.36, 1) both",
        "fade-in":        "fade-in 0.2s ease both",
        "scale-in":       "scale-in 0.2s cubic-bezier(0.22, 1, 0.36, 1) both",
        "slide-left":     "slide-left 0.25s cubic-bezier(0.22, 1, 0.36, 1) both",
      },
    },
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
} satisfies Config;
