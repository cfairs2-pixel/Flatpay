import "./prepare-ocr.mjs";
import { spawnSync } from "node:child_process";
import { readFile, writeFile, mkdir, copyFile, cp } from "node:fs/promises";
import path from "node:path";
const result = spawnSync(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "build",
    "--mode",
    "pages",
    "--base",
    "./",
    "--outDir",
    "dist-pages",
  ],
  { stdio: "inherit" },
);
if (result.status !== 0) process.exit(result.status ?? 1);
let html = await readFile("dist-pages/index.html", "utf8");
const scriptMatch = html.match(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/);
const cssMatch = html.match(/<link\b[^>]*href="([^"]+\.css)"[^>]*>/);
if (!scriptMatch || !cssMatch)
  throw Error("Expected a built JS and CSS entrypoint.");
const js = await readFile(path.join("dist-pages", scriptMatch[1]), "utf8");
const css = await readFile(path.join("dist-pages", cssMatch[1]), "utf8");
html = html
  .replace(
    scriptMatch[0],
    () =>
      `<script type="module">${js.replace(/<\/script/gi, "<\\/script")}</script>`,
  )
  .replace(cssMatch[0], () => `<style>${css}</style>`);
html = html.replace(/<link\b[^>]*rel="modulepreload"[^>]*>/g, "");
await mkdir("work/pages-site", { recursive: true });
await writeFile("work/pages-site/index.html", html);
await writeFile("work/pages-site/.nojekyll", "");
await copyFile("public/favicon.svg", "work/pages-site/favicon.svg");
await cp("public/ocr", "work/pages-site/ocr", { recursive: true });
await cp("public/statement-reader", "work/pages-site/statement-reader", {
  recursive: true,
});
console.log(
  `Prepared self-contained myflatpay Pages build (${Buffer.byteLength(html)} bytes).`,
);
