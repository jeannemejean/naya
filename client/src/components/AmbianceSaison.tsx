import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useApparence } from "@/hooks/useApparence";
import { appliquerSaison } from "@/lib/appliquer-saison";
import { saisonEffective } from "@shared/saisons";

const TRENTE_MINUTES = 30 * 60 * 1000;

// Pose la saison sur <html>. Hors connexion ou en cas d'erreur, la saison « auto » par défaut s'applique.
export function AmbianceSaison(): null {
  const { isAuthenticated } = useAuth();
  const { apparence, fuseau } = useApparence(isAuthenticated);
  // Le tick force un recalcul : la saison peut changer sans que l'app soit rechargée.
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), TRENTE_MINUTES);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    appliquerSaison(saisonEffective(apparence, new Date(), fuseau));
  }, [apparence, fuseau, tick]);

  return null;
}

export default AmbianceSaison;
