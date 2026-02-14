# BOE XML Format Analysis: Patterns vs Inconsistencies

## Executive Summary

After analyzing multiple BOE XML documents, what initially appears to be "inconsistency" is actually a **well-structured typology** based on document classification. The BOE uses different structural patterns depending on the document's legal nature (Law vs Order vs Resolution) and its section placement.

---

## 1. Document Type Classification

### 1.1 Primary Classification (By Legal Nature)

```typescript
type DocumentRango =
  | "1340" // Real Decreto (Royal Decree) - Has full structure
  | "1350" // Orden (Order) - Simple structure
  | "1370" // Resolución (Resolution) - Simple structure
  | "1320" // Ley (Law) - Has full structure
  | "1400"; // Corrección de errores (Correction) - Minimal structure
```

### 1.2 Secondary Classification (By BOE Section)

```typescript
type BoeSection =
  | "1" // Sección I - Disposiciones generales (Full laws/decrees)
  | "2" // Sección II - Autoridades y personal (Appointments)
  | "3"; // Sección III - Oposiciones (Job announcements)
```

---

## 2. Structural Patterns Discovered

### Pattern A: "Full Legislative" Structure

**Applies to:** `rango_codigo = "1340" | "1320"` (Royal Decrees, Laws)  
**BOE Section:** Usually "1" (Disposiciones generales)

```xml
<texto>
  <!-- Preámbulo (introductory paragraphs) -->
  <p class="parrafo">La Ley 4/1989... establece que...</p>
  <p class="parrafo">Este Real Decreto tiene por objeto...</p>

  <!-- Enactment clause -->
  <p class="centro_redonda">DISPONGO:</p>

  <!-- TÍTULO PRELIMINAR (if present) -->
  <p class="titulo">TÍTULO PRELIMINAR</p>
  <p class="articulo">Artículo 1.º</p>
  <p class="parrafo">1. Esta ley tiene por objeto...</p>
  <p class="parrafo">2. Se entenderá por...</p>

  <!-- CAPÍTULOS -->
  <p class="capitulo">CAPÍTULO I</p>
  <p class="capitulo">Disposiciones generales</p>

  <p class="articulo">Artículo 2.º</p>
  <p class="parrafo">1. Quedan obligados al cumplimiento...</p>
  <p class="parrafo_2">a) Personas físicas...</p>
  <p class="parrafo_2">b) Personas jurídicas...</p>

  <!-- DISPOSICIONES ADICIONALES -->
  <p class="capitulo">[encabezado]DISPOSICIONES ADICIONALES</p>
  <p class="articulo">[precepto]Primera.</p>
  <p class="parrafo">Los artículos 1.1, 3.1... tendrán el carácter...</p>

  <p class="articulo">[precepto]Segunda.</p>
  <p class="parrafo">En aplicación de la disposición adicional cuarta...</p>

  <!-- DISPOSICIÓN DEROGATORIA -->
  <p class="capitulo">DISPOSICIÓN DEROGATORIA</p>
  <p class="parrafo">Queda derogado el artículo 4 del Decreto 506/1971...</p>

  <!-- DISPOSICIONES FINALES -->
  <p class="capitulo">[encabezado]DISPOSICIONES FINALES</p>
  <p class="articulo">[precepto]Primera.</p>
  <p class="parrafo">Se faculta al Ministro... para dictar las normas...</p>

  <!-- Firmas -->
  <p class="parrafo_2">Dado en Madrid a 8 de septiembre de 1989.</p>
  <p class="firma_rey">JUAN CARLOS R.</p>
  <p class="firma_ministro">El Ministro de Agricultura, Pesca y Alimentación,</p>
  <p class="firma_ministro">CARLOS ROMERO HERRERA</p>

  <!-- ANEXOS -->
  <p class="anexo_num">ANEXO I</p>
  <p class="anexo_tit">Relación de especies objeto de caza y pesca...</p>
  <p class="centro_cursiva">Mamíferos</p>
  <p class="parrafo">Liebre (Lepus spp.).</p>
  <p class="parrafo">Conejo (Oryctolagus cuniculus).</p>
  <p class="centro_cursiva">Aves</p>
  <p class="parrafo">Ansar común (Anser anser).</p>
</texto>
```

**Key Pattern:**

