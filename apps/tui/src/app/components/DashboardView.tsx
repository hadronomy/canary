import { TextAttributes } from "@opentui/core";
import type { Theme } from "~/app/theme";

type DashboardViewProps = {
  theme: Theme;
};

// Mock Data
const MOCK_SCRAPING_TASKS = [
  { id: "boc-1978", target: "BOC 1978-1990", status: "processing", progress: 72 },
  { id: "boc-1991", target: "BOC 1991-2000", status: "processing", progress: 31 },
  { id: "boc-2001", target: "BOC 2001-2010", status: "queued", progress: 0 },
  { id: "boc-2011", target: "BOC 2011-2020", status: "queued", progress: 0 },
  { id: "boc-2021", target: "BOC 2021-Present", status: "scheduled", progress: 0 },
  { id: "boc-daily", target: "Daily BOC Monitor", status: "running", progress: 58 },
];

const MOCK_FEED_UPDATES = [
  { id: 1, source: "BOC", title: "Boletín Oficial: Resolución 2026-01-20", time: "5m ago" },
  {
    id: 2,
    source: "BOC",
    title: "Convocatoria: Subvenciones innovación turística",
    time: "32m ago",
  },
  { id: 3, source: "Cabildo", title: "Acuerdo pleno: Ordenanzas 2026", time: "1h ago" },
  { id: 4, source: "GobCan", title: "Decreto 12/2026: Patrimonio histórico", time: "3h ago" },
];

const MOCK_DB_STATUS = {
  status: "Connected",
  records: 482_117,
  size: "2.4TB",
  latency: "9ms",
};

const MOCK_MAINTENANCE = {
  indexing: "Running",
  lastRun: "12m ago",
  health: "Good",
};

const MOCK_KB_COVERAGE = [
  { category: "BOC Archives", percent: 68 },
  { category: "Cabildo Normativa", percent: 52 },
  { category: "Municipal Ordinances", percent: 37 },
  { category: "EU Directives", percent: 18 },
];

