import type { QRCode } from "jsqr";

export interface ScannedQrImage {
  text: string;
  imageDataUrl: string;
}

/** Preserve the code's pixels rather than re-encoding a possibly binary payload. */
export function captureQrImage(canvas: HTMLCanvasElement, code?: QRCode): string {
  if (!code) return canvas.toDataURL("image/png");
  const points = [code.location.topLeftCorner, code.location.topRightCorner,
    code.location.bottomLeftCorner, code.location.bottomRightCorner];
  const left = Math.min(...points.map((point) => point.x));
  const top = Math.min(...points.map((point) => point.y));
  const right = Math.max(...points.map((point) => point.x));
  const bottom = Math.max(...points.map((point) => point.y));
  const padding = Math.ceil(Math.max(right - left, bottom - top) * 0.12);
  const x = Math.max(0, Math.floor(left));
  const y = Math.max(0, Math.floor(top));
  const width = Math.min(canvas.width - x, Math.ceil(right) - x);
  const height = Math.min(canvas.height - y, Math.ceil(bottom) - y);
  const cropped = document.createElement("canvas");
  cropped.width = width + padding * 2;
  cropped.height = height + padding * 2;
  const context = cropped.getContext("2d");
  if (!context) throw new Error("Could not capture the code image.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, cropped.width, cropped.height);
  context.drawImage(canvas, x, y, width, height, padding, padding, width, height);
  return cropped.toDataURL("image/png");
}

export async function readQrImage(file: File): Promise<ScannedQrImage> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Could not open this image. Try a PNG or JPEG screenshot."));
      image.src = url;
    });
    const jsQR = (await import("jsqr")).default;
    const canvas = document.createElement("canvas");
    // Bound memory use on large camera photos while keeping dense codes readable.
    const scale = Math.min(1, 2400 / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Could not read the image in this browser.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(pixels.data, canvas.width, canvas.height, { inversionAttempts: "attemptBoth" });
    return { text: code?.data ?? "", imageDataUrl: captureQrImage(canvas, code ?? undefined) };
  } finally {
    URL.revokeObjectURL(url);
  }
}
