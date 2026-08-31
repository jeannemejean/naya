/**
 * LE PORT d'ingestion de la réception.
 *
 * Les « saves » ne sont récupérables sur AUCUN réseau connecté aujourd'hui (Instagram
 * exige `instagram_business_manage_insights`, non demandé ; TikTok n'expose aucune lecture
 * de métriques ; LinkedIn n'a pas d'équivalent sur les posts personnels). L'ingestion est
 * donc un PORT, jamais un appel direct : le Fil 3 fonctionne dès aujourd'hui avec
 * l'adaptateur manuel, et les adaptateurs réseau viendront derrière la même interface sans
 * rien réécrire ailleurs.
 */

export interface ReceptionSignal {
  contentId: number;
  platform: string;
  saves: number | null;
  shares: number | null;
  comments: number | null;
  reach: number | null;
  sentimentScore: number | null;
  measuredAt: Date;
  source: string;
}

export interface ReceptionSource {
  readonly name: string;
  fetchSignals(ref: { contentId: number; platformPostId?: string | null }): Promise<ReceptionSignal[]>;
}