export function DashboardView({ theme }: DashboardViewProps) {
  const { palette } = theme;

  return (
    <scrollbox
      style={{
        width: "100%",
        height: "100%",
        flexGrow: 1,
        rootOptions: { backgroundColor: palette.base },
        wrapperOptions: { backgroundColor: palette.base },
        viewportOptions: { backgroundColor: palette.base },
        contentOptions: { flexDirection: "column", padding: 1 },
        scrollbarOptions: {
          showArrows: false,
          trackOptions: { foregroundColor: palette.mauve, backgroundColor: palette.surface0 },
        },
      }}
    >
      <box style={{ marginBottom: 1, paddingBottom: 1 }}>
        <text
          content="CONTROL CENTER"
          style={{ fg: palette.mauve, attributes: TextAttributes.BOLD }}
        />
        <text content=" • " style={{ fg: palette.overlay0 }} />
        <text content="BOC ingest · Canary legal knowledge base" style={{ fg: palette.blue }} />
      </box>

      <box style={{ flexDirection: "row", marginBottom: 1, height: 8 }}>
        <box
          style={{
            flexGrow: 1,
            marginRight: 1,
            padding: 1,
            backgroundColor: palette.surface0,
            flexDirection: "column",
          }}
        >
          <text
            content="DATABASE STATUS"
            style={{ fg: palette.blue, attributes: TextAttributes.BOLD, marginBottom: 1 }}
          />
          <box style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <text content="Status" style={{ fg: palette.subtext0 }} />
            <text content={MOCK_DB_STATUS.status} style={{ fg: palette.blue }} />
          </box>
          <box style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <text content="Documents" style={{ fg: palette.subtext0 }} />
            <text content={MOCK_DB_STATUS.records.toLocaleString()} style={{ fg: palette.text }} />
          </box>
          <box style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <text content="Storage" style={{ fg: palette.subtext0 }} />
            <text content={MOCK_DB_STATUS.size} style={{ fg: palette.text }} />
          </box>
          <box style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <text content="Query Latency" style={{ fg: palette.subtext0 }} />
            <text content={MOCK_DB_STATUS.latency} style={{ fg: palette.lavender }} />
          </box>
        </box>

        <box
          style={{
            flexGrow: 1,
            padding: 1,
            backgroundColor: palette.surface0,
            flexDirection: "column",
          }}
        >
          <text
            content="MAINTENANCE"
            style={{ fg: palette.mauve, attributes: TextAttributes.BOLD, marginBottom: 1 }}
          />
          <box style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <text content="Indexing" style={{ fg: palette.subtext0 }} />
            <text content={MOCK_MAINTENANCE.indexing} style={{ fg: palette.overlay0 }} />
          </box>
          <box style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <text content="Last Run" style={{ fg: palette.subtext0 }} />
            <text content={MOCK_MAINTENANCE.lastRun} style={{ fg: palette.text }} />
          </box>
          <box style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <text content="PDF Cleanup" style={{ fg: palette.subtext0 }} />
            <text content="Queued" style={{ fg: palette.overlay0 }} />
          </box>
          <box style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <text content="System Health" style={{ fg: palette.subtext0 }} />
            <text content={MOCK_MAINTENANCE.health} style={{ fg: palette.blue }} />
          </box>
        </box>
      </box>

      <box
        style={{
          flexDirection: "column",
          marginBottom: 1,
          padding: 1,
          backgroundColor: palette.surface0,
        }}
      >
        <text
          content="SCRAPING TASKS"
          style={{ fg: palette.lavender, attributes: TextAttributes.BOLD, marginBottom: 1 }}
        />
        {MOCK_SCRAPING_TASKS.map((task) => (
          <box
            key={task.id}
            style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 0 }}
          >
            <text content={task.target} style={{ fg: palette.text, width: "45%" }} />
            <text
              content={task.status}
              style={{
                fg:
                  task.status === "processing"
                    ? palette.mauve
                    : task.status === "running"
                      ? palette.lavender
                      : task.status === "completed"
                        ? palette.blue
                        : palette.overlay0,
                width: "18%",
              }}
            />
            <text
              content={`[${"#".repeat(Math.floor(task.progress / 10))}${"-".repeat(10 - Math.floor(task.progress / 10))}] ${task.progress}%`}
              style={{ fg: palette.subtext0 }}
            />
          </box>
        ))}
      </box>

      <box style={{ flexDirection: "row", flexGrow: 1 }}>
        <box
          style={{
            flexGrow: 2,
            marginRight: 1,
            padding: 1,
            backgroundColor: palette.surface0,
            flexDirection: "column",
          }}
        >
          <text
            content="LIVE FEED"
            style={{ fg: palette.lavender, attributes: TextAttributes.BOLD, marginBottom: 1 }}
          />
          {MOCK_FEED_UPDATES.map((item) => (
            <box key={item.id} style={{ flexDirection: "column", marginBottom: 1 }}>
              <box style={{ flexDirection: "row" }}>
                <text
                  content={item.source}
                  style={{ fg: palette.blue, attributes: TextAttributes.BOLD, marginRight: 1 }}
                />
                <text content={item.time} style={{ fg: palette.overlay0 }} />
              </box>
              <text content={item.title} style={{ fg: palette.text }} />
            </box>
          ))}
        </box>

        <box
          style={{
            flexGrow: 1,
            padding: 1,
            backgroundColor: palette.surface0,
            flexDirection: "column",
          }}
        >
          <text
            content="KB COVERAGE"
            style={{ fg: palette.mauve, attributes: TextAttributes.BOLD, marginBottom: 1 }}
          />
          {MOCK_KB_COVERAGE.map((item) => (
            <box key={item.category} style={{ flexDirection: "column", marginBottom: 1 }}>
              <box style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <text content={item.category} style={{ fg: palette.subtext0 }} />
                <text content={`${item.percent}%`} style={{ fg: palette.text }} />
              </box>
              <text
                content={
                  "█".repeat(Math.floor(item.percent / 10)) +
                  "░".repeat(10 - Math.floor(item.percent / 10))
                }
                style={{ fg: palette.mauve }}
              />
            </box>
          ))}
          <box style={{ marginTop: 1 }}>
            <text
              content="Sources: BOC archives, cabildos, municipal ordinances, EU directives"
              style={{ fg: palette.overlay0, attributes: TextAttributes.DIM }}
            />
          </box>
        </box>
      </box>
    </scrollbox>
  );
}
