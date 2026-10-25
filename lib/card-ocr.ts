/**
 * On-device card OCR. Images are drawn to a local canvas and passed straight
 * to a WebAssembly worker; nothing is uploaded.
 */

import type TesseractNamespace from "tesseract.js";
import { parseCardText } from "./card-scan.ts";

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
export function centerCardCrop(width: number, height: number, viewWidth = width, viewHeight = height): ScanCrop {
  // The preview uses object-fit: cover; map its guide back to source pixels.
  const coverScale = Math.max(viewWidth / width, viewHeight / height);
  const visibleWidth = viewWidth / coverScale;
  const visibleHeight = viewHeight / coverScale;
  const cropWidth = visibleWidth * 0.86;
  const cropHeight = Math.min(visibleHeight * 0.94, cropWidth / CARD_ASPECT);
  return {
    x: (width - cropWidth) / 2,
    y: (height - cropHeight) / 2,
    width: cropWidth,
    height: cropHeight,
  };
}

/** Keep the original colors for the first OCR pass; preprocessing can erase thin text. */
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
  if (!context) throw new Error("Could not prepare card image.");

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

  return canvas;
}

/** Contrast-normalized fallback, using percentiles so glare does not dominate. */
export function enhanceCardCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Could not prepare card image.");
  context.drawImage(source, 0, 0);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = image.data;
  const histogram = new Uint32Array(256);
  let luminanceSum = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const luminance = Math.round(0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2]);
    luminanceSum += luminance;
    histogram[luminance]++;
  }
  const average = luminanceSum / (pixels.length / 4);
  const invert = average < 110;
  const percentile = (fraction: number) => {
    let count = 0;
    for (let value = 0; value < 256; value++) {
      count += histogram[value];
      if (count >= pixels.length / 4 * fraction) return value;
    }
    return 255;
  };
  const low = percentile(0.02);
  const range = Math.max(32, percentile(0.98) - low);

  for (let i = 0; i < pixels.length; i += 4) {
    let luminance =
      0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
    luminance = Math.max(0, Math.min(255, (luminance - low) * 255 / range));
    if (invert) luminance = 255 - luminance;
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
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
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
    const first = (await worker.recognize(canvas)).data;
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    const score = (text: string, confidence: number) => {
      const card = parseCardText(text);
      if (!card) return confidence / 100;
      return (card.number ? 3 : 0) + (card.numberValid ? 5 : 0) +
        (card.holder ? 2 : 0) + (card.expiryMonth ? 1 : 0) + (card.issuer ? 1 : 0) + confidence / 100;
    };
    const parsed = parseCardText(first.text);
    if (first.confidence >= 85 && parsed?.numberValid && parsed.holder && parsed.expiryMonth) return first.text;
    await worker.setParameters({ tessedit_pageseg_mode: tesseract.PSM.AUTO });
    const second = (await worker.recognize(enhanceCardCanvas(canvas))).data;
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    return score(second.text, second.confidence) > score(first.text, first.confidence) ? second.text : first.text;
  } finally {
    signal?.removeEventListener("abort", cancel);
    await worker?.terminate().catch(() => {});
  }
}
