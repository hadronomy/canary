# Node Extraction: Parsing Legal Documents into Fragments

This guide shows how to extract node information (paths, types, numbers) from raw legal documents.

## 1. Basic Concepts

### Node Path Generation Rules

```typescript
// Hierarchical numbering system
const generateNodePath = (parentPath: string, childIndex: number): string => {
  if (parentPath === "/") return `/${childIndex}`;
  return `${parentPath}/${childIndex}`;
};

// Examples:
// Parent: "/", Index: 1        → "/1" (Chapter 1)
// Parent: "/1", Index: 5      → "/1/5" (Article 5 in Chapter 1)
// Parent: "/1/5", Index: 2    → "/1/5/2" (Section 2 in Article 5)
```

## 2. Parser Implementations

### 2.1 BOE XML Parser (Spanish Official Gazette)

```typescript
// services/parsers/boe-xml-parser.ts
import { XMLParser } from "fast-xml-parser";
import { Effect } from "effect";

interface BoeDocument {
  metadata: {
    identifier: string;
    title: string;
    publicationDate: string;
  };
  xml: string;
}

interface Fragment {
  content: string;
  nodePath: string;
  nodeType: string;
  nodeNumber?: string;
  nodeTitle?: string;
  precedingContext?: string;
  followingContext?: string;
}

export const parseBoeXml = Effect.fn("BoeParser.parseXml")((doc: BoeDocument) =>
  Effect.sync(() => {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      textNodeName: "#text",
    });

    const parsed = parser.parse(doc.xml);
    const fragments: Fragment[] = [];

    // Recursive traversal function
    const traverse = (
      node: any,
      parentPath: string = "/",
      depth: number = 0,
      siblingIndex: number = 0,
    ): void => {
      const currentPath = generateNodePath(parentPath, siblingIndex);

      // Identify node type based on XML tag
      const nodeType = identifyNodeType(node);

      if (nodeType) {
        const content = extractContent(node);
        const number = extractNumber(node, nodeType);
        const title = extractTitle(node, nodeType);

        if (content) {
          fragments.push({
            content,
            nodePath: currentPath,
            nodeType,
            nodeNumber: number,
            nodeTitle: title,
          });
        }
      }

      // Process children recursively
      const children = getChildren(node);
      children.forEach((child, idx) => {
        traverse(child, currentPath, depth + 1, idx + 1);
      });
    };

    traverse(parsed.documento || parsed);

    // Add context to each fragment
    return addContextToFragments(fragments);
  }),
);

// Helper: Identify node type from XML structure
const identifyNodeType = (node: any): string | null => {
  if (node.articulo || node["#name"] === "articulo") return "article";
  if (node.capitulo || node["#name"] === "capitulo") return "chapter";
  if (node.seccion || node["#name"] === "seccion") return "section";
  if (node.parrafo || node["#name"] === "parrafo") return "paragraph";
  if (node.anexo || node["#name"] === "anexo") return "annex";
  if (node.nota || node["#name"] === "nota") return "note";
  return null;
};

// Helper: Extract content from node
const extractContent = (node: any): string => {
  if (typeof node === "string") return node.trim();

  // Handle different XML structures
  if (node["#text"]) return node["#text"].trim();
  if (node.p) {
    const paragraphs = Array.isArray(node.p) ? node.p : [node.p];
    return paragraphs
      .map((p) => {
        if (typeof p === "string") return p;
        return p["#text"] || "";
      })
      .join("\n\n")
      .trim();
  }

  return "";
};

// Helper: Extract number from node
const extractNumber = (node: any, type: string): string | undefined => {
  const num = node["@_num"] || node.num;
  if (num) return String(num);

  // Try to extract from title
  const title = extractTitle(node, type);
  if (title) {
    const match = title.match(/^(?:Artículo|Article)\s+(\d+\s*(?:\.\s*\d+)?)/i);
    if (match) return match[1].replace(/\s/g, "");
  }

  return undefined;
};

// Helper: Extract title from node
const extractTitle = (node: any, type: string): string | undefined => {
  const titleNode = node.titulo || node.rubrica || node["@_titulo"];
  if (titleNode) {
    return typeof titleNode === "string" ? titleNode : titleNode["#text"] || titleNode;
  }

  // Try derogado/expediente for BOE
  if (node.derogado) return "Derogado";
  if (node.expediente) return `Expediente: ${node.expediente}`;

  return undefined;
};

// Helper: Get children nodes
const getChildren = (node: any): any[] => {
  if (!node || typeof node !== "object") return [];

  const childKeys = ["articulo", "capitulo", "seccion", "parrafo", "anexo", "nota", "subseccion"];

  const children: any[] = [];

  for (const key of childKeys) {
    if (node[key]) {
      const childNodes = Array.isArray(node[key]) ? node[key] : [node[key]];
      children.push(...childNodes.map((n) => ({ ...n, "#name": key })));
    }
  }

  return children;
};
```

