import { TextAttributes } from "@opentui/core";

export function App() {
  return (
    <box alignItems="center" justifyContent="center" flexGrow={1}>
      <box justifyContent="center" alignItems="flex-end">
        <ascii-font font="tiny" text="Canary" />
        <text attributes={TextAttributes.DIM}>What will you search?</text>
      </box>
    </box>
  );
}