- Uses `[encabezado]` and `[precepto]` attributes in `capitulo`/`articulo` for special sections
- Has full hierarchy: Capítulo → Artículo → Párrafo → Subpárrafo (a, b, c)
- Includes annexes with separate numbering

---

### Pattern B: "Simple Administrative" Structure

**Applies to:** `rango_codigo = "1350" | "1370"` (Orders, Resolutions)  
**BOE Section:** Usually "2" (Autoridades y personal)

```xml
<texto>
  <!-- Main text (no preamble) -->
  <p class="parrafo">
    De conformidad con lo dispuesto en el artículo 16.2 de la Ley 50/1997...
    vengo a nombrar Director del Gabinete... a don Diego Sancho Moleres Ollivier...
  </p>

  <!-- Closing paragraph with signature -->
  <p class="parrafo_2">Madrid, 17 de enero de 2024.–El Ministro de Economía...</p>
</texto>
```

**Key Pattern:**

- No chapters, articles, or complex structure
- Single or few paragraphs
- Signature in `parrafo_2` (indented)
- May include tables (`<table>` with classes `tabla_ancha`, `cabeza_tabla`, `cuerpo_tabla`)

---

### Pattern C: "Job Announcement" Structure

**Applies to:** `rango_codigo = "1370"` (Resolutions)  
**BOE Section:** "2-B" (Oposiciones)

```xml
<texto>
  <!-- Reference to original publication -->
  <p class="parrafo_2">
    En el «Boletín Oficial de la Provincia de Pontevedra» número 42,
    de 28 de febrero de 2024, se han publicado las bases...
  </p>

  <!-- Position description -->
  <p class="parrafo_2">
    Una plaza de Conductor/a de tractor...
  </p>

  <!-- Application period -->
  <p class="parrafo">
    El plazo de presentación de solicitudes será de veinte días...
  </p>

  <!-- Signature -->
  <p class="parrafo_2">Cambados, 12 de abril de 2024.–El Presidente, David José Castro Mougán.</p>
</texto>
```

**Key Pattern:**

- Uses `parrafo_2` for almost all content (indented paragraphs)
- References to external publications (provincial bulletins)
- No legal articles or provisions

---

## 3. Real Inconsistencies Found

### 3.1 Article Numbering Formats

**Inconsistency:** Article headers use different formats

```xml
<!-- Format 1: With ordinal symbol -->
<p class="articulo">Artículo 1.º</p>

<!-- Format 2: With period but no ordinal -->
<p class="articulo">Art. 2.º</p>

<!-- Format 3: Abbreviated -->
<p class="articulo">Art. 3.º</p>

<!-- Format 4: With title in same element -->
<p class="articulo">Artículo 5.º Objeto.</p>

<!-- Format 5: Precepto format (in special sections) -->
<p class="articulo">[precepto]Primera.</p>
<p class="articulo">[precepto]Disposición transitoria única.</p>
```

**Solution:** Use flexible regex pattern

```typescript
const extractArticleNumber = (content: string): { number: string; title?: string } => {
  // Matches: "Artículo 1.º", "Art. 2.º", "Art 3", "[precepto]Primera."
  const patterns = [
    /\[?precepto\]?\s*(Primera|Segunda|Tercera|Cuarta|Quinta|Disposición transitoria única)/i,
    /Art\.?\s*(?:ículo\s*)?(\d+[\s\.]?º?)(?:\s*[.:]\s*(.+))?/i,
  ];

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match) {
      return {
        number: match[1],
        title: match[2],
      };
    }
  }

  return { number: content, title: undefined };
};
```

---

### 3.2 Chapter Header Format

**Inconsistency:** Chapter titles vary in format

```xml
<!-- Format 1: Roman numeral + title -->
<p class="capitulo">CAPÍTULO I</p>
<p class="capitulo">Disposiciones generales</p>

<!-- Format 2: With [encabezado] attribute -->
<p class="capitulo">[encabezado]DISPOSICIONES ADICIONALES</p>

<!-- Format 3: Single line -->
<p class="capitulo">DISPOSICIÓN DEROGATORIA</p>

<!-- Format 4: Title only -->
<p class="capitulo">TÍTULO PRELIMINAR</p>
```

**Solution:** Check for `[encabezado]` marker and clean text

```typescript
const extractChapterTitle = (content: string): { title: string; isSpecial?: boolean } => ({
  title: content.replace(/^\[encabezado\]/, "").trim(),
  isSpecial: content.includes("[encabezado]"),
});
```

