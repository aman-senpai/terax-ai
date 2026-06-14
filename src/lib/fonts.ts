const NERD_FONT_CANDIDATES = [
  // Mono variants first — proportional siblings cause distorted terminal text.
  "JetBrainsMono Nerd Font Mono",
  "JetBrainsMonoNL Nerd Font Mono",
  "FiraCode Nerd Font Mono",
  "Hack Nerd Font Mono",
  "CaskaydiaCove Nerd Font Mono",
  "IosevkaTerm Nerd Font Mono",
  "SauceCodePro Nerd Font Mono",
  "MesloLGL Nerd Font Mono",
  "MesloLGM Nerd Font Mono",
  "MesloLGS Nerd Font Mono",
  "MesloLGMDZ Nerd Font Mono",
  "MesloLGLDZ Nerd Font Mono",
  "MesloLGSDZ Nerd Font Mono",
  // Proportional variants — only matched if no Mono is available.
  "JetBrainsMono Nerd Font",
  "FiraCode Nerd Font",
  "MesloLGS NF",
  "MesloLGM Nerd Font",
  "Hack Nerd Font",
  "CaskaydiaCove Nerd Font",
  "Iosevka Nerd Font",
  "SauceCodePro Nerd Font",
  "Hasklug Nerd Font",
];

const FALLBACK_CHAIN = [
  // Nerd Fonts — CSS font-family will use the first one installed.
  '"FiraCode Nerd Font Mono"',
  '"JetBrainsMono Nerd Font Mono"',
  '"Hack Nerd Font Mono"',
  '"CaskaydiaCove Nerd Font Mono"',
  '"MesloLGM Nerd Font Mono"',
  '"MesloLGS Nerd Font Mono"',
  // System monospace stack.
  '"JetBrains Mono"',
  "SFMono-Regular",
  "Menlo",
  "monospace",
].join(", ");

let detected: string | null = null;
let monoReady: Promise<void> | null = null;

export function ensureMonoFontsLoaded(): Promise<void> {
  if (monoReady) return monoReady;
  if (typeof document === "undefined" || !document.fonts?.load) {
    monoReady = Promise.resolve();
    return monoReady;
  }
  const LOAD_SPEC = "400 14px";
  const loads: Promise<unknown>[] = [
    document.fonts.load(`${LOAD_SPEC} "JetBrains Mono"`),
    document.fonts.load(`700 14px "JetBrains Mono"`),
  ];
  // Pre-warm the first available Nerd Font so document.fonts.check() succeeds.
  for (const f of NERD_FONT_CANDIDATES.slice(0, 5)) {
    loads.push(document.fonts.load(`${LOAD_SPEC} "${f}"`));
  }
  monoReady = Promise.allSettled(loads).then(() => undefined);
  return monoReady;
}

export function detectMonoFontFamily(): string {
  if (detected) return detected;
  if (typeof document === "undefined" || !document.fonts) {
    detected = FALLBACK_CHAIN;
    return detected;
  }
  for (const f of NERD_FONT_CANDIDATES) {
    try {
      if (document.fonts.check(`12px "${f}"`)) {
        detected = `"${f}", ${FALLBACK_CHAIN}`;
        return detected;
      }
    } catch {
      // Some browsers throw on invalid font shorthand; ignore.
    }
  }
  detected = FALLBACK_CHAIN;
  return detected;
}
