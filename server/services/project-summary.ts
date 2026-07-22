export const PROJECT_STAGES = ["ideation", "early", "growth", "mature"] as const;

export type ProjectStage = (typeof PROJECT_STAGES)[number];

export function isValidStage(s: string): boolean {
  return (PROJECT_STAGES as readonly string[]).includes(s);
}