### 2.2 Plain Text Parser (Heuristic-based)

```typescript
// services/parsers/plain-text-parser.ts

interface ParseOptions {
  documentType: "boe" | "eurlex" | "generic";
  language: string;
}

export const parsePlainText = Effect.fn("PlainTextParser.parse")(
  (content: string, options: ParseOptions) =>
    Effect.sync(() => {
      const fragments: Fragment[] = [];
      const lines = content.split("\n");

      // State tracking
      let currentChapter = 0;
      let currentArticle = 0;
      let currentSection = 0;
      let currentParagraph = 0;
      let buffer: string[] = [];
      let currentType: string | null = null;
      let currentNumber: string | null = null;
      let currentTitle: string | null = null;

      // Patterns for different document types
      const patterns = getPatterns(options.documentType, options.language);

      const flushBuffer = () => {
        if (buffer.length > 0 && currentType) {
          const content = buffer.join("\n").trim();
          if (content) {
            const nodePath = buildNodePath(
              currentChapter,
              currentArticle,
              currentSection,
              currentParagraph,
            );

            fragments.push({
              content,
              nodePath,
              nodeType: currentType,
              nodeNumber: currentNumber || undefined,
              nodeTitle: currentTitle || undefined,
            });
          }
          buffer = [];
        }
      };

      for (const line of lines) {
        const trimmed = line.trim();

        // Check for chapter
        const chapterMatch = trimmed.match(patterns.chapter);
        if (chapterMatch) {
          flushBuffer();
          currentChapter++;
          currentArticle = 0;
          currentSection = 0;
          currentParagraph = 0;
          currentType = "chapter";
          currentNumber = chapterMatch[1];
          currentTitle = chapterMatch[2];
          buffer.push(trimmed);
          continue;
        }

        // Check for article
        const articleMatch = trimmed.match(patterns.article);
        if (articleMatch) {
          flushBuffer();
          currentArticle++;
          currentSection = 0;
          currentParagraph = 0;
          currentType = "article";
          currentNumber = articleMatch[1];
          currentTitle = articleMatch[2];
          buffer.push(trimmed);
          continue;
        }

        // Check for section
        const sectionMatch = trimmed.match(patterns.section);
        if (sectionMatch) {
          flushBuffer();
          currentSection++;
          currentParagraph = 0;
          currentType = "section";
          currentNumber = sectionMatch[1];
          currentTitle = sectionMatch[2];
          buffer.push(trimmed);
          continue;
        }

        // Check for paragraph
        const paraMatch = trimmed.match(patterns.paragraph);
        if (paraMatch && currentType === "article") {
          flushBuffer();
          currentParagraph++;
          currentType = "paragraph";
          currentNumber = paraMatch[1];
          buffer.push(trimmed);
          continue;
        }

        // Accumulate content
        if (trimmed) {
          buffer.push(trimmed);
        }
      }

      flushBuffer();

      return addContextToFragments(fragments);
    }),
);

// Pattern definitions
const getPatterns = (type: string, lang: string) => {
  const patterns: Record<string, any> = {
    boe: {
      chapter: /^(?:CAPÍTULO|CAPITULO|CHAPTER)\s+(?:[IVX]+|\d+)[.:]?\s*(.+)?$/i,
      article: /^(?:ARTÍCULO|ARTICULO|ARTICLE)\s+(\d+[\s\.]?(?:\d+)?)[.:]?\s*(.+)?$/i,
      section: /^(?:SECCIÓN|SECCION|SECTION)\s+(?:[\d\.]+|\d+)[.:]?\s*(.+)?$/i,
      paragraph: /^([a-z]|[\d]+)[.)]\s+(.+)$/i,
    },
    eurlex: {
      chapter: /^Chapter\s+(\d+)[.:]?\s*(.+)?$/i,
      article: /^Article\s+(\d+)[.:]?\s*(.+)?$/i,
      section: /^Section\s+(\d+)[.:]?\s*(.+)?$/i,
      paragraph: /^(\d+)\.\s+(.+)$/i,
    },
    generic: {
      chapter: /^(?:Chapter|Capítulo)\s+(\d+|[IVX]+)[.:]?/i,
      article: /^(?:Article|Artículo)\s+(\d+)[.:]?/i,
      section: /^(?:Section|Sección)\s+(\d+)[.:]?/i,
      paragraph: /^(?:\d+|[a-z])[.)]\s*/i,
    },
  };

  return patterns[type] || patterns.generic;
};

const buildNodePath = (
  chapter: number,
  article: number,
  section: number,
  paragraph: number,
): string => {
  if (paragraph > 0) return `/${chapter}/${article}/${section}/${paragraph}`;
  if (section > 0) return `/${chapter}/${article}/${section}`;
  if (article > 0) return `/${chapter}/${article}`;
  if (chapter > 0) return `/${chapter}`;
  return "/";
};
```

