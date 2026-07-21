// L'ancienne implémentation monolithique de la page Outreach a été migrée vers
// client/src/pages/outreach/OutreachHome.tsx (shell + onglets) et sera complétée
// par CampaignsGrid (Task 3) et PipelineBoard (Task 8). Cette page ré-exporte
// simplement le nouveau composant pour que la route /outreach continue de fonctionner.
export { default } from "./outreach/OutreachHome";