---

### 3.3 Sub-paragraph Markers

**Inconsistency:** Lettered sub-paragraphs use different formats

```xml
<!-- Format 1: Letter followed by parenthesis -->
<p class="parrafo_2">a) No afecte a la diversidad genética...</p>

<!-- Format 2: Letter followed by period -->
<p class="parrafo_2">a. Deberán cumplirse las siguientes condiciones...</p>

<!-- Format 3: Number followed by period -->
<p class="parrafo_2">1. Se entenderá por...</p>
```

**Solution:** Detect and extract marker separately

```typescript
const extractSubparagraphMarker = (content: string): { marker: string; content: string } => {
  const match = content.match(/^([a-z]|\d+)[.)]\s*/i);
  if (match) {
    return {
      marker: match[1],
      content: content.slice(match[0].length).trim(),
    };
  }
  return { marker: "", content };
};
```

---

### 3.4 Content in Article Elements

**Inconsistency:** Some articles contain full content, others just headers

```xml
<!-- Case 1: Article has content -->
<p class="articulo">Artículo 1.º Objeto y ámbito de aplicación.</p>
<p class="parrafo">1. Esta ley tiene por objeto...</p>
<p class="parrafo">2. Se entenderá por espacio natural...</p>

<!-- Case 2: Article is header only -->
<p class="articulo">Artículo 2.º</p>
<p class="parrafo">Las disposiciones de esta ley son de aplicación...</p>

<!-- Case 3: Article with sub-paragraphs immediately -->
<p class="articulo">Artículo 3.º Obligaciones.</p>
<p class="parrafo_2">a) Informar sobre...</p>
<p class="parrafo_2">b) Cumplir con...</p>
```

**Solution:** Always treat `articulo` as header, accumulate following paragraphs until next header

```typescript
const groupByArticles = (nodes: BoeTextNode[]): ArticleGroup[] => {
  const groups: ArticleGroup[] = [];
  let currentGroup: ArticleGroup | null = null;

  for (const node of nodes) {
    if (node._tag === "article") {
      // Start new group
      if (currentGroup) groups.push(currentGroup);
      currentGroup = {
        article: node,
        content: [],
      };
    } else if (currentGroup) {
      // Add to current group
      currentGroup.content.push(node);
    }
  }

  if (currentGroup) groups.push(currentGroup);
  return groups;
};
```

---

### 3.5 Table Structures

**Real Inconsistency:** Tables appear in simple documents, not just complex ones

```xml
<!-- Administrative resolution with table -->
<table class="tabla_ancha">
  <colgroup>...</colgroup>
  <thead>
    <tr>
      <th class="cabeza_tabla">N.º de orden</th>
      <th class="cabeza_tabla">Código puesto</th>
      ...
    </tr>
  </thead>
  <tbody>
    <tr>
      <td class="cuerpo_tabla_centro">1</td>
      <td class="cuerpo_tabla_izq">1400460</td>
      ...
    </tr>
  </tbody>
</table>
```

**Solution:** Handle tables as special content blocks

```typescript
const extractTableContent = (table: any): string => {
  const rows: string[] = [];

  // Extract headers
  const headers = table.thead?.tr?.th?.map((h: any) => h["#text"] || "").join(" | ");
  if (headers) rows.push(headers);

  // Extract body rows
  const bodyRows = table.tbody?.tr || [];
  for (const row of Array.isArray(bodyRows) ? bodyRows : [bodyRows]) {
    const cells = row.td?.map((d: any) => d["#text"] || "").join(" | ");
    if (cells) rows.push(cells);
  }

  return rows.join("\n");
};
```

---

## 4. Parsing Strategy by Document Type

### 4.1 Decision Tree

```typescript
const determineParsingStrategy = (doc: BoeXmlDocument): ParsingStrategy => {
  const { rango, seccion } = doc.metadata;

  // Primary decision: Legal nature
  if (["1340", "1320"].includes(rango.codigo)) {
    // Royal Decrees and Laws: Full legislative parser
    return "legislative";
  }

  // Secondary decision: Section for administrative docs
  if (seccion === "2" && seccion.subseccion === "B") {
    // Job announcements
    return "announcement";
  }

  if (seccion === "2") {
    // Appointments and simple resolutions
    return "simple";
  }

  // Fallback
  return "generic";
};
```

