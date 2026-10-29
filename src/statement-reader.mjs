import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/build/pdf.mjs";
import { createWorker } from "tesseract.js";

const MAX_BYTES = 25 * 1024 * 1024;
const MAX_PAGES = 20;
const MAX_TEXT = 200000;
const MAX_EDGE = 2200;

const abortError = () =>
  new DOMException("Statement reading cancelled.", "AbortError");
const safely = async (callback) => {
  try {
    await callback?.();
  } catch {
    // Cleanup must not obscure the original failure or an explicit cancellation.
  }
};

/** Keep text from the same PDF baseline together, including table amounts. */
function linesFromPdf(items) {
  const rows = [];
  for (const item of items) {
    if (typeof item.str !== "string" || !item.str.trim()) continue;
    const x = Number(item.transform?.[4] || 0);
    const y = Number(item.transform?.[5] || 0);
    const tolerance = Math.max(
      2,
      Math.min(4, Math.abs(item.height || 10) * 0.2),
    );
    let row = rows.find((candidate) => Math.abs(candidate.y - y) <= tolerance);
    if (!row) {
      row = { y, items: [] };
      rows.push(row);
    }
    row.items.push({ x, text: item.str });
  }
  return rows
    .sort((a, b) => b.y - a.y)
    .map((row) =>
      row.items
        .sort((a, b) => a.x - b.x)
        .map((item) => item.text)
        .join("  ")
        .trim(),
    )
    .join("\n");
}

function localAssets(directory) {
  const base = new URL(import.meta.env.BASE_URL || "./", window.location.href);
  const url = new URL(directory, base);
  if (url.origin !== window.location.origin)
    throw new Error(
      "The statement reader must use assets hosted with this app.",
    );
  return url.href;
}

