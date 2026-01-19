import type { KeyEvent } from "@opentui/core";

export type ShortcutScope = "global" | "view" | "component";

export type Modifier = "ctrl" | "meta" | "super" | "shift" | "alt";

export type LetterKey =
  | "a"
  | "b"
  | "c"
  | "d"
  | "e"
  | "f"
  | "g"
  | "h"
  | "i"
  | "j"
  | "k"
  | "l"
  | "m"
  | "n"
  | "o"
  | "p"
  | "q"
  | "r"
  | "s"
  | "t"
  | "u"
  | "v"
  | "w"
  | "x"
  | "y"
  | "z";

export type DigitKey = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";

export type NavigationKey =
  | "up"
  | "down"
  | "left"
  | "right"
  | "pageup"
  | "pagedown"
  | "home"
  | "end";

export type EditingKey = "enter" | "escape" | "esc" | "tab" | "backspace" | "delete" | "space";

export type SymbolKey =
  | "/"
  | "?"
  | "."
  | ","
  | ":"
  | ";"
  | "-"
  | "="
  | "["
  | "]"
  | "\\"
  | "'"
  | "`";

export type FunctionKey =
  | "f1"
  | "f2"
  | "f3"
  | "f4"
  | "f5"
  | "f6"
  | "f7"
  | "f8"
  | "f9"
  | "f10"
  | "f11"
  | "f12";

export type BaseKey = LetterKey | DigitKey | NavigationKey | EditingKey | SymbolKey | FunctionKey;

export type ModifierOrder = ["ctrl", "meta", "super", "shift", "alt"];

export type ModifierCombos<T extends readonly string[] = ModifierOrder> = T extends [
  infer Head extends string,
  ...infer Tail extends string[],
]
  ? Head | `${Head}+${ModifierCombos<Tail>}` | ModifierCombos<Tail>
  : never;

export type ModifierSequence = ModifierCombos | "";

export type KeyCombo = ModifierSequence extends infer T extends string
  ? T extends ""
    ? BaseKey
    : `${T}+${BaseKey}`
  : BaseKey;

export type ParsedKeyBinding = {
  key: BaseKey;
  ctrl: boolean;
  shift: boolean;
  meta: boolean;
  super: boolean;
  alt: boolean;
};

export type ShortcutCondition = {
  requiresFocus?: string | string[];
  when?: () => boolean;
  disabledIn?: string[];
};

export type Shortcut = {
  id: string;
  scope: ShortcutScope;
  bindings: KeyCombo[];
  description: string;
  category?: string;
  action: (event: KeyEvent) => void | Promise<void>;
  condition?: ShortcutCondition;
  remappable?: boolean;
  priority?: number;
};

export type ShortcutGroup = {
  category: string;
  shortcuts: Shortcut[];
};

export type KeyBinding = ParsedKeyBinding & {
  raw: KeyCombo;
};

export type ShortcutContext = {
  focusedComponentId?: string;
  currentView?: string;
  appState: Record<string, unknown>;
  onShortcutFired?: (id: string, combo: string) => void;
  onShortcutDebug?: (combo: string, matched: boolean) => void;
};
