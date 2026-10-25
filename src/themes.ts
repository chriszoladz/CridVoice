import type { Settings } from "./types";

export const themes = [
  {
    id: "violet",
    name: "Amethyst",
    accent: "#a78bfa",
    dark: "#101014",
    light: "#f8f7fc",
    description: "Purple",
  },
  {
    id: "ocean",
    name: "Ocean",
    accent: "#38bdf8",
    dark: "#0c141b",
    light: "#f3f9fc",
    description: "Blue",
  },
  {
    id: "forest",
    name: "Forest",
    accent: "#4ade80",
    dark: "#101813",
    light: "#f5faf5",
    description: "Green",
  },
  {
    id: "rose",
    name: "Rose",
    accent: "#fb7185",
    dark: "#191114",
    light: "#fff7f8",
    description: "Rose",
  },
  {
    id: "amber",
    name: "Ember",
    accent: "#fbbf24",
    dark: "#19160f",
    light: "#fffbf2",
    description: "Amber",
  },
  {
    id: "mono",
    name: "Graphite",
    accent: "#cbd5e1",
    dark: "#121315",
    light: "#f7f8fa",
    description: "Gray",
  },
  {
    id: "indigo",
    name: "Midnight",
    accent: "#818cf8",
    dark: "#10121e",
    light: "#f5f6ff",
    description: "Indigo",
  },
  {
    id: "teal",
    name: "Lagoon",
    accent: "#2dd4bf",
    dark: "#0c1918",
    light: "#f2fcfa",
    description: "Teal",
  },
];

type Appearance = Settings["appearance"];
type ColorMode = "dark" | "light";

function mix(color: string, target: string, amount: number): string {
  return `#${[1, 3, 5]
    .map((offset) => {
      const source = parseInt(color.slice(offset, offset + 2), 16);
      const destination = parseInt(target.slice(offset, offset + 2), 16);
      return Math.round(source + (destination - source) * amount)
        .toString(16)
        .padStart(2, "0");
    })
    .join("")}`;
}

function luminance(color: string): number {
  const [red, green, blue] = [1, 3, 5].map((offset) => {
    const channel = parseInt(color.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

export function colorContrast(first: string, second: string): number {
  const a = luminance(first),
    b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function readableAccent(
  accent: string,
  backgrounds: string[],
  dark: boolean,
): string {
  const target = dark ? "#ffffff" : "#000000";
  for (let step = 0; step <= 20; step += 1) {
    const candidate = mix(accent, target, step / 20);
    if (
      backgrounds.every(
        (background) => colorContrast(candidate, background) >= 4.5,
      )
    )
      return candidate;
  }
  return target;
}

export function resolveAppearance(appearance: Appearance, systemDark: boolean) {
  const preset =
    themes.find((theme) => theme.id === appearance.theme) || themes[0];
  const dark =
    appearance.mode === "dark" || (appearance.mode === "system" && systemDark);
  const mode: ColorMode = dark ? "dark" : "light";
  const background = dark ? preset.dark : preset.light;
  const surface = mix(background, "#ffffff", dark ? 0.045 : 0.3);
  const raised = mix(
    background,
    dark ? "#ffffff" : "#16141e",
    dark ? 0.065 : 0.025,
  );
  const hover = mix(
    background,
    dark ? "#ffffff" : "#16141e",
    dark ? 0.09 : 0.05,
  );
  const accent = /^#[0-9a-f]{6}$/i.test(appearance.accent)
    ? appearance.accent
    : preset.accent;
  const accentText = readableAccent(
    accent,
    [background, surface, raised, hover],
    dark,
  );
  const accentForeground =
    colorContrast(accent, "#15101f") >= 4.5
      ? "#15101f"
      : colorContrast(accent, "#ffffff") >= 4.5
        ? "#ffffff"
        : "#000000";
  const variables: Record<string, string> = {
    "--background": background,
    "--surface": surface,
    "--surface-raised": raised,
    "--surface-hover": hover,
    "--text": dark ? "#f0eff5" : "#24222e",
    "--muted": mix(
      background,
      dark ? "#ffffff" : "#000000",
      dark ? 0.61 : 0.56,
    ),
    "--faint": mix(background, dark ? "#ffffff" : "#000000", dark ? 0.5 : 0.56),
    "--border": mix(
      background,
      dark ? "#ffffff" : "#16141e",
      dark ? 0.12 : 0.105,
    ),
    "--accent": accent,
    "--accent-text": accentText,
    "--accent-foreground": accentForeground,
    "--accent-wash": `color-mix(in srgb, ${accentText} 12%, transparent)`,
    "--green": dark ? "#7bcda1" : "#247a4c",
    "--amber": dark ? "#eac381" : "#8f6518",
    "--red": dark ? "#f58c95" : "#c64255",
    "--shadow": dark ? "0 6px 24px #0003" : "0 6px 24px #00000016",
    "--font-scale": String(
      Number.isFinite(appearance.fontScale)
        ? Math.min(1.4, Math.max(0.85, appearance.fontScale))
        : 1,
    ),
  };
  return { mode, variables };
}

export function applyAppearance(
  root: HTMLElement,
  appearance: Appearance,
  systemDark: boolean,
) {
  const resolved = resolveAppearance(appearance, systemDark);
  root.dataset.mode = resolved.mode;
  for (const [name, value] of Object.entries(resolved.variables))
    root.style.setProperty(name, value);
  return resolved;
}
