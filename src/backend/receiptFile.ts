/**
 * Receipts are shrunk in the browser before upload: photos to at most 1600 px on the longest side
 * (JPEG), plus a 320 px thumbnail for the entry screen. PDFs go as they are.
 */

export const receiptLimits = { bytes: 5 * 1024 * 1024, original: 25 * 1024 * 1024, edge: 1600, thumb: 320 };

/** Size that fits `max` on the longest side, never enlarging. */
export function fitSize(width: number, height: number, max: number) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** "Nota fiscal.HEIC" → "Nota fiscal.jpg" (the photo is re-encoded as JPEG). */
export const receiptName = (name: string, contentType: string) => {
  const base = name.replace(/\.[^.]+$/, "").replace(/[^\p{L}\p{N} ._-]+/gu, "").trim().slice(0, 80) || "comprovante";
  return `${base}.${contentType === "application/pdf" ? "pdf" : "jpg"}`;
};

async function encode(image: HTMLImageElement, max: number, quality: number) {
  const { width, height } = fitSize(image.naturalWidth, image.naturalHeight, max);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Não foi possível preparar a imagem.");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Não foi possível preparar a imagem."))), "image/jpeg", quality));
}

export async function prepareReceipt(file: File): Promise<{ main: Blob; thumb?: Blob; contentType: string; name: string }> {
  if (file.type === "application/pdf") {
    if (file.size > receiptLimits.bytes) throw new Error("O PDF precisa ter até 5 MB.");
    return { main: file, contentType: "application/pdf", name: receiptName(file.name, "application/pdf") };
  }
  if (!file.type.startsWith("image/")) throw new Error("Escolha uma foto ou um PDF.");
  if (file.size > receiptLimits.original) throw new Error("A foto precisa ter até 25 MB.");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    try {
      await image.decode();
    } catch {
      throw new Error("Não foi possível abrir a imagem. Tente uma foto em JPEG, PNG ou WebP.");
    }
    const main = await encode(image, receiptLimits.edge, 0.82);
    if (main.size > receiptLimits.bytes) throw new Error("A foto continua grande demais depois de reduzida.");
    return { main, thumb: await encode(image, receiptLimits.thumb, 0.7), contentType: "image/jpeg", name: receiptName(file.name, "image/jpeg") };
  } finally {
    URL.revokeObjectURL(url);
  }
}
