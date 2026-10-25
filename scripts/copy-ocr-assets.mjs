import { copyFileSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

const root = process.cwd();
const files = [
  ["node_modules/tesseract.js/dist/worker.min.js", "public/ocr/worker.min.js"],
  [
    "node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js",
    "public/ocr/core/tesseract-core-relaxedsimd-lstm.wasm.js",
  ],
  [
    "node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js",
    "public/ocr/core/tesseract-core-simd-lstm.wasm.js",
  ],
  [
    "node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js",
    "public/ocr/core/tesseract-core-lstm.wasm.js",
  ],
  [
    "node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz",
    "public/ocr/eng.traineddata.gz",
  ],
];

let copied = 0;
for (const [source, target] of files) {
  const from = join(root, source);
  try {
    statSync(from);
  } catch {
    throw new Error(`OCR asset missing: ${source}. Run npm install first.`);
  }
  const to = join(root, target);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  copied += 1;
}

console.log(`OCR assets ready (${copied} files in public/ocr).`);
