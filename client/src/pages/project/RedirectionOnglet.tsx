// Anciennes adresses (/fondations, /veille, /mesure) : elles ouvrent l'onglet correspondant du
// projet actif, ou la liste des projets s'il n'y en a pas. On attend la réponse du serveur
// (source de vérité) : le navigateur peut ne rien savoir encore, ou garder un projet supprimé.
import { useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { cibleRedirection, type Onglet } from "./onglets";

export default function RedirectionOnglet({ onglet }: { onglet: Onglet }) {
  const [, navigate] = useLocation();
  const { data, isError } = useQuery<{ activeProjectId: number | null }>({ queryKey: ["/api/preferences"] });
  const cible = cibleRedirection({ chargees: data !== undefined || isError, projetActif: data?.activeProjectId ?? null }, onglet);
  useEffect(() => { if (cible) navigate(cible, { replace: true }); }, [cible, navigate]);
  return null;
}
