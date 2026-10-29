import {
  mkdir,
  copyFile,
  cp,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const source = "node_modules/pdfjs-dist";
const output = "public/statement-reader";
await mkdir(output, { recursive: true });
await copyFile(
  path.join(source, "build/pdf.worker.min.mjs"),
  path.join(output, "pdf.worker.min.mjs"),
);
await copyFile(path.join(source, "LICENSE"), path.join(output, "LICENSE"));
for (const directory of ["cmaps", "standard_fonts", "wasm"])
  await cp(path.join(source, directory), path.join(output, directory), {
    recursive: true,
  });

const manifest = { engine: "pdfjs-dist@5.4.296", files: [] };
async function collect(directory, relative = "") {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const next = path.join(directory, entry.name);
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await collect(next, name);
    else if (!["manifest.json", "NOTICE.txt"].includes(name)) {
      const bytes = await readFile(next);
      manifest.files.push({
        path: name,
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }
  }
}
await collect(output);
manifest.files.sort((a, b) => a.path.localeCompare(b.path));
await writeFile(
  path.join(output, "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
await writeFile(
  path.join(output, "NOTICE.txt"),
  "Local PDF reading uses Mozilla PDF.js (pdfjs-dist 5.4.296), under Apache-2.0. Bundled font and decoder notices are preserved in their respective directories. Source: https://github.com/mozilla/pdf.js\nStatement files and extracted text are processed on-device, not uploaded by the reader. Image OCR uses the app's separately hosted Tesseract assets.\n",
);
console.log("Prepared local merchant-statement PDF reader assets.");
