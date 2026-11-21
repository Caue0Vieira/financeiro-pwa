/**
 * Minimal PDF writer for the monthly report, so the app needs no PDF library: A4 pages, the
 * standard Helvetica fonts (every PDF reader has them) with WinAnsi encoding for Portuguese
 * accents, text and thin lines. Pure; returns the file's bytes.
 */

export const page = { width: 595, height: 842, margin: 42 };

type Op =
  | { kind: "text"; x: number; y: number; size: number; bold: boolean; gray: number; text: string; align: "left" | "right" }
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number; gray: number };

/** Characters of Windows-1252 outside Latin-1 (the rest of Latin-1 maps to itself). */
const winAnsi: Record<string, number> = {
  "€": 0x80, "…": 0x85, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "−": 0x2d,
};

function encode(text: string) {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0)!;
    const byte = winAnsi[char] ?? (code < 0x7f || (code >= 0xa0 && code <= 0xff) ? code : 0x3f);
    const c = String.fromCharCode(byte);
    out += c === "(" || c === ")" || c === "\\" ? `\\${c}` : c;
  }
  return out;
}

/** Helvetica advance widths (1/1000 em) of the characters that matter for aligning amounts. */
const widths: Record<string, number> = {
  " ": 278, ",": 278, ".": 278, "-": 333, "/": 278, ":": 278, "(": 333, ")": 333, "$": 556, "R": 722, "%": 889,
  " ": 278, i: 222, l: 222, j: 222, t: 278, f: 278, r: 333, I: 278, m: 833, w: 722, M: 833, W: 944,
};
export const textWidth = (text: string, size: number, bold = false) =>
  ([...text].reduce((sum, char) => sum + (widths[char] ?? (/[A-Z]/.test(char) ? 667 : 556)), 0) * size * (bold ? 1.05 : 1)) / 1000;

/** Cuts text to fit a width, ending in "…". */
export function fit(text: string, width: number, size: number, bold = false) {
  if (textWidth(text, size, bold) <= width) return text;
  let cut = text;
  while (cut.length > 1 && textWidth(`${cut}…`, size, bold) > width) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

export class PdfDocument {
  private pages: Op[][] = [[]];

  get pageCount() {
    return this.pages.length;
  }

  addPage() {
    this.pages.push([]);
  }

  /** `y` counts from the top of the page, like a screen. */
  text(x: number, y: number, text: string, options: { size?: number; bold?: boolean; gray?: number; align?: "left" | "right"; pageIndex?: number } = {}) {
    const { size = 10, bold = false, gray = 0, align = "left", pageIndex = this.pages.length - 1 } = options;
    this.pages[pageIndex].push({ kind: "text", x, y, size, bold, gray, text, align });
  }

  line(x1: number, y1: number, x2: number, y2: number, gray = 0.82) {
    this.pages[this.pages.length - 1].push({ kind: "line", x1, y1, x2, y2, gray });
  }

  private content(ops: Op[]) {
    return ops.map((op) => {
      if (op.kind === "line") {
        return `${op.gray} G 0.6 w ${op.x1} ${page.height - op.y1} m ${op.x2} ${page.height - op.y2} l S`;
      }
      const x = op.align === "right" ? op.x - textWidth(op.text, op.size, op.bold) : op.x;
      return `BT ${op.gray} g /${op.bold ? "F2" : "F1"} ${op.size} Tf 1 0 0 1 ${x.toFixed(2)} ${(page.height - op.y).toFixed(2)} Tm (${encode(op.text)}) Tj ET`;
    }).join("\n");
  }

  /** The PDF file. Every character written is one byte, so string offsets are byte offsets. */
  bytes() {
    const objects: string[] = [];
    const add = (body: string) => objects.push(body);
    add("<< /Type /Catalog /Pages 2 0 R >>");
    add(""); // pages, filled below
    add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    const kids: number[] = [];
    for (const ops of this.pages) {
      const stream = this.content(ops);
      add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
      const contents = objects.length;
      add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width} ${page.height}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contents} 0 R >>`);
      kids.push(objects.length);
    }
    objects[1] = `<< /Type /Pages /Kids [${kids.map((id) => `${id} 0 R`).join(" ")}] /Count ${kids.length} >>`;

    let file = "%PDF-1.4\n%âãÏÓ\n";
    const offsets = objects.map((body, index) => {
      const offset = file.length;
      file += `${index + 1} 0 obj\n${body}\nendobj\n`;
      return offset;
    });
    const xref = file.length;
    file += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    file += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
    file += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Uint8Array.from(file, (char) => char.charCodeAt(0));
  }
}