### 2.3 HTML Parser (for web-scraped documents)

```typescript
// services/parsers/html-parser.ts
import { load } from "cheerio";

export const parseHtmlDocument = Effect.fn("HtmlParser.parse")((html: string) =>
  Effect.sync(() => {
    const $ = load(html);
    const fragments: Fragment[] = [];

    // Find semantic elements
    const selectors = [
      { type: "chapter", selector: "h1, .chapter, [class*='capitulo']" },
      { type: "article", selector: "h2, .article, [class*='articulo'], article" },
      { type: "section", selector: "h3, .section, [class*='seccion']" },
      { type: "paragraph", selector: "p, .paragraph, [class*='parrafo']" },
    ];

    let chapterIdx = 0;
    let articleIdx = 0;
    let sectionIdx = 0;
    let paraIdx = 0;

    $("body")
      .children()
      .each((_, elem) => {
        const $elem = $(elem);
        const tagName = elem.tagName.toLowerCase();
        const text = $elem.text().trim();

        if (!text) return;

        // Identify type
        let nodeType: string | null = null;
        let number: string | null = null;
        let title: string | null = null;

        if (tagName === "h1" || $elem.hasClass("chapter")) {
          nodeType = "chapter";
          chapterIdx++;
          articleIdx = 0;
          sectionIdx = 0;
          paraIdx = 0;
          const match = text.match(/^(?:Chapter|Capítulo)\s+([\dIVX]+)[.:]?\s*(.+)?/i);
          if (match) {
            number = match[1];
            title = match[2];
          }
        } else if (tagName === "h2" || $elem.hasClass("article")) {
          nodeType = "article";
          articleIdx++;
          sectionIdx = 0;
          paraIdx = 0;
          const match = text.match(/^(?:Article|Artículo)\s+(\d+)[.:]?\s*(.+)?/i);
          if (match) {
            number = match[1];
            title = match[2];
          }
        } else if (tagName === "h3" || $elem.hasClass("section")) {
          nodeType = "section";
          sectionIdx++;
          paraIdx = 0;
          const match = text.match(/^(?:Section|Sección)\s+(\d+)[.:]?\s*(.+)?/i);
          if (match) {
            number = match[1];
            title = match[2];
          }
        } else if (tagName === "p" || $elem.hasClass("paragraph")) {
          nodeType = "paragraph";
          paraIdx++;
          // Try to extract paragraph number
          const match = text.match(/^([a-z]|\d+)[.)]\s*/);
          if (match) {
            number = match[1];
          }
        }

        if (nodeType) {
          const nodePath = buildNodePath(chapterIdx, articleIdx, sectionIdx, paraIdx);
          fragments.push({
            content: text,
            nodePath,
            nodeType,
            nodeNumber: number || undefined,
            nodeTitle: title || undefined,
          });
        }
      });

    return addContextToFragments(fragments);
  }),
);
```

