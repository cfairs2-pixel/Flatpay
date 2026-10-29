import { mkdir, copyFile, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
const output = "public/ocr";
await mkdir(path.join(output, "core"), { recursive: true });
await mkdir(path.join(output, "lang"), { recursive: true });
const files = [
  ["node_modules/tesseract.js/dist/worker.min.js", "worker.min.js"],
  [
    "node_modules/tesseract.js/dist/worker.min.js.LICENSE.txt",
    "worker.LICENSE.txt",
  ],
  ["node_modules/tesseract.js-core/LICENSE", "core/LICENSE"],
  [
    "node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz",
    "lang/eng.traineddata.gz",
  ],
];
for (const name of [
  "tesseract-core-lstm.wasm.js",
  "tesseract-core-simd-lstm.wasm.js",
  "tesseract-core-relaxedsimd-lstm.wasm.js",
])
  files.push([`node_modules/tesseract.js-core/${name}`, `core/${name}`]);
const manifest = {
  engine: "tesseract.js@7.0.0",
  language: "@tesseract.js-data/eng@1.0.0/4.0.0_best_int",
  files: [],
};
for (const [source, target] of files) {
  const destination = path.join(output, target);
  await copyFile(source, destination);
  const bytes = await readFile(destination);
  manifest.files.push({
    path: target,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}
await writeFile(
  path.join(output, "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
await writeFile(
  path.join(output, "NOTICE.txt"),
  "On-device OCR uses Tesseract.js 7.0.0 and Tesseract.js-core under Apache-2.0. English trained data is from @tesseract.js-data/eng 1.0.0.\nSources: https://github.com/naptha/tesseract.js ; https://github.com/naptha/tesseract.js-core ; https://github.com/naptha/tessdata\nPhotos and recognised text are not transmitted by this reader.\n",
);
console.log("Prepared local document-reader assets.");