async function imageCanvas(file, race, signal) {
  let bitmap;
  let objectUrl;
  try {
    if (typeof createImageBitmap === "function") {
      try {
        const pendingBitmap = createImageBitmap(file, {
          imageOrientation: "from-image",
        });
        pendingBitmap.then(
          (created) => {
            if (signal?.aborted) created.close();
          },
          () => {},
        );
        bitmap = await race(pendingBitmap);
      } catch (error) {
        if (error.name === "AbortError") throw error;
      }
    }
    if (!bitmap) {
      objectUrl = URL.createObjectURL(file);
      const image = new Image();
      image.src = objectUrl;
      await race(image.decode());
      bitmap = image;
    }
    const width = bitmap.width || bitmap.naturalWidth;
    const height = bitmap.height || bitmap.naturalHeight;
    if (!(width > 0 && height > 0))
      throw new Error("Image has no readable dimensions.");
    const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context)
      throw new Error("This browser cannot prepare the statement photo.");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    bitmap?.close?.();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Read a merchant statement entirely on the device. The returned text is transient:
 * callers must persist only reviewed, whitelisted figures, never the source file.
 */
export async function readMerchantStatement(file, { onProgress, signal } = {}) {
  if (!file || typeof file.arrayBuffer !== "function")
    throw new Error("Choose a merchant statement PDF or a clear photo.");
  if (file.size > MAX_BYTES)
    throw new Error(
      "Choose a statement under 25 MB, or split the PDF into smaller files.",
    );
  if (signal?.aborted) throw abortError();
  const pdf =
    file.type === "application/pdf" || /\.pdf$/i.test(file.name || "");
  if (
    !pdf &&
    !/^image\//i.test(file.type || "") &&
    !/\.(png|jpe?g|webp|bmp|gif|avif|heic|heif)$/i.test(file.name || "")
  )
    throw new Error("Choose a PDF or a statement photo, such as JPEG or PNG.");

  let worker;
  let loadingTask;
  let document;
  let rendering;
  let currentPage = 1;
  let pageCount = 1;
  let active = true;
  let rejectAbort;
  const cancelled = new Promise((_, reject) => {
    rejectAbort = reject;
  });
  // A cancellation can arrive between awaited operations; keep its rejection handled.
  cancelled.catch(() => {});
  const abort = () => {
    rejectAbort(abortError());
    rendering?.cancel();
    void safely(() => worker?.terminate());
    void safely(() => loadingTask?.destroy());
  };
  signal?.addEventListener("abort", abort, { once: true });
  const race = (promise) => {
    if (signal?.aborted) return Promise.reject(abortError());
    return Promise.race([promise, cancelled]);
  };
  const progress = (status, percent) => {
    if (active && !signal?.aborted)
      onProgress?.(status, Math.max(0, Math.min(100, Math.round(percent))));
  };
  const warnings = [];
  async function recognise(canvas) {
    if (!worker) {
      progress(
        "Starting the on-device statement reader",
        ((currentPage - 1) / pageCount) * 100,
      );
      const assets = localAssets("ocr/");
      const pendingWorker = createWorker("eng", 1, {
        workerPath: `${assets}worker.min.js`,
        corePath: `${assets}core/`,
        langPath: `${assets}lang/`,
        workerBlobURL: false,
        legacyCore: false,
        gzip: true,
        logger(update) {
          if (/recogniz/i.test(update.status || ""))
            progress(
              `Reading page ${currentPage} of ${pageCount}`,
              ((currentPage - 1 + (update.progress || 0)) / pageCount) * 100,
            );
        },
      });
      pendingWorker.then(
        (created) => {
          if (!active || signal?.aborted)
            void safely(() => created.terminate());
        },
        () => {},
      );
      worker = await race(pendingWorker);
      await race(
        worker.setParameters({
          preserve_interword_spaces: "1",
          user_defined_dpi: "300",
        }),
      );
    }
    const result = await race(worker.recognize(canvas));
    return typeof result.data?.text === "string" ? result.data.text : "";
  }
  try {
    let text = "";
    if (pdf) {
      const assets = localAssets("statement-reader/");
      GlobalWorkerOptions.workerSrc = `${assets}pdf.worker.min.mjs`;
      progress("Opening your PDF on this device", 0);
      const data = new Uint8Array(await race(file.arrayBuffer()));
      loadingTask = getDocument({
        data,
        cMapUrl: `${assets}cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `${assets}standard_fonts/`,
        wasmUrl: `${assets}wasm/`,
        useWorkerFetch: true,
        isEvalSupported: false,
        enableXfa: false,
        disableAutoFetch: true,
        disableStream: true,
      });
      document = await race(loadingTask.promise);
      pageCount = document.numPages;
      if (pageCount > MAX_PAGES)
        throw new Error(
          "This PDF has more than 20 pages. Upload just the statement pages you need, up to 20 at a time.",
        );
      const pages = [];
      for (currentPage = 1; currentPage <= pageCount; currentPage += 1) {
        progress(
          `Reading page ${currentPage} of ${pageCount}`,
          ((currentPage - 1) / pageCount) * 100,
        );
        const page = await race(document.getPage(currentPage));
        let canvas;
        try {
          const content = await race(page.getTextContent());
          let pageText = linesFromPdf(content.items);
          // Image-only statements, including a small scanner footer, need OCR.
          if (pageText.replace(/\s/g, "").length < 40) {
            const original = page.getViewport({ scale: 1 });
            const viewport = page.getViewport({
              scale: Math.min(
                3,
                MAX_EDGE / Math.max(original.width, original.height),
              ),
            });
            canvas = globalThis.document.createElement("canvas");
            canvas.width = Math.max(1, Math.ceil(viewport.width));
            canvas.height = Math.max(1, Math.ceil(viewport.height));
            const context = canvas.getContext("2d");
            if (!context)
              throw new Error(
                "This browser cannot read scanned PDF pages. Try a photo instead.",
              );
            rendering = page.render({
              canvas,
              canvasContext: context,
              viewport,
              background: "rgb(255,255,255)",
            });
            await race(rendering.promise);
            rendering = null;
            pageText = await recognise(canvas);
            if (
              !warnings.includes(
                "Some pages were read from images. Check every suggested figure against the statement.",
              )
            )
              warnings.push(
                "Some pages were read from images. Check every suggested figure against the statement.",
              );
          }
          pages.push(pageText.trim());
          if (pages.reduce((sum, value) => sum + value.length, 0) > MAX_TEXT)
            throw new Error(
              "This statement contains too much text. Upload only its summary and fee pages.",
            );
        } finally {
          if (canvas) canvas.width = canvas.height = 0;
          page.cleanup();
        }
      }
      text = pages.join("\n\n");
    } else {
      progress("Preparing your statement photo", 0);
      let canvas;
      try {
        canvas = await imageCanvas(file, race, signal);
        text = await recognise(canvas);
      } finally {
        if (canvas) canvas.width = canvas.height = 0;
      }
      warnings.push(
        "Figures read from a photo can contain mistakes. Check every suggestion against the statement.",
      );
    }
    if (text.length > MAX_TEXT)
      throw new Error(
        "This statement contains too much text. Upload only its summary and fee pages.",
      );
    if (!text.trim())
      throw new Error(
        "No readable text was found. Try a sharper photo or paste text copied from the original statement.",
      );
    progress("Statement read. Review the figures below.", 100);
    return { text, pageCount, warnings };
  } catch (error) {
    if (signal?.aborted || error.name === "AbortError") throw abortError();
    if (error.name === "PasswordException")
      throw new Error(
        "This PDF is password protected. Open it yourself and upload an unlocked copy or a photo of its summary pages.",
      );
    if (
      [
        "InvalidPDFException",
        "MissingPDFException",
        "UnexpectedResponseException",
      ].includes(error.name)
    )
      throw new Error(
        "This PDF could not be opened. Download a fresh copy from the provider or photograph its summary pages.",
      );
    if (!pdf && /decode|image|bitmap|format/i.test(error.message || ""))
      throw new Error(
        "This photo format could not be read. Try JPEG or PNG, or take another photo with the whole page visible.",
      );
    throw error;
  } finally {
    active = false;
    signal?.removeEventListener("abort", abort);
    rendering?.cancel();
    await safely(() => worker?.terminate());
    await safely(() =>
      document ? document.destroy() : loadingTask?.destroy(),
    );
  }
}
