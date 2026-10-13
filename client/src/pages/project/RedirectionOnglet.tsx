// Anciennes adresses (/fondations, /veille, /mesure) : elles ouvrent l'onglet correspondant du
// projet actif, ou la liste des projets s'il n'y en a pas. Les liens déjà partagés marchent encore.
import { useEffect } from "react";
import { useLocation } from "wouter";
import { useProject } from "@/lib/project-context";
import { lienOnglet, type Onglet } from "./onglets";

export default function RedirectionOnglet({ onglet }: { onglet: Onglet }) {
  const { activeProjectId } = useProject();
  const [, navigate] = useLocation();
  useEffect(() => {
    navigate(activeProjectId != null ? lienOnglet(activeProjectId, onglet) : "/projects", { replace: true });
  }, [activeProjectId, onglet, navigate]);
  return null;
}
