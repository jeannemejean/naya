import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["server/**/*.test.ts", "shared/**/*.test.ts", "client/**/*.test.{ts,tsx}"],
    // `default` garde la sortie console habituelle ; le second n'écrit QUE sur échec,
    // en AJOUTANT à `.vitest-echecs.log`. Il existe parce qu'un échec du 4 octobre 2026
    // a été perdu faute d'avoir son nom (sortie tronquée par la commande qui l'a vu),
    // et n'a jamais été reproduit en 19 passes. Voir `scripts/rapporteur-echecs.ts`.
    reporters: ["default", "./scripts/rapporteur-echecs.ts"],
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "shared"),
      "@": path.resolve(__dirname, "client/src"),
    },
  },
});
