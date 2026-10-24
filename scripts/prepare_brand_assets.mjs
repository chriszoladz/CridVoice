import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { chromium } from "playwright";

// Mechanical crops of the user's supplied PNG boards. Retained source pixels
// are unchanged; only exact uniform board-background pixels become transparent.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assets = resolve(root, "src/assets/branding");
const definitions = [
  {
    source: "App icon and small sizes.png",
    outputs: [{ name: "app-icon.png", region: [180, 300, 510, 530] }],
  },
  {
    source: "Primary lockup, dark.png",
    outputs: [
      { name: "lockup-dark.png" },
      { name: "mark-dark.png", region: [0, 0, 850, 1440] },
    ],
  },
  {
    source: "Light lockup and mono stacked.png",
    outputs: [
      { name: "lockup-light.png", region: [0, 0, 1200, 1440] },
      { name: "mark-light.png", region: [0, 0, 400, 1440] },
      { name: "lockup-mono-dark.png", region: [1200, 0, 1200, 1440] },
    ],
  },
];
await mkdir(assets, { recursive: true });
const browser = await chromium.launch({ headless: true });
const reports = [];
try {
  const page = await browser.newPage();
  await page.route("**/*", (route) => route.abort());
  for (const definition of definitions) {
    const source = await readFile(resolve(assets, "source", definition.source));
    const outputs = await page.evaluate(
      async ({ source, outputs }) => {
        const image = new Image();
        image.src = `data:image/png;base64,${source}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) throw new Error("Canvas rendering is unavailable");
        ctx.drawImage(image, 0, 0);
        const original = ctx.getImageData(0, 0, canvas.width, canvas.height);
        return outputs.map(({ name, region }) => {
          const [x, y, width, height] = region || [
            0,
            0,
            canvas.width,
            canvas.height,
          ];
          if (x + width > canvas.width || y + height > canvas.height)
            throw new Error("Crop region exceeds its supplied board");
          const bgAt = (y * canvas.width + x) * 4;
          const background = Array.from(original.data.slice(bgAt, bgAt + 4));
          const isBackground = (at) =>
            background.every(
              (value, channel) => original.data[at + channel] === value,
            );
          let left = x + width,
            top = y + height,
            right = -1,
            bottom = -1;
          for (let row = y; row < y + height; row++) {
            for (let col = x; col < x + width; col++) {
              if (!isBackground((row * canvas.width + col) * 4)) {
                left = Math.min(left, col);
                right = Math.max(right, col);
                top = Math.min(top, row);
                bottom = Math.max(bottom, row);
              }
            }
          }
          if (right < left || bottom < top)
            throw new Error("The supplied crop contains no artwork");
          const cropWidth = right - left + 1,
            cropHeight = bottom - top + 1;
          const crop = document.createElement("canvas");
          crop.width = cropWidth;
          crop.height = cropHeight;
          const cropCtx = crop.getContext("2d", { willReadFrequently: true });
          if (!cropCtx) throw new Error("Canvas rendering is unavailable");
          const pixels = ctx.getImageData(left, top, cropWidth, cropHeight);
          let removed = 0,
            retained = 0;
          for (let row = 0; row < cropHeight; row++) {
            for (let col = 0; col < cropWidth; col++) {
              const dst = (row * cropWidth + col) * 4;
              const src = ((top + row) * canvas.width + left + col) * 4;
              if (isBackground(src)) {
                pixels.data[dst + 3] = 0;
                removed++;
              } else {
                retained++;
              }
            }
          }
          cropCtx.putImageData(pixels, 0, 0);
          const saved = cropCtx.getImageData(0, 0, cropWidth, cropHeight);
          let mismatch = 0;
          for (let row = 0; row < cropHeight; row++) {
            for (let col = 0; col < cropWidth; col++) {
              const dst = (row * cropWidth + col) * 4;
              const src = ((top + row) * canvas.width + left + col) * 4;
              if (
                saved.data[dst + 3] > 0 &&
                [0, 1, 2, 3].some(
                  (channel) =>
                    saved.data[dst + channel] !== original.data[src + channel],
                )
              )
                mismatch++;
            }
          }
          if (mismatch !== 0)
            throw new Error("A retained source pixel changed");
          return {
            name,
            boardWidth: canvas.width,
            boardHeight: canvas.height,
            crop: { x: left, y: top, width: cropWidth, height: cropHeight },
            background,
            transparentPixels: removed,
            retainedPixels: retained,
            retainedPixelMismatchCount: mismatch,
            png: crop.toDataURL("image/png").split(",")[1],
          };
        });
      },
      { source: source.toString("base64"), outputs: definition.outputs },
    );
    for (const { png, ...output } of outputs) {
      const bytes = Buffer.from(png, "base64");
      await writeFile(resolve(assets, output.name), bytes);
      reports.push({
        source: definition.source,
        sourceSha256: createHash("sha256").update(source).digest("hex"),
        ...output,
        outputSha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }
  }
  await writeFile(
    resolve(assets, "provenance.json"),
    JSON.stringify(
      {
        origin: "User-supplied CridVoice Logo-png.zip",
        transformation:
          "Tight pixel crop; exact uniform background pixels made transparent; no redraw or recoloring",
        outputs: reports,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify(
      reports.map(({ name, crop, retainedPixelMismatchCount }) => ({
        name,
        ...crop,
        retainedPixelMismatchCount,
      })),
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
