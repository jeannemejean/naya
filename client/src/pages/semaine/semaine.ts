// Les sept jours d'une semaine (lundi → dimanche), en « AAAA-MM-JJ ».
import { lundiDe, plusJours } from "@shared/atelier";

export { lundiDe, plusJours };

export function joursDeLaSemaine(lundi: string): string[] {
  return Array.from({ length: 7 }, (_, i) => plusJours(lundi, i));
}
