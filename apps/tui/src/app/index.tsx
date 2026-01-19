import { KeyEvent } from "@opentui/core";
import { useEffect, useMemo, useRef } from "react";
import { useAtom } from "@effect-atom/atom-react";

import { Branding } from "~/app/components/Branding";
import { FooterHints } from "~/app/components/FooterHints";
import { ResultsList } from "~/app/components/ResultsList";
import { SearchBar } from "~/app/components/SearchBar";
import { ShortcutDebugToast } from "~/app/components/ShortcutDebugToast";
import { useShortcutList, useShortcutRegistry, useShortcuts } from "~/app/shortcuts";
import { CommandPalette } from "~/app/shortcuts/components/CommandPalette";
import { ShortcutsHelp } from "~/app/shortcuts/components/ShortcutsHelp";
import { createGlobalShortcuts } from "~/app/shortcuts/definitions/global";
import { createHelpShortcuts } from "~/app/shortcuts/definitions/help";
import { createSearchShortcuts } from "~/app/shortcuts/definitions/search";
import { createViewShortcuts } from "~/app/shortcuts/definitions/view";
import { catppuccinMocha } from "~/app/theme";
import {
  cmdkOpenAtom,
  cmdkQueryAtom,
  debugModeAtom,
  debugToastAtom,
  debugToastVisibleAtom,
  helpOpenAtom,
  queryAtom,
} from "~/app/state";

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

export function App() {
  const [query, setQuery] = useAtom(queryAtom);
  const [cmdkOpen, setCmdkOpen] = useAtom(cmdkOpenAtom);
  const [cmdkQuery, setCmdkQuery] = useAtom(cmdkQueryAtom);
  const [helpOpen, setHelpOpen] = useAtom(helpOpenAtom);
  const [debugMode, setDebugMode] = useAtom(debugModeAtom);
  const [debugToast, setDebugToast] = useAtom(debugToastAtom);
  const [debugToastVisible, setDebugToastVisible] = useAtom(debugToastVisibleAtom);

  const results = useMemo(() => {
    if (!query.trim()) {
      return [];
    }

    const needle = query.trim().toLowerCase();
    return PLACEHOLDER_RESULTS.filter((result) => result.title.toLowerCase().includes(needle));
  }, [query]);

  const shortcuts = useMemo(() => {
    const globalShortcuts = createGlobalShortcuts({
      toggleCommandPalette: () => setCmdkOpen((open: boolean) => !open),
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
      toggleHelp: () => setHelpOpen((open: boolean) => !open),
    });

    const debugShortcuts = [
      {
        id: "debug.toggle",
        scope: "global" as const,
        bindings: [] as (typeof globalShortcuts)[number]["bindings"],
        description: debugMode ? "Disable debug mode" : "Enable debug mode",
        category: "Developer",
        action: () => setDebugMode((value: boolean) => !value),
      },
    ];

    return [
      ...globalShortcuts,
      ...viewShortcuts,
      ...searchShortcuts,
      ...helpShortcuts,
      ...debugShortcuts,
    ];
  }, [cmdkOpen, helpOpen, debugMode]);

  const isMountedRef = useRef(true);

  useEffect(
    () => () => {
      isMountedRef.current = false;
    },
    [],
  );

  const showDebugToast = (message: string) => {
    if (!debugMode || !isMountedRef.current) return;
    setDebugToast(message);
    setDebugToastVisible(true);
    setTimeout(() => {
      if (isMountedRef.current) {
        setDebugToastVisible(false);
      }
    }, 1200);
  };

  useShortcuts(shortcuts);

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
        {showResults ? (
          <ResultsList
            theme={theme}
            query={query}
            results={results}
            active={!cmdkOpen && !helpOpen}
            onSelect={(item) => {
              if (debugMode) {
                showDebugToast(`Selected: ${item.title}`);
              }
            }}
          />
        ) : null}
      </box>

      <FooterHints theme={theme} />

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
