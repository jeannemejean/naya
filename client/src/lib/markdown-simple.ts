// Markdown simple (premier jet d'appel d'offres) → blocs à afficher. Volontairement restreint :
// aucun HTML n'est interprété, React échappe tout le texte.
export type Item = { texte: string; coche?: boolean };
export type Bloc =
  | { type: "titre"; niveau: 1 | 2 | 3; texte: string }
  | { type: "paragraphe"; texte: string }
  | { type: "citation"; texte: string }
  | { type: "liste"; ordonnee?: true; items: Item[] };

const PUCE = /^\s*[-*]\s+(?:\[( |x|X)\]\s+)?(.*)$/;
const NUMERO = /^\s*\d+[.)]\s+(.*)$/;

export function blocsMarkdown(md: string): Bloc[] {
  const blocs: Bloc[] = [];
  let para: string[] = [];
  const finirPara = () => { if (para.length) { blocs.push({ type: "paragraphe", texte: para.join(" ") }); para = []; } };
  const derniere = () => blocs[blocs.length - 1];
  let precedenteVide = true;
  for (const brute of md.replace(/\r\n/g, "\n").split("\n")) {
    const l = brute.trimEnd();
    if (!l.trim()) { finirPara(); precedenteVide = true; continue; }
    const t = /^(#{1,6})\s+(.*)$/.exec(l);
    const p = PUCE.exec(l);
    const n = NUMERO.exec(l);
    const c = /^>\s?(.*)$/.exec(l);
    if (t) {
      finirPara();
      blocs.push({ type: "titre", niveau: Math.min(t[1].length, 3) as 1 | 2 | 3, texte: t[2].trim() });
    } else if (p) {
      finirPara();
      const item: Item = p[1] !== undefined ? { texte: p[2].trim(), coche: p[1].toLowerCase() === "x" } : { texte: p[2].trim() };
      const d = derniere();
      // Une liste continue tant qu'elle garde le même genre (cases ou puces) sans ligne vide.
      if (!precedenteVide && d?.type === "liste" && !d.ordonnee && ("coche" in d.items[0]) === ("coche" in item)) d.items.push(item);
      else blocs.push({ type: "liste", items: [item] });
    } else if (n) {
      finirPara();
      const d = derniere();
      if (!precedenteVide && d?.type === "liste" && d.ordonnee) d.items.push({ texte: n[1].trim() });
      else blocs.push({ type: "liste", ordonnee: true, items: [{ texte: n[1].trim() }] });
    } else if (c) {
      finirPara();
      const d = derniere();
      if (!precedenteVide && d?.type === "citation") d.texte += ` ${c[1].trim()}`;
      else blocs.push({ type: "citation", texte: c[1].trim() });
    } else {
      para.push(l.trim());
    }
    precedenteVide = false;
  }
  finirPara();
  return blocs;
}

export type Segment = { texte: string; gras?: true; italique?: true; aCompleter?: true };

export function segmentsEnLigne(s: string): Segment[] {
  const out: Segment[] = [];
  const re = /\*\*(.+?)\*\*|\*(.+?)\*|(\[À COMPLÉTER[^\]]*\])/g;
  let i = 0;
  for (const m of s.matchAll(re)) {
    if (m.index! > i) out.push({ texte: s.slice(i, m.index) });
    if (m[1] !== undefined) out.push(/^\[À COMPLÉTER/.test(m[1]) ? { texte: m[1], gras: true, aCompleter: true } : { texte: m[1], gras: true });
    else if (m[2] !== undefined) out.push({ texte: m[2], italique: true });
    else out.push({ texte: m[3], aCompleter: true });
    i = m.index! + m[0].length;
  }
  if (i < s.length) out.push({ texte: s.slice(i) });
  return out;
}
