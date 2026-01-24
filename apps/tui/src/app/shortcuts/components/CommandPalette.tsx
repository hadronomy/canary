import { TextAttributes } from "@opentui/core";
import type { TextareaRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { formatKeyCombo } from "~/app/shortcuts/helpers";
import type { Shortcut } from "~/app/shortcuts/types";
import type { Theme } from "~/app/theme";

export type CommandPaletteProps = {
  theme: Theme;
  open: boolean;
  shortcuts: Shortcut[];
  query: string;
  onQueryChange: (value: string) => void;
  onSelect: (shortcut: Shortcut) => void;
};

export function CommandPalette({
  theme,
  open,
  shortcuts,
  query,
  onQueryChange,
  onSelect,
}: CommandPaletteProps) {
  const { palette } = theme;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const inputRef = useRef<TextareaRenderable | null>(null);

  useEffect(() => {
    if (!open) {
      setSelectedId(null);
      return;
    }
    if (!inputRef.current) return;
    if (inputRef.current.plainText !== query) {
      inputRef.current.setText(query);
      inputRef.current.gotoLineEnd();
    }
  }, [open, query]);

  const paletteShortcuts = useMemo(
    () => shortcuts.filter((shortcut) => shortcut.id !== "cmdk.close"),
    [shortcuts],
  );

  const filtered = useMemo(() => {
    if (!query.trim()) return paletteShortcuts;
    const needle = query.trim().toLowerCase();
    return paletteShortcuts.filter((shortcut) =>
      `${shortcut.description} ${shortcut.category ?? ""}`.toLowerCase().includes(needle),
    );
  }, [query, paletteShortcuts]);

  const grouped = useMemo(() => {
    return filtered.reduce<Record<string, Shortcut[]>>((acc, shortcut) => {
      const category = shortcut.category ?? "General";
      acc[category] = acc[category] ? [...acc[category], shortcut] : [shortcut];
      return acc;
    }, {});
  }, [filtered]);

  const sortedCategories = useMemo(() => Object.keys(grouped).sort(), [grouped]);
  const flattened = useMemo(
    () => sortedCategories.flatMap((category) => grouped[category] ?? []),
    [sortedCategories, grouped],
  );

  useEffect(() => {
    if (!flattened.length) return;
    const exists = flattened.some((item) => item.id === selectedId);
    if (!selectedId || !exists) {
      const first = flattened[0];
      if (first) setSelectedId(first.id);
    }
  }, [flattened, selectedId]);

  const moveTo = (index: number) => {
    const next = flattened[index];
    if (next) setSelectedId(next.id);
  };

  const move = (delta: number) => {
    if (!flattened.length) return;
    const currentIndex = flattened.findIndex((item) => item.id === selectedId);
    const startIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = (startIndex + delta + flattened.length) % flattened.length;
    moveTo(nextIndex);
  };

  useKeyboard((key) => {
    if (!open) return;
    if (!flattened.length) return;

    if (key.name === "down" || (key.ctrl && key.name === "n")) {
      move(1);
    }
    if (key.name === "up" || (key.ctrl && key.name === "p")) {
      move(-1);
    }
    if (key.name === "enter" || key.name === "return") {
      const selected = flattened.find((item) => item.id === selectedId);
      if (selected) onSelect(selected);
    }
  });

  if (!open) {
    return null;
  }

  return (
    <box
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        justifyContent: "center",
        alignItems: "center",
        zIndex: 40,
      }}
    >
      <box
        style={{
          width: "60%",
          height: "60%",
          border: true,
          borderStyle: "rounded",
          borderColor: palette.mauve,
          backgroundColor: palette.base,
          padding: 1,
          flexDirection: "column",
        }}
      >
        <box
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            paddingLeft: 1,
            paddingRight: 1,
            marginBottom: 1,
          }}
        >
          <text
            content="Command Palette"
            style={{ fg: palette.text, attributes: TextAttributes.BOLD }}
          />
          <text content="esc" style={{ fg: palette.subtext0 }} />
        </box>

        <box
          style={{
            height: 1,
            paddingLeft: 1,
            paddingRight: 1,
            marginBottom: 1,
            flexDirection: "row",
            alignItems: "center",
          }}
        >
          <textarea
            placeholder="Search actions..."
            initialValue={query}
            onContentChange={() => {
              if (!inputRef.current) return;
              onQueryChange(inputRef.current.plainText);
            }}
            ref={(instance: TextareaRenderable) => {
              inputRef.current = instance;
            }}
            focused
            height={1}
            style={{
              flexGrow: 1,
              height: 1,
              focusedBackgroundColor: palette.base,
              cursorColor: palette.mauve,
              textColor: palette.text,
              selectionBg: palette.surface2,
              selectionFg: palette.text,
            }}
          />
        </box>

        <scrollbox
          style={{
            flexGrow: 1,
            rootOptions: { backgroundColor: palette.base },
            wrapperOptions: { backgroundColor: palette.base },
            viewportOptions: { backgroundColor: palette.base },
            contentOptions: { backgroundColor: palette.base, flexDirection: "column" },
            scrollbarOptions: {
              visible: false,
            },
          }}
        >
          {flattened.length === 0 ? (
            <box paddingLeft={2} paddingTop={1}>
              <text content="No results found" style={{ fg: palette.subtext0 }} />
            </box>
          ) : (
            sortedCategories.map((category) => (
              <box
                key={category}
                style={{
                  flexDirection: "column",
                  width: "100%",
                }}
              >
                <box paddingLeft={2} paddingTop={1} paddingBottom={0}>
                  <text
                    content={category}
                    style={{
                      fg: palette.mauve,
                      attributes: TextAttributes.BOLD,
                    }}
                  />
                </box>
                {(grouped[category] ?? []).map((shortcut) => {
                  const isSelected = shortcut.id === selectedId;
                  return (
                    <box
                      key={shortcut.id}
                      style={{
                        flexDirection: "row",
                        justifyContent: "space-between",
                        width: "100%",
                        height: 1,
                        paddingLeft: 2,
                        paddingRight: 2,
                        backgroundColor: isSelected ? palette.surface1 : "transparent",
                      }}
                    >
                      <text
                        content={shortcut.description}
                        style={{
                          fg: isSelected ? palette.mauve : palette.text,
                          attributes: isSelected ? TextAttributes.BOLD : undefined,
                        }}
                      />
                      {shortcut.bindings.length ? (
                        <text
                          content={shortcut.bindings.map(formatKeyCombo).join(" ")}
                          style={{ fg: isSelected ? palette.mauve : palette.subtext0 }}
                        />
                      ) : null}
                    </box>
                  );
                })}
              </box>
            ))
          )}
        </scrollbox>

        <box
          style={{
            marginTop: 1,
            paddingLeft: 1,
            paddingRight: 1,
            flexDirection: "row",
            gap: 2,
          }}
        >
          <text
            content="↑/↓ to navigate"
            style={{ fg: palette.subtext0, attributes: TextAttributes.DIM }}
          />
          <text
            content="Enter to select"
            style={{ fg: palette.subtext0, attributes: TextAttributes.DIM }}
          />
        </box>
      </box>
    </box>
  );
}
