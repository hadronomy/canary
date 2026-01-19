import type { BaseKey, KeyBinding, KeyCombo, Modifier, ModifierOrder } from "./types";

const MODIFIER_ORDER: ModifierOrder = ["ctrl", "meta", "super", "shift", "alt"];

const MODIFIER_ALIASES: Record<string, Modifier> = {
  ctrl: "ctrl",
  control: "ctrl",
  cmd: "meta",
  command: "meta",
  meta: "meta",
  super: "super",
  shift: "shift",
  alt: "alt",
  option: "alt",
};

export function isValidBaseKey(value: string): value is BaseKey {
  return (
    value.length === 1 ||
    value === "enter" ||
    value === "escape" ||
    value === "esc" ||
    value === "tab" ||
    value === "backspace" ||
    value === "delete" ||
    value === "space" ||
    value === "up" ||
    value === "down" ||
    value === "left" ||
    value === "right" ||
    value === "pageup" ||
    value === "pagedown" ||
    value === "home" ||
    value === "end" ||
    value === "f1" ||
    value === "f2" ||
    value === "f3" ||
    value === "f4" ||
    value === "f5" ||
    value === "f6" ||
    value === "f7" ||
    value === "f8" ||
    value === "f9" ||
    value === "f10" ||
    value === "f11" ||
    value === "f12"
  );
}

export function normalizeCombo(input: string): KeyCombo | null {
  const tokens = input
    .split("+")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);

  if (tokens.includes("?")) {
    return "?" as KeyCombo;
  }

  const modifiers: Modifier[] = [];
  let key: string | null = null;

  for (const token of tokens) {
    const modifier = MODIFIER_ALIASES[token];
    if (modifier) {
      if (!modifiers.includes(modifier)) modifiers.push(modifier);
      continue;
    }
    key = token;
  }

  if (!key || !isValidBaseKey(key)) return null;

  const ordered = MODIFIER_ORDER.filter((modifier) => modifiers.includes(modifier));
  const combo = ordered.length ? `${ordered.join("+")}+${key}` : key;
  return combo as KeyCombo;
}

export function parseKeyCombo(combo: KeyCombo): KeyBinding {
  const normalized = normalizeCombo(combo);
  const fallback = normalized ?? combo;
  const tokens = fallback
    .split("+")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);

  const modifiers = new Set<Modifier>();
  let key: BaseKey = tokens[tokens.length - 1] as BaseKey;

  for (const token of tokens.slice(0, -1)) {
    const modifier = MODIFIER_ALIASES[token];
    if (modifier) modifiers.add(modifier);
  }

  return {
    raw: fallback as KeyCombo,
    key,
    ctrl: modifiers.has("ctrl"),
    meta: modifiers.has("meta"),
    super: modifiers.has("super"),
    shift: modifiers.has("shift"),
    alt: modifiers.has("alt"),
  };
}

export function parseComboList(bindings: KeyCombo[]): KeyBinding[] {
  return bindings.map(parseKeyCombo);
}

export function stringifyComboList(bindings: KeyCombo[]): string {
  return bindings.map(formatKeyCombo).join(" / ");
}

export function formatKeyCombo(combo: KeyCombo): string {
  return formatKeyBinding(parseKeyCombo(combo));
}

export function formatKeyBinding(binding: KeyBinding): string {
  const parts: string[] = [];
  if (binding.ctrl) parts.push("Ctrl");
  if (binding.meta) parts.push("Cmd");
  if (binding.super) parts.push("Super");
  if (binding.shift) parts.push("Shift");
  if (binding.alt) parts.push("Alt");
  parts.push(binding.key.toUpperCase());
  return parts.join("+");
}

type MatchEvent = {
  name: string;
  ctrl?: boolean;
  shift?: boolean;
  meta?: boolean;
  super?: boolean;
  alt?: boolean;
  option?: boolean;
};

export function isMatch(binding: KeyBinding, event: MatchEvent): boolean {
  const option = event.option ?? event.alt;
  const name = event.name.toLowerCase();

  return (
    binding.key === name &&
    !!binding.ctrl === !!event.ctrl &&
    !!binding.shift === !!event.shift &&
    !!binding.meta === !!event.meta &&
    !!binding.super === !!event.super &&
    !!binding.alt === !!option
  );
}
