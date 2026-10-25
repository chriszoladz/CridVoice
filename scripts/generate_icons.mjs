import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

// Resize the mechanically cropped, user-supplied app icon. No redrawing,
// recoloring, external fonts or network requests are involved.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const branding = resolve(root, "src/assets/branding");
const source = `data:image/png;base64,${(await readFile(resolve(branding, "app-icon.png"))).toString("base64")}`;
const icons = resolve(root, "src-tauri/icons");
await mkdir(icons, { recursive: true });

function dib(size, rgba) {
  const rowBytes = size * 4;
  const maskRowBytes = Math.ceil(size / 32) * 4;
  const result = Buffer.alloc(40 + rowBytes * size + maskRowBytes * size);
  result.writeUInt32LE(40, 0);
  result.writeInt32LE(size, 4);
  result.writeInt32LE(size * 2, 8);
  result.writeUInt16LE(1, 12);
  result.writeUInt16LE(32, 14);
  result.writeUInt32LE(rowBytes * size, 20);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const src = (y * size + x) * 4;
      const dst = 40 + ((size - y - 1) * size + x) * 4;
      result[dst] = rgba[src + 2];
      result[dst + 1] = rgba[src + 1];
      result[dst + 2] = rgba[src];
      result[dst + 3] = rgba[src + 3];
      if (rgba[src + 3] < 128) {
        const mask = 40 + rowBytes * size + (size - y - 1) * maskRowBytes;
        result[mask + (x >> 3)] |= 1 << (7 - (x & 7));
      }
    }
  }
  return result;
}

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  await page.route("**/*", (route) => route.abort());
  const frames = [];
  for (const size of [16, 20, 24, 32, 40, 48, 64, 128, 256]) {
    const rendered = await page.evaluate(
      async ({ source, size }) => {
        const image = new Image();
        image.src = source;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas rendering is unavailable");
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(image, 0, 0, size, size);
        return {
          png: canvas.toDataURL("image/png").split(",")[1],
          rgba: Array.from(ctx.getImageData(0, 0, size, size).data),
        };
      },
      { source, size },
    );
    const png = Buffer.from(rendered.png, "base64");
    if (size === 256) await writeFile(resolve(icons, "icon.png"), png);
    // Small ICO entries use classic 32-bit DIBs for Windows resource tooling.
    // The 256px entry uses PNG compression, as supported by modern Windows.
    frames.push({ size, data: size === 256 ? png : dib(size, rendered.rgba) });
  }
  const directory = Buffer.alloc(6 + frames.length * 16);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(frames.length, 4);
  let offset = directory.length;
  frames.forEach(({ size, data }, index) => {
    const entry = 6 + index * 16;
    directory[entry] = directory[entry + 1] = size === 256 ? 0 : size;
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(data.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  await writeFile(
    resolve(icons, "icon.ico"),
    Buffer.concat([directory, ...frames.map(({ data }) => data)]),
  );

  const previewArg = process.argv.indexOf("--preview");
  if (previewArg >= 0) {
    const preview = process.argv[previewArg + 1];
    if (!preview) throw new Error("--preview requires an output PNG path");
    const examples = [16, 20, 32, 64, 256]
      .map(
        (size) =>
          `<div class="sample"><img width="${size}" height="${size}" src="${source}"><span>${size} px</span></div>`,
      )
      .join("");
    const lockupDark = `data:image/png;base64,${(await readFile(resolve(branding, "lockup-dark.png"))).toString("base64")}`;
    const lockupLight = `data:image/png;base64,${(await readFile(resolve(branding, "lockup-light.png"))).toString("base64")}`;
    const markDark = `data:image/png;base64,${(await readFile(resolve(branding, "mark-dark.png"))).toString("base64")}`;
    const markLight = `data:image/png;base64,${(await readFile(resolve(branding, "mark-light.png"))).toString("base64")}`;
    await page.setViewportSize({ width: 760, height: 600 });
    await page.setContent(
      `<!doctype html><html><meta charset="utf-8"><style>body{margin:0;background:#f5f2ec;color:#252a30;font:14px Arial,sans-serif}main{padding:32px}h1{font-size:20px;font-weight:600;margin:0 0 24px}.samples{display:flex;gap:24px;align-items:center}.sample{display:flex;flex-direction:column;align-items:center;gap:16px}.ui{margin-top:24px;padding:24px;display:flex;align-items:center;gap:32px;border-top:1px solid #c9c5be}.ui .mark{width:38px;height:auto}.ui .lockup{width:350px;height:auto}.dark{background:#202126;color:#eeeae3}</style><main><h1>CridVoice supplied icon and lockups</h1><div class="samples">${examples}</div><div class="ui"><img class="mark" src="${markLight}"><img class="lockup" src="${lockupLight}"></div><div class="ui dark"><img class="mark" src="${markDark}"><img class="lockup" src="${lockupDark}"></div></main></html>`,
    );
    await page.locator("img").evaluateAll(async (images) => {
      await Promise.all(images.map((image) => image.decode()));
    });
    await mkdir(dirname(resolve(preview)), { recursive: true });
    await page.screenshot({ path: resolve(preview), fullPage: true });
  }
  console.log(
    "Generated supplied CridVoice 256px PNG and nine-size Windows ICO.",
  );
} finally {
  await browser.close();
}
