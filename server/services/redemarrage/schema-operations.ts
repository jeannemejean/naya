// Schéma d'une opération du bilan d'un projet (séance de redémarrage), partagé par les outils.
export const SCHEMA_OPERATION = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["cocher_tache", "archiver_tache", "note_projet", "statut_projet", "creer_creneau", "arreter_creneau", "creer_envoi", "creer_tache"] },
    taskId: { type: "integer" }, texte: { type: "string" }, statut: { type: "string", enum: ["active", "paused", "incubating"] },
    titre: { type: "string" }, days: { type: "string", description: "mon,tue,…" }, startTime: { type: "string", description: "HH:MM" },
    durationMinutes: { type: "integer" }, intervalWeeks: { type: "integer", description: "1 = chaque semaine, 2 = une semaine sur deux…" },
    ritualId: { type: "integer" }, marque: { type: "string" }, objet: { type: "string" }, canal: { type: "string" },
    envoyeLe: { type: "string", description: "AAAA-MM-JJ" }, prochaineRelance: { type: "string", description: "AAAA-MM-JJ" },
    contact: { type: "string" }, dureeMinutes: { type: "integer" }, date: { type: "string", description: "AAAA-MM-JJ" },
  },
  required: ["type"],
} as const;