## 3. Context Addition

```typescript
// Add preceding/following context to fragments
const addContextToFragments = (fragments: Fragment[]): Fragment[] => {
  return fragments.map((fragment, index) => {
    const prev = fragments[index - 1];
    const next = fragments[index + 1];

    return {
      ...fragment,
      precedingContext: prev?.content.slice(-200), // Last 200 chars
      followingContext: next?.content.slice(0, 200), // First 200 chars
    };
  });
};
```

## 4. Integration with Collectors

```typescript
// collectors/boe/factory.ts - add to your existing code

const extractFragmentsFromLaw = Effect.fn("BoeCollector.extractFragments")(
  (law: BoeLawItem, contentText: string) =>
    Effect.gen(function* () {
      // Parse the consolidated text
      const fragments = yield* parsePlainText(contentText, {
        documentType: "boe",
        language: "es",
      });

      // Map to database schema
      return fragments.map((frag, idx) => ({
        fragmentId: crypto.randomUUID(),
        docId: law.canonicalId,
        versionId: null, // Will be set after version creation
        content: frag.content,
        contentNormalized: normalizeText(frag.content),
        nodePath: frag.nodePath,
        nodeType: frag.nodeType,
        nodeNumber: frag.nodeNumber,
        nodeTitle: frag.nodeTitle,
        precedingContext: frag.precedingContext,
        followingContext: frag.followingContext,
        sequenceIndex: idx,
        contentFingerprint: hashContent(frag.content),
      }));
    }),
);
```

## 5. Testing Your Parser

```typescript
// test/parsers/boe-parser.test.ts

const sampleBoeText = `
CAPÍTULO I
Disposiciones generales

Artículo 1. Objeto.
La presente ley tiene por objeto regular...

Artículo 2. Ámbito de aplicación.
1. Esta ley es de aplicación...
2. No obstante, quedan excluidas...

SECCIÓN 1. Definiciones

Artículo 3. Definiciones.
A los efectos de esta ley, se entiende por:
a) Administración: el conjunto...
b) Documento: cualquier representación...
`;

const result = parsePlainText(sampleBoeText, { documentType: "boe", language: "es" });

// Expected output:
// [
//   { nodePath: "/1", nodeType: "chapter", nodeNumber: "1", content: "CAPÍTULO I..." },
//   { nodePath: "/1/1", nodeType: "article", nodeNumber: "1", content: "Artículo 1..." },
//   { nodePath: "/1/2", nodeType: "article", nodeNumber: "2", content: "Artículo 2..." },
//   { nodePath: "/1/2/1", nodeType: "paragraph", nodeNumber: "1", content: "1. Esta ley..." },
//   { nodePath: "/1/2/2", nodeType: "paragraph", nodeNumber: "2", content: "2. No obstante..." },
//   { nodePath: "/1/2/1", nodeType: "section", nodeNumber: "1", content: "SECCIÓN 1..." },
//   { nodePath: "/1/2/1/3", nodeType: "article", nodeNumber: "3", content: "Artículo 3..." },
// ]
```

## 6. Key Takeaways

1. **Node paths are generated during parsing** - not stored in source
2. **Use regex patterns** to identify document structure
3. **Maintain counters** for each hierarchy level
4. **Flush buffers** when encountering a new node type
5. **Add context** by looking at adjacent fragments
6. **Test with real documents** - legal text has many edge cases

The parser is the critical first step - once you have fragments with proper node paths, the rest of the embedding and search pipeline works automatically.
