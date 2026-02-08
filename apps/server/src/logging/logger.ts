import { Ansis } from "ansis";
import { Cause, FiberId, HashMap, Inspectable, LogSpan, Logger } from "effect";

const JSON_TOKEN_PATTERN =
  /("(?:\\.|[^"\\])*(?<!\\)")(?=\s*:)|("(?:\\.|[^"\\])*(?<!\\)")|\b-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|\btrue\b|\bfalse\b|\bnull\b|[{}[\]:,]/g;

function envDisablesColors() {
  const noColor = process.env.NO_COLOR;
  if (noColor !== undefined && noColor !== "") {
    return true;
  }
  const forceColor = process.env.FORCE_COLOR?.toLowerCase();
  return forceColor === "0" || forceColor === "false";
}

function indentBlock(text: string, spaces: number): string {
  const prefix = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

function looksLikeJsonString(value: string): boolean {
  const trimmed = value.trim();
  return (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  );
}

function tryPrettyJson(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      try {
        return JSON.stringify(JSON.parse(trimmed), null, 2);
      } catch {
        return undefined;
      }
    }
    return undefined;
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

function highlightJson(color: Ansis, json: string): string {
  return json.replace(
    JSON_TOKEN_PATTERN,
    (token, keyString: string | undefined, valueString: string | undefined) => {
      if (keyString !== undefined) {
        return color.cyan.bold(token);
      }
      if (valueString !== undefined) {
        return color.green(token);
      }
      if (token === "true" || token === "false") {
        return color.yellow(token);
      }
      if (token === "null") {
        return color.gray(token);
      }
      if (/^-?\d/.test(token)) {
        return color.magenta(token);
      }
      return color.gray(token);
    },
  );
}

function renderValue(color: Ansis, value: unknown): string {
  if (typeof value === "string" && !looksLikeJsonString(value)) {
    return value;
  }
  const prettyJson = tryPrettyJson(value);
  if (prettyJson !== undefined) {
    return highlightJson(color, prettyJson);
  }
  return Inspectable.stringifyCircular(Inspectable.redact(value));
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
      return color.magentaBright.bold;
    case "Debug":
      return color.cyanBright.bold;
    case "Info":
      return color.green.bold;
    case "Warning":
      return color.yellow.bold;
    case "Error":
      return color.red.bold;
    case "Fatal":
      return color.white.bold.bgRed;
    default:
      return color.white.bold;
  }
}

export function makeAppLogger(options?: { readonly noColor?: boolean }) {
  return Logger.withLeveledConsole(makeAppStringLogger(options));
}

export function makeAppStringLogger(options?: { readonly noColor?: boolean }) {
  const color = options?.noColor === true || envDisablesColors() ? new Ansis(0) : new Ansis();

  const stringLogger = Logger.make(
    ({ annotations, cause, context, date, fiberId, logLevel, message, spans }) => {
      const values = asMessages(message);
      const renderSpan = LogSpan.render(date.getTime());
      const spanText = Array.from(spans)
        .map((span) => color.magenta(renderSpan(span)))
        .join(" ");

      const header = [
        color.gray(date.toISOString()),
        levelStyle(color, logLevel._tag)(logLevel.label.padEnd(5, " ")),
        color.gray(`(${FiberId.threadName(fiberId)})`),
        spanText,
      ]
        .filter((part) => part.length > 0)
        .join(" ");

      const lines: Array<string> = [];
      if (values.length === 0) {
        lines.push(`${header}:`);
      } else {
        const firstValue = values[0];
        const hasHeadline = typeof firstValue === "string" && !looksLikeJsonString(firstValue);
        lines.push(hasHeadline ? `${header}: ${color.cyan.bold(firstValue)}` : `${header}:`);

        const startIndex = hasHeadline ? 1 : 0;
        for (let i = startIndex; i < values.length; i++) {
          const rendered = renderValue(color, values[i]);
          const label = i === startIndex ? "data" : `data${i - startIndex + 1}`;
          if (rendered.includes("\n")) {
            lines.push(`  ${color.white.bold(label)}:`);
            lines.push(indentBlock(rendered, 4));
          } else {
            lines.push(`  ${color.white.bold(label)}=${rendered}`);
          }
        }
      }

      if (!Cause.isEmpty(cause)) {
        lines.push(`  ${color.red.bold("cause")}:`);
        lines.push(Cause.pretty(cause, { renderErrorCause: true }));
      }

      if (HashMap.size(annotations) > 0) {
        lines.push(`  ${color.white.bold("annotations")}:`);
        for (const [key, value] of annotations) {
          const rendered = renderValue(color, value);
          if (rendered.includes("\n")) {
            lines.push(`  ${color.white.bold(key)}=`);
            lines.push(indentBlock(rendered, 4));
          } else {
            lines.push(`  ${color.white.bold(key)}=${rendered}`);
          }
        }
      }

      if (shouldShowContext(logLevel._tag, context)) {
        const renderedContext = renderValue(color, context);
        if (renderedContext.includes("\n")) {
          lines.push(`  ${color.gray("context")}:`);
          lines.push(indentBlock(renderedContext, 4));
        } else {
          lines.push(`  ${color.gray("context")}=${renderedContext}`);
        }
      }

      return lines.join("\n");
    },
  );

  return stringLogger;
}

export const AppLoggerLive = Logger.replace(Logger.defaultLogger, makeAppLogger());
