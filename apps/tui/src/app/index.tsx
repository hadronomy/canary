import { KeyEvent } from "@opentui/core";
import { useMemo, useState } from "react";

import { Branding } from "./components/Branding";
import { CmdkMenu } from "./components/CmdkMenu";
import { FooterHints } from "./components/FooterHints";
import { ResultsList } from "./components/ResultsList";
import { SearchBar } from "./components/SearchBar";
import { ShortcutDebugToast } from "./components/ShortcutDebugToast";
import { useShortcutList, useShortcutRegistry, useShortcuts } from "./shortcuts";
import { CommandPalette } from "./shortcuts/components/CommandPalette";
import { ShortcutsHelp } from "./shortcuts/components/ShortcutsHelp";
import { createGlobalShortcuts } from "./shortcuts/definitions/global";
import { createHelpShortcuts } from "./shortcuts/definitions/help";
import { createSearchShortcuts } from "./shortcuts/definitions/search";
import { createViewShortcuts } from "./shortcuts/definitions/view";
import { catppuccinMocha } from "./theme";

const PLACEHOLDER_RESULTS = [
  {
    title: "Regulation 102: Canary Flight Paths",
    summary: "Safety guidance for approved flight corridors across the islands.",
  },
  {
    title: "Law 404: Coal Mine Safety Protocols",
    summary: "Emergency response requirements for subterranean operations.",
  },
  {
    title: "Ordinance 88: Yellow Feather Standards",
    summary: "Certification for protected species handling and transport.",
  },
  {
    title: "Act 12: Harbor Access Controls",
    summary: "Credentialing and entry rules for port facilities.",
  },
  {
    title: "Directive 9: Maritime Radio Compliance",
    summary: "Channel assignment and signal clarity requirements.",
  },
  {
    title: "Protocol 7: Volcanic Air Quality Alerts",
    summary: "Thresholds and mitigation guidelines for sulfur emissions.",
  },
];

const PLACEHOLDER_COMMANDS = [
  {
    name: "Search regulations",
    description: "Focus the search field",
    value: "search",
  },
  {
    name: "Open recent query",
    description: "Jump back to previous searches",
    value: "recent",
  },
  {
    name: "View saved results",
    description: "Show bookmarked regulations",
    value: "saved",
  },
  {
    name: "Open help",
    description: "See keyboard shortcuts",
    value: "help",
  },
];

export function App() {
  const [query, setQuery] = useState("");
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const [cmdkQuery, setCmdkQuery] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const [debugToast, setDebugToast] = useState("");
  const [debugToastVisible, setDebugToastVisible] = useState(false);

  const results = useMemo(() => {
    if (!query.trim()) {
      return [];
    }

    const needle = query.trim().toLowerCase();
    return PLACEHOLDER_RESULTS.filter((result) => result.title.toLowerCase().includes(needle));
  }, [query]);

  const shortcuts = useMemo(() => {
    const globalShortcuts = createGlobalShortcuts({
      toggleCommandPalette: () => setCmdkOpen((open) => !open),
      clearSearch: () => setQuery(""),
    });

    const viewShortcuts = createViewShortcuts({
      closeCmdk: () => setCmdkOpen(false),
      closeHelp: () => setHelpOpen(false),
      isCmdkOpen: () => cmdkOpen,
      isHelpOpen: () => helpOpen,
    });

    const searchShortcuts = createSearchShortcuts({
      focusSearch: () => setCmdkOpen(false),
    });

    const helpShortcuts = createHelpShortcuts({
      toggleHelp: () => setHelpOpen((open) => !open),
    });

    return [...globalShortcuts, ...viewShortcuts, ...searchShortcuts, ...helpShortcuts];
  }, [cmdkOpen, helpOpen]);

  const showDebugToast = (message: string) => {
    setDebugToast(message);
    setDebugToastVisible(true);
    setTimeout(() => setDebugToastVisible(false), 1200);
  };

  useShortcuts(shortcuts);

  const commandOptions = useMemo(() => {
    const needle = cmdkQuery.trim().toLowerCase();
    if (!needle) {
      return PLACEHOLDER_COMMANDS;
    }

    return PLACEHOLDER_COMMANDS.filter((command) =>
      `${command.name} ${command.description}`.toLowerCase().includes(needle),
    );
  }, [cmdkQuery]);

  const shortcutContext = {
    currentView: cmdkOpen ? "cmdk" : helpOpen ? "help" : "main",
    focusedComponentId: "search-input",
    appState: { cmdkOpen, helpOpen, query },
    onShortcutFired: (id: string, combo: string) => {
      showDebugToast(`${id} → ${combo}`);
    },
    onShortcutDebug: (combo: string, matched: boolean) => {
      if (!matched) {
        showDebugToast(`No shortcut: ${combo}`);
      }
    },
  };

  useShortcutRegistry(shortcutContext);

  const commandPaletteShortcuts = useShortcutList(shortcutContext);

  const showResults = query.trim().length > 0;
  const theme = catppuccinMocha;

  return (
    <box
      style={{
        width: "100%",
        height: "100%",
        flexDirection: "column",
        backgroundColor: theme.palette.base,
      }}
    >
      <box
        style={{
          flexGrow: 1,
          flexDirection: "column",
          justifyContent: showResults ? "flex-start" : "center",
          alignItems: "center",
          padding: 2,
          gap: 2,
        }}
      >
        <Branding theme={theme} />
        <SearchBar
          theme={theme}
          query={query}
          onQueryChange={setQuery}
          focused={!cmdkOpen && !helpOpen}
          inputId="search-input"
        />
        {showResults ? <ResultsList theme={theme} query={query} results={results} /> : null}
      </box>

      <FooterHints theme={theme} />

      <CmdkMenu
        theme={theme}
        open={cmdkOpen}
        query={cmdkQuery}
        options={commandOptions}
        onQueryChange={setCmdkQuery}
      />

      <CommandPalette
        theme={theme}
        open={cmdkOpen}
        query={cmdkQuery}
        onQueryChange={setCmdkQuery}
        shortcuts={commandPaletteShortcuts}
        onSelect={(shortcut) => {
          const event = new KeyEvent({
            name: "enter",
            ctrl: false,
            meta: false,
            shift: false,
            option: false,
            sequence: "",
            number: false,
            raw: "",
            eventType: "press",
            source: "raw",
          });
          shortcut.action(event);
          setCmdkOpen(false);
          setCmdkQuery("");
        }}
      />

      <ShortcutsHelp
        theme={theme}
        open={helpOpen}
        shortcuts={commandPaletteShortcuts}
        onClose={() => setHelpOpen(false)}
      />

      <ShortcutDebugToast theme={theme} open={debugToastVisible} message={debugToast} />
    </box>
  );
}
