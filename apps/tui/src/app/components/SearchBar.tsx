import type { Theme } from "../theme";

type SearchBarProps = {
  theme: Theme;
  query: string;
  inputId?: string;
  onQueryChange: (value: string) => void;
  focused: boolean;
};

export function SearchBar({ theme, onQueryChange, focused, inputId }: SearchBarProps) {
  const { palette } = theme;

  return (
    <box
      style={{
        width: "72%",
        height: 3,
        paddingLeft: 1,
        paddingRight: 1,
        paddingTop: 0,
        paddingBottom: 0,
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: palette.surface0,
      }}
    >
      <text content=">" style={{ fg: palette.mauve, marginRight: 1, height: 1 }} />
      <input
        id={inputId}
        placeholder="Search regulations..."
        onInput={onQueryChange}
        focused={focused}
        style={{
          flexGrow: 1,
          height: 1,
          focusedBackgroundColor: palette.surface0,
          placeholderColor: palette.overlay0,
          textColor: palette.text,
        }}
      />
    </box>
  );
}
