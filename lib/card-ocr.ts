/**
 * On-device card OCR. Images are drawn to a local canvas and passed straight
 * to a WebAssembly worker; nothing is uploaded.
 */

import type TesseractNamespace from "tesseract.js";

type Tesseract = typeof TesseractNamespace;
type OcrWorker = Awaited<ReturnType<Tesseract["createWorker"]>>;

export interface ScanCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OcrProgress {
  status: string;
  progress: number;
}

const MAX_IMAGE_SIDE = 1600;
const CARD_ASPECT = 1.586;

/** The area covered by the on-screen card guide, in source pixels. */
export function centerCardCrop(width: number, height: number): ScanCrop {
  const cropWidth = width * 0.86;
  const cropHeight = Math.min(height * 0.94, cropWidth / CARD_ASPECT);
  return {
    x: (width - cropWidth) / 2,
    y: (height - cropHeight) / 2,
    width: cropWidth,
    height: cropHeight,
  };
}

/** Draws the selected area at a useful size, in grayscale, for OCR. */
export function renderCardCanvas(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  crop?: ScanCrop
): HTMLCanvasElement {
  const region =
    crop && crop.width > 0 && crop.height > 0
      ? crop
      : { x: 0, y: 0, width: sourceWidth, height: sourceHeight };

  let scale = 1;
  const longestSide = Math.max(region.width, region.height);
  const shortestSide = Math.min(region.width, region.height);
  if (longestSide > MAX_IMAGE_SIDE) {
    scale = MAX_IMAGE_SIDE / longestSide;
  } else if (shortestSide < 700) {
    scale = Math.min(3, 700 / shortestSide);
  }

  const width = Math.max(1, Math.round(region.width * scale));
  const height = Math.max(1, Math.round(region.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return canvas;

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    source,
    region.x,
    region.y,
    region.width,
    region.height,
    0,
    0,
    width,
    height
  );

  const image = context.getImageData(0, 0, width, height);
  const pixels = image.data;
  let luminanceSum = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    luminanceSum +=
      0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
  }
  const average = luminanceSum / (pixels.length / 4);
  const invert = average < 110;

  for (let i = 0; i < pixels.length; i += 4) {
    let luminance =
      0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
    if (invert) luminance = 255 - luminance;
    luminance = Math.max(0, Math.min(255, (luminance - 128) * 1.2 + 128));
    pixels[i] = luminance;
    pixels[i + 1] = luminance;
    pixels[i + 2] = luminance;
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

export async function recognizeCard(
  canvas: HTMLCanvasElement,
  onProgress?: (event: OcrProgress) => void,
  signal?: AbortSignal
): Promise<string> {
  const tesseractModule = await import("tesseract.js");
  const tesseract = ((tesseractModule as { default?: Tesseract }).default ??
    tesseractModule) as Tesseract;

  let worker: OcrWorker | null = null;
  const cancel = () => {
    void worker?.terminate().catch(() => {});
  };
  signal?.addEventListener("abort", cancel, { once: true });

  try {
    worker = await tesseract.createWorker("eng", tesseract.OEM.LSTM_ONLY, {
      workerPath: "/ocr/worker.min.js",
      corePath: "/ocr/core",
      langPath: "/ocr",
      gzip: true,
      logger: (event) =>
        onProgress?.({ status: event.status, progress: event.progress }),
    });
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    await worker.setParameters({
      tessedit_pageseg_mode: tesseract.PSM.SPARSE_TEXT,
      preserve_interword_spaces: "1",
    });
    const { data } = await worker.recognize(canvas);
    return data.text ?? "";
  } finally {
    signal?.removeEventListener("abort", cancel);
    await worker?.terminate().catch(() => {});
  }
}
