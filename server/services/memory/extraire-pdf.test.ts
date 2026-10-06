import { describe, it, expect } from "vitest";
import { extraireTextePdf, titreDepuisNomFichier } from "./extraire-pdf";

/** PDF minimal écrit à la main (xref recalculée par pdf.js si besoin). */
function pdfAvecTexte(lignes: string[]): Buffer {
  const flux = "BT /F1 12 Tf 72 720 Td 14 TL " +
    lignes.map((l) => `(${l}) Tj T*`).join(" ") + " ET";
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${flux.length} >>\nstream\n${flux}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` +
    offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("") +
    `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

describe("extraireTextePdf", () => {
  it("extrait le texte d'un PDF lisible", async () => {
    const lignes = Array.from({ length: 6 }, (_, i) => `Ligne numero ${i} sur ce qui fonctionne en prospection digitale B2B`);
    const r = await extraireTextePdf(pdfAvecTexte(lignes));
    expect(r.statut).toBe("ok");
    if (r.statut === "ok") expect(r.texte).toContain("prospection digitale");
  });
  it("refuse un buffer qui n'est pas un PDF", async () => {
    expect((await extraireTextePdf(Buffer.from("hello world"))).statut).toBe("pas_un_pdf");
  });
  it("PDF valide sans texte : pas_de_texte", async () => {
    expect((await extraireTextePdf(pdfAvecTexte([]))).statut).toBe("pas_de_texte");
  });
  it("PDF trop court en texte : pas_de_texte", async () => {
    expect((await extraireTextePdf(pdfAvecTexte(["Bonjour"]))).statut).toBe("pas_de_texte");
  });
  it("PDF corrompu : illisible", async () => {
    expect((await extraireTextePdf(Buffer.from("%PDF-1.4\ngarbage garbage"))).statut).toBe("illisible");
  });
});

describe("titreDepuisNomFichier", () => {
  it("remplace ' — ' (séparateur de mémoire) par ' - '", () => {
    expect(titreDepuisNomFichier("Étude — été.pdf")).toBe("Étude - été");
  });
  it("retire .pdf, quelle que soit la casse", () => {
    expect(titreDepuisNomFichier("Étude.PDF")).toBe("Étude");
    expect(titreDepuisNomFichier("a.b.pdf")).toBe("a.b");
  });
  it("garde les accents et trime", () => {
    expect(titreDepuisNomFichier("  Récap été 2026 .pdf")).toBe("Récap été 2026");
  });
  it("ignore le chemin", () => {
    expect(titreDepuisNomFichier("C:\\docs\\x\\Guide.pdf")).toBe("Guide");
    expect(titreDepuisNomFichier("/tmp/a/Guide.pdf")).toBe("Guide");
  });
  it("tronque à 200", () => {
    expect(titreDepuisNomFichier("a".repeat(300) + ".pdf").length).toBe(200);
  });
});