### 4.2 Strategy Implementations

```typescript
// strategies/legislative.ts
export const parseLegislativeDocument = (doc: BoeXmlDocument): BoeFragment[] => {
  const fragments: BoeFragment[] = [];
  let chapterIdx = 0;
  let articleIdx = 0;
  let paragraphIdx = 0;
  let currentArticle: string | null = null;
  let inAnnex = false;
  let annexIdx = 0;

  for (const node of doc.text) {
    switch (node._tag) {
      case "chapter": {
        const { title, isSpecial } = extractChapterTitle(node.content);

        if (isSpecial || title.includes("DISPOSICIÓN")) {
          // Special sections (Disposiciones Adicionales, Finales, etc.)
          chapterIdx++;
          articleIdx = 0;
        } else if (title.match(/^CAPÍTULO\s+[IVX\d]+/i)) {
          // Regular chapter
          chapterIdx++;
          articleIdx = 0;
          inAnnex = false;
        } else if (title.includes("ANEXO")) {
          // Annex section
          inAnnex = true;
          annexIdx++;
        }
        break;
      }

      case "article": {
        const { number, title } = extractArticleNumber(node.content);
        articleIdx++;
        paragraphIdx = 0;
        currentArticle = number;

        // Article headers are not fragments themselves, just metadata
        break;
      }

      case "paragraph":
      case "subparagraph": {
        paragraphIdx++;

        const nodePath = inAnnex
          ? `/anexo/${annexIdx}/${paragraphIdx}`
          : currentArticle
            ? `/${chapterIdx || 1}/${currentArticle}/${paragraphIdx}`
            : `/${paragraphIdx}`;

        fragments.push({
          content: node._tag === "subparagraph" ? `${node.marker}) ${node.content}` : node.content,
          nodePath,
          nodeType: node._tag,
          nodeNumber: currentArticle || undefined,
          metadata: doc.metadata,
        });
        break;
      }

      case "table": {
        // Extract table as single fragment
        fragments.push({
          content: extractTableContent(node),
          nodePath: inAnnex
            ? `/anexo/${annexIdx}/tabla`
            : `/${chapterIdx || 1}/${currentArticle || "0"}/tabla`,
          nodeType: "table",
          metadata: doc.metadata,
        });
        break;
      }
    }
  }

  return fragments;
};

// strategies/simple.ts
export const parseSimpleDocument = (doc: BoeXmlDocument): BoeFragment[] => {
  // Simple documents: just paragraphs, no hierarchy
  return doc.text
    .filter((n) => n._tag === "paragraph" || n._tag === "subparagraph")
    .map((node, idx) => ({
      content: node.content,
      nodePath: `/${idx + 1}`,
      nodeType: node._tag,
      metadata: doc.metadata,
    }));
};
```

---

## 5. Summary

### What Appeared to Be Inconsistencies

| "Inconsistency"             | Reality                     | Solution                      |
| --------------------------- | --------------------------- | ----------------------------- |
| Different paragraph classes | Document type specific      | Use strategy pattern          |
| Article format variations   | Flexible legal notation     | Regex with multiple patterns  |
| Missing structure           | Simple document type        | Branch to simple parser       |
| `[encabezado]` attribute    | Marker for special sections | Strip and flag                |
| Tables in simple docs       | Data-heavy announcements    | Extract as separate fragments |

### Key Insights

1. **BOE XML is actually very consistent** within document types
2. **Variations are semantic, not structural** - they follow legal conventions
3. **Document classification (rango + seccion) determines structure**
4. **Graceful degradation works** - unknown classes → raw fragments

### Recommended Parser Architecture

```typescript
// Main entry point
export const parseBoeDocument = Effect.fn("BoeParser.parse")((xml: string) =>
  Effect.gen(function* () {
    // 1. Parse raw XML
    const raw = yield* parseRawXml(xml);

    // 2. Determine strategy
    const strategy = determineParsingStrategy(raw.metadata);

    // 3. Apply appropriate parser
    const fragments = match(strategy)
      .with("legislative", () => parseLegislativeDocument(raw))
      .with("simple", () => parseSimpleDocument(raw))
      .with("announcement", () => parseAnnouncementDocument(raw))
      .otherwise(() => parseGenericDocument(raw));

    return fragments;
  }),
);
```

This architecture handles all observed "inconsistencies" elegantly through strategy selection rather than complex conditional logic.
