import { resolve } from "node:path";

import { Ansis } from "ansis";
import { Cause, FiberId, HashMap, Inspectable, Logger } from "effect";

const JSON_TOKEN_PATTERN =
  /("(?:\\.|[^"\\])*(?<!\\)")(?=\s*:)|("(?:\\.|[^"\\])*(?<!\\)")|\b-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|\btrue\b|\bfalse\b|\bnull\b|[{}[\]:,]/g;

const TREE = {
  vertical: "│",
  branch: "├─",
  corner: "└─",
  indent: "  ",
} as const;

const LEVEL_SYMBOLS = {
  Trace: "●",
  Debug: "◆",
  Info: "ℹ",
  Warning: "⚠",
  Error: "✖",
  Fatal: "💀",
} as const;

function envDisablesColors() {
  const noColor = process.env.NO_COLOR;
  if (noColor !== undefined && noColor !== "") {
    return true;
  }
  const forceColor = process.env.FORCE_COLOR?.toLowerCase();
  return forceColor === "0" || forceColor === "false";
}

function formatTime(date: Date): string {
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  return `${h}:${m}:${s}.${ms}`;
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function looksLikeJsonString(value: string): boolean {
  const trimmed = value.trim();
  return (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  );
}

function highlightJson(color: Ansis, json: string): string {
  return json.replace(
    JSON_TOKEN_PATTERN,
    (token, keyString: string | undefined, valueString: string | undefined) => {
      if (keyString !== undefined) {
        return color.cyanBright.bold(token);
      }
      if (valueString !== undefined) {
        return color.greenBright(token);
      }
      if (token === "true" || token === "false") {
        return color.yellowBright.bold(token);
      }
      if (token === "null") {
        return color.gray.dim(token);
      }
      if (/^-?\d/.test(token)) {
        return color.magentaBright(token);
      }
      return color.gray(token);
    },
  );
}

function safeJson(value: unknown): string | undefined {
  if (typeof value === "string") {
    if (!looksLikeJsonString(value)) {
      return undefined;
    }
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return undefined;
    }
  }

  if (typeof value === "object" && value !== null) {
    try {
      return JSON.stringify(Inspectable.redact(value), null, 2);
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function renderInlineValue(color: Ansis, value: unknown): string {
  if (typeof value === "string" && !looksLikeJsonString(value)) {
    return color.white(value);
  }

  const prettyJson = safeJson(value);
  if (prettyJson !== undefined) {
    const oneLine = prettyJson.replaceAll("\n", " ");
    return highlightJson(color, oneLine);
  }

  return color.white(Inspectable.toStringUnknown(Inspectable.redact(value), 0));
}

function renderJsonBlock(color: Ansis, json: string): Array<string> {
  const lines = json.split("\n");
  return lines.map((line, index) => {
    const edge = index === 0 ? "╭─" : index === lines.length - 1 ? "╰─" : "│ ";
    return `${color.gray(edge)} ${highlightJson(color, line)}`;
  });
}

function renderMultilineValue(color: Ansis, value: unknown): Array<string> {
  const prettyJson = safeJson(value);
  if (prettyJson !== undefined) {
    return renderJsonBlock(color, prettyJson);
  }

  const rendered = Inspectable.toStringUnknown(Inspectable.redact(value), 2);
  return rendered.split("\n").map((line) => color.gray(line));
}

function isSimpleContext(context: unknown): boolean {
  try {
    const redacted = Inspectable.redact(context);
    if (typeof redacted !== "object" || redacted === null) {
      return false;
    }
    const record = redacted as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length === 0) {
      return true;
    }
    if (keys.length === 1 && keys[0] === "locals") {
      const locals = record.locals;
      return (
        typeof locals === "object" &&
        locals !== null &&
        Object.keys(locals as Record<string, unknown>).length === 0
      );
    }
    return false;
  } catch {
    return false;
  }
}

function shouldShowContext(levelTag: string, context: unknown): boolean {
  if (levelTag === "Trace" || levelTag === "Debug") {
    return true;
  }
  return !isSimpleContext(context);
}

function asMessages(message: unknown): ReadonlyArray<unknown> {
  return Array.isArray(message) ? message : [message];
}

function levelStyle(color: Ansis, levelTag: string) {
  switch (levelTag) {
    case "Trace":
      return color.magentaBright;
    case "Debug":
      return color.cyanBright;
    case "Info":
      return color.blueBright;
    case "Warning":
      return color.yellowBright;
    case "Error":
      return color.redBright;
    case "Fatal":
      return color.white.bgRed;
    default:
      return color.white;
  }
}

interface Node {
  readonly label: string;
  readonly inline?: string;
  readonly block?: ReadonlyArray<string>;
}

interface StackFrame {
  readonly functionName: string;
  readonly location: string;
  readonly isNative: boolean;
}

function pushNode(lines: Array<string>, color: Ansis, node: Node, isLast: boolean): void {
  const branch = color.gray(isLast ? TREE.corner : TREE.branch);

  if (node.label === "" && node.block !== undefined && node.block.length > 0) {
    for (let index = 0; index < node.block.length; index++) {
      const line = node.block[index]!;
      if (index === 0) {
        lines.push(`${branch} ${line}`);
      } else {
        const continuation = color.gray(isLast ? TREE.indent : TREE.vertical);
        lines.push(`${continuation} ${line}`);
      }
    }
    return;
  }

  const suffix =
    node.inline === undefined
      ? node.block !== undefined && node.block.length > 0
        ? ":"
        : ""
      : `: ${node.inline}`;
  lines.push(`${branch} ${node.label}${suffix}`);

  if (node.block === undefined || node.block.length === 0) {
    return;
  }

  const continuation = color.gray(isLast ? `${TREE.indent}` : TREE.vertical);
  for (const line of node.block) {
    lines.push(`${continuation}${TREE.indent}${line}`);
  }
}

function compactPath(path: string): string {
  let clean = path.replace(/^file:\/\//, "");
  const cwd = process.cwd();
  const roots = [cwd, resolve(cwd, ".."), resolve(cwd, "../..")] as const;
  for (const root of roots) {
    if (clean.startsWith(root)) {
      clean = clean.slice(root.length).replace(/^\//, "");
      break;
    }
  }

  clean = clean.replace(/\/node_modules\/\.bun\/[^/]+\/node_modules\//g, "/");
  clean = clean.replace(/\/node_modules\/((@[^/]+\/[^/]+)|[^/]+)\//g, "/$1/");

  return clean;
}

function parseStackLine(line: string): StackFrame | undefined {
  const match = line.match(/^\s*at\s+(?:(.*?)\s+\()?(.*?)(?:\)|$)/);
  if (match === null) {
    return undefined;
  }

  const rawFunctionName = match[1]?.trim();
  const rawLocation = match[2]?.trim();
  const functionName =
    rawFunctionName === undefined ||
    rawFunctionName.length === 0 ||
    rawFunctionName === "<anonymous>"
      ? "(anonymous)"
      : rawFunctionName;
  const location = compactPath(rawLocation && rawLocation.length > 0 ? rawLocation : functionName);
  const isNative = location.includes("native:") || location.startsWith("node:");

  return {
    functionName,
    location,
    isNative,
  };
}

function renderStackFrames(color: Ansis, error: Error, prefix: string): Array<string> {
  const stackFrames = (error.stack ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("at"))
    .slice(0, 5);

  const lines: Array<string> = [];
  for (let index = 0; index < stackFrames.length; index++) {
    const parsed = parseStackLine(stackFrames[index]!);
    if (parsed === undefined) {
      continue;
    }

    const framePrefix = color.gray(index === stackFrames.length - 1 ? "└─" : "├─");
    const functionPart =
      parsed.functionName !== "(anonymous)"
        ? `${color.white.dim(parsed.functionName)} ${color.gray("at")} `
        : "";
    const locationPart = parsed.isNative
      ? color.gray(parsed.location)
      : color.gray.dim(parsed.location);
    lines.push(`${prefix}${framePrefix} ${functionPart}${locationPart}`);
  }

  return lines;
}

function renderCausedByChain(color: Ansis, error: Error, prefix: string): Array<string> {
  const lines: Array<string> = [];
  lines.push(
    `${prefix}${color.gray("╰→ caused by")} ${color.red.bold(error.name || "Error")}: ${color.white(error.message)}`,
  );

  const childPrefix = `${prefix}${TREE.indent}`;
  lines.push(...renderStackFrames(color, error, childPrefix));

  const nestedCause = (error as { cause?: unknown }).cause;
  if (nestedCause instanceof Error) {
    lines.push(...renderCausedByChain(color, nestedCause, childPrefix));
  }

  return lines;
}

function renderErrorChain(
  color: Ansis,
  error: Error,
  prefix: string,
  connector: "├─" | "└─",
): Array<string> {
  const lines: Array<string> = [];
  const errorName = error.name || "Error";
  lines.push(
    `${prefix}${color.gray(connector)} ${color.red.bold(errorName)}: ${color.white(error.message)}`,
  );

  const childPrefix = `${prefix}${connector === "└─" ? "   " : "│  "}`;
  lines.push(...renderStackFrames(color, error, childPrefix));

  const nestedCause = (error as { cause?: unknown }).cause;
  if (nestedCause instanceof Error) {
    lines.push(...renderCausedByChain(color, nestedCause, childPrefix));
  }

  return lines;
}

function causeNode(color: Ansis, cause: Cause.Cause<unknown>): Node | undefined {
  if (Cause.isEmpty(cause)) {
    return undefined;
  }

  const prettyErrors = Cause.prettyErrors(cause);
  const uniqueErrors: Array<Cause.PrettyError> = [];
  const seen = new Set<string>();
  for (const error of prettyErrors) {
    const signature = `${error.name}|${error.message}|${error.stack ?? ""}`;
    if (!seen.has(signature)) {
      seen.add(signature);
      uniqueErrors.push(error);
    }
  }

  if (uniqueErrors.length > 0) {
    const block: Array<string> = [color.red.bold("✖ Cause")];
    for (let index = 0; index < uniqueErrors.length; index++) {
      const connector: "├─" | "└─" =
        uniqueErrors.length === 1 || index < uniqueErrors.length - 1 ? "├─" : "└─";
      block.push(...renderErrorChain(color, uniqueErrors[index]!, "", connector));
    }

    return {
      label: "",
      block,
    };
  }

  const pretty = Cause.pretty(cause, { renderErrorCause: true });
  const causeLines = pretty.split("\n");
  return {
    label: "",
    block: [
      color.red.bold("✖ Cause"),
      ...(causeLines.length > 0 ? causeLines.map((line) => color.gray.dim(line)) : []),
    ],
  };
}

function annotationNode(
  color: Ansis,
  annotations: HashMap.HashMap<string, unknown>,
): Node | undefined {
  if (HashMap.size(annotations) === 0) {
    return undefined;
  }

  const entries = Array.from(annotations).sort(([a], [b]) => a.localeCompare(b));
  const annotationRecord = Object.fromEntries(
    entries.map(([key, value]) => [key, Inspectable.redact(value)]),
  );

  const pretty = safeJson(annotationRecord);
  if (pretty !== undefined) {
    return {
      label: color.gray("Annotations"),
      block: renderJsonBlock(color, pretty),
    };
  }

  return {
    label: color.gray("Annotations"),
    inline: renderInlineValue(color, annotationRecord),
  };
}

function contextNode(color: Ansis, levelTag: string, context: unknown): Node | undefined {
  if (!shouldShowContext(levelTag, context)) {
    return undefined;
  }

  const pretty = safeJson(context);
  if (pretty !== undefined) {
    return {
      label: color.gray("Context"),
      block: renderJsonBlock(color, pretty),
    };
  }

  return {
    label: color.gray("Context"),
    inline: renderInlineValue(color, context),
  };
}

export function makeAppLogger(options?: { readonly noColor?: boolean }) {
  return Logger.withLeveledConsole(makeAppStringLogger(options));
}

export function makeAppStringLogger(options?: { readonly noColor?: boolean }) {
  const color = options?.noColor === true || envDisablesColors() ? new Ansis(0) : new Ansis();

  return Logger.make(({ annotations, cause, context, date, fiberId, logLevel, message, spans }) => {
    const levelColor = levelStyle(color, logLevel._tag);
    const symbol = LEVEL_SYMBOLS[logLevel._tag as keyof typeof LEVEL_SYMBOLS] ?? "•";
    const levelText = levelColor.bold(logLevel._tag.toUpperCase().padEnd(5, " "));
    const timeText = color.gray(formatTime(date));
    const fiberName = truncate(FiberId.threadName(fiberId), 12);
    const fiberText = color.gray.dim(`[${fiberName}]`);

    const spanText = Array.from(spans)
      .map((span) => {
        const durationMs = Math.max(0, date.getTime() - span.startTime);
        const name = truncate(span.label, 20);
        return color.gray.dim(`[${name}: ${durationMs}ms]`);
      })
      .join(" ");

    const header = [levelColor(symbol), levelText, timeText, fiberText, spanText]
      .filter((part) => part.length > 0)
      .join(" ");

    const nodes: Array<Node> = [];
    const messages = asMessages(message);

    if (messages.length === 0) {
      nodes.push({ label: color.white("Message"), inline: color.gray("(empty)") });
    } else {
      const first = messages[0];
      const firstIsHeadline = typeof first === "string" && !looksLikeJsonString(first);

      if (firstIsHeadline) {
        nodes.push({ label: color.white.bold("Message"), inline: color.white(first) });
      } else {
        nodes.push({
          label: color.white.bold("Payload"),
          block: renderMultilineValue(color, first),
        });
      }

      const start = firstIsHeadline ? 1 : 1;
      for (let index = start; index < messages.length; index++) {
        const label = index === 1 && firstIsHeadline ? "Payload" : `Payload ${index}`;
        const value = messages[index];
        const multiline = renderMultilineValue(color, value);
        if (multiline.length === 1 && !multiline[0]?.startsWith("╭─")) {
          nodes.push({ label: color.white.bold(label), inline: renderInlineValue(color, value) });
        } else {
          nodes.push({ label: color.white.bold(label), block: multiline });
        }
      }
    }

    const causePart = causeNode(color, cause);
    if (causePart !== undefined) {
      nodes.push(causePart);
    }

    const annotationPart = annotationNode(color, annotations);
    if (annotationPart !== undefined) {
      nodes.push(annotationPart);
    }

    const contextPart = contextNode(color, logLevel._tag, context);
    if (contextPart !== undefined) {
      nodes.push(contextPart);
    }

    const lines = [header, color.gray(TREE.vertical)];
    for (let index = 0; index < nodes.length; index++) {
      pushNode(lines, color, nodes[index]!, index === nodes.length - 1);
    }

    return lines.join("\n");
  });
}

export const AppLoggerLive = Logger.replace(Logger.defaultLogger, makeAppLogger());
