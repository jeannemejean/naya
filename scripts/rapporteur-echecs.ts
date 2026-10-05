// Rapporteur vitest qui n'écrit QUE sur échec, et qui AJOUTE au journal.
//
// Pourquoi il existe : le 4 octobre 2026, une passe de la suite sur cinq a montré
// « 1 failed | 1789 passed ». La commande qui l'a vu tronquait sa sortie à quatre
// lignes, donc le NOM du test est perdu. Il n'a jamais été reproduit depuis —
// 19 passes complètes vertes, et 15 passes en isolation sur chacun des dix fichiers
// qui lisent l'horloge réelle. Un événement à moins d'un sur vingt ne se traque pas
// à la main : il se traque en faisant en sorte que la PROCHAINE occurrence se
// capture toute seule.
//
// ── Trois décisions de conception, et elles sont le cœur de l'outil ──
//
// 1. Il AJOUTE (`appendFileSync`), il n'écrase jamais. Un rapporteur qui réécrit son
//    fichier à chaque passe verrait sa preuve effacée par la passe verte suivante —
//    exactement le piège que cet outil existe pour éviter.
//
// 2. Il n'écrit RIEN quand tout passe. Un journal qui grossit à chaque passe verte
//    devient illisible et personne ne le relit. Un fichier absent veut dire « aucun
//    échec depuis sa mise en place » — une information, pas une absence.
//
// 3. Il utilise `onTestCaseResult` / `onTestRunEnd`, PAS `onFinished`. Première
//    version écrite avec `onFinished` : elle n'a rien écrit malgré quatre échecs
//    réels, parce que ce hook n'est plus appelé par vitest 4. Vérifié par un
//    rapporteur de diagnostic qui listait les hooks réellement invoqués, au lieu de
//    deviner une seconde fois. Un rapporteur non testé contre un vrai échec ne vaut
//    rien — c'est tout son objet.
//
// Il n'a aucun effet sur le résultat des tests : il observe et écrit à côté.

import { appendFileSync } from "node:fs";
import path from "node:path";

const JOURNAL = path.resolve(process.cwd(), ".vitest-echecs.log");

export default class RapporteurEchecs {
  /** Échecs accumulés pendant la passe, vidés dans le journal à la fin. */
  private echecs: string[] = [];

  onTestCaseResult(cas: any) {
    // `result` est une méthode en vitest 4 ; on tolère les deux formes pour ne pas
    // dépendre d'un détail de version — un rapporteur qui plante ferait échouer une
    // passe pour une raison qui n'est pas la sienne.
    const r = typeof cas?.result === "function" ? cas.result() : cas?.result;
    if (r?.state !== "failed") return;

    const fichier = cas?.module?.moduleId ?? cas?.module?.id ?? "(fichier inconnu)";
    const nom = cas?.fullName ?? cas?.name ?? "(nom inconnu)";
    const message = (r?.errors ?? [])
      .map((e: any) => e?.message ?? String(e))
      .join(" | ") || "(sans message)";

    this.echecs.push(
      `ÉCHEC\t${fichier}\t${nom}\t${String(message).replace(/\s+/g, " ").slice(0, 400)}`,
    );
  }

  onTestRunEnd(_modules?: unknown, erreursHorsTest: any[] = []) {
    const lignes = [...this.echecs];

    // Les erreurs hors test comptent aussi : un fichier qui ne démarre pas, un worker
    // qui expire. C'est ce qui a produit les FAUX échecs du 2 octobre sous une charge
    // système de 22, et il faut pouvoir les distinguer d'un vrai test rouge — sans
    // cette distinction, la prochaine enquête repartirait sur une fausse piste.
    for (const err of erreursHorsTest ?? []) {
      const m = (err as any)?.message ?? String(err);
      lignes.push(`HORS-TEST\t-\t-\t${String(m).replace(/\s+/g, " ").slice(0, 400)}`);
    }

    this.echecs = [];
    if (lignes.length === 0) return; // tout est vert : on n'écrit rien, volontairement

    const horodatage = new Date().toISOString();
    try {
      appendFileSync(JOURNAL, lignes.map((l) => `${horodatage}\t${l}`).join("\n") + "\n", "utf8");
      console.error(`\n[rapporteur-echecs] ${lignes.length} échec(s) consigné(s) dans ${JOURNAL}`);
    } catch (e: any) {
      // Ne jamais faire échouer une passe à cause du journal.
      console.error(`[rapporteur-echecs] impossible d'écrire le journal : ${e?.message}`);
    }
  }
}
