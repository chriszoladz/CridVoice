import { readFile, writeFile, mkdir } from "node:fs/promises";
import { marked } from "marked";
const [lightLogo, darkLogo] = await Promise.all(
  ["light", "dark"].map(async (mode) => {
    const png = await readFile(
      new URL(`../src/assets/branding/lockup-${mode}.png`, import.meta.url),
    );
    return {
      src: `data:image/png;base64,${png.toString("base64")}`,
      width: png.readUInt32BE(16),
      height: png.readUInt32BE(20),
    };
  }),
);
const guides = [
  "USER-GUIDE",
  "MODELS",
  "PROVIDERS",
  "PRIVACY",
  "CONFIGURATION",
  "ARCHITECTURE",
  "DEVELOPMENT",
  "RELEASING",
  "WINDOWS-TESTING",
  "TROUBLESHOOTING",
  "SECURITY-REVIEW-2026-10-24",
  "QUICKSTART-PL",
  "VALIDATION",
  "WINDOWS-VALIDATION-2026-10-13",
];
const sections = await Promise.all(
  guides.map(async (id) => {
    const markdown = await readFile(
      new URL(`../docs/${id}.md`, import.meta.url),
      "utf8",
    );
    return {
      id,
      title: markdown.split("\n")[0].replace(/^# /, ""),
      html: marked
        .parse(markdown)
        .replace(
          /href="(?:\.\/)?(?:docs\/)?([A-Z0-9-]+)\.md"/g,
          (_, name) => `href="#${name}"`,
        ),
    };
  }),
);
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CridVoice documentation</title><style>
:root{color-scheme:light dark;font-family:"Segoe UI",system-ui,sans-serif;--background:#fafafa;--text:#202124;--muted:#565a60;--border:#d5d8dc;--surface:#f0f1f3;--link:#245e94}
*{box-sizing:border-box}body{margin:0;background:var(--background);color:var(--text);line-height:1.65}a{color:var(--link)}a:focus-visible{outline:2px solid var(--link);outline-offset:3px}
aside{position:fixed;width:250px;padding:24px 20px;inset:0 auto 0 0;border-right:1px solid var(--border);overflow:auto}.doc-brand img{display:block;width:210px;max-width:100%;height:auto}aside small{display:block;color:var(--muted);margin:12px 0 20px}aside a{display:block;text-decoration:none;padding:8px 0;font-size:13px}aside a:hover{text-decoration:underline}
main{margin-left:250px;max-width:1060px;padding:28px 36px}article{padding:12px 0 40px;border-bottom:1px solid var(--border);scroll-margin-top:20px}h1{font-size:28px;line-height:1.3;font-weight:600}h2{font-size:21px;margin-top:28px;font-weight:600}h3{font-size:17px}p,li{color:var(--muted);font-size:15px}
table{border-collapse:collapse;width:100%;table-layout:fixed;font-size:13px}th,td{padding:10px;text-align:left;border:1px solid var(--border);overflow-wrap:anywhere}th{background:var(--surface)}pre{overflow:auto;padding:16px;border:1px solid var(--border);border-radius:3px;background:var(--surface)}code{font-family:Consolas,monospace;font-size:13px}blockquote{border-left:2px solid var(--border);margin-left:0;padding-left:16px}
@media(max-width:850px){aside{position:static;width:auto;border-right:0;border-bottom:1px solid var(--border)}main{margin:0;padding:20px}}
@media(prefers-color-scheme:dark){:root{--background:#17191c;--text:#e5e7eb;--muted:#b6bbc3;--border:#383d44;--surface:#20242a;--link:#9bbdde}}
</style><aside aria-label="Documentation navigation"><picture class="doc-brand"><source media="(prefers-color-scheme:dark)" type="image/png" srcset="${darkLogo.src}" width="${darkLogo.width}" height="${darkLogo.height}"><img src="${lightLogo.src}" width="${lightLogo.width}" height="${lightLogo.height}" alt="CridVoice"></picture><small>Offline documentation</small>${sections.map((s) => `<a href="#${s.id}">${s.title}</a>`).join("")}</aside><main>${sections.map((s) => `<article id="${s.id}">${s.html}</article>`).join("")}</main></html>`;
await mkdir(new URL("../src-tauri/resources/help/", import.meta.url), {
  recursive: true,
});
await writeFile(
  new URL("../src-tauri/resources/help/index.html", import.meta.url),
  html,
);
console.log("Built offline documentation.");
