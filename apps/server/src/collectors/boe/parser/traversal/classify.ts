import {
  normalizeArticleHeader,
  normalizeChapterHeader,
  normalizeSubparagraph,
} from "../normalize";
import type { BoeTextNode, LinearBlock } from "../types";
import type { ClassifiedBlock } from "./types";

export function classifyBlock(block: LinearBlock): ClassifiedBlock {
  if (block.kind === "table") {
    return { _tag: "table", content: block.text };
  }

  const handler = CLASSIFIER_RULES[block.className];
  if (handler !== undefined) {
    return handler(block.text, block.className);
  }

  return {
    _tag: "raw",
    content: block.text,
    className: block.className,
  };
}

export function toTextNode(token: ClassifiedBlock): BoeTextNode {
  switch (token._tag) {
    case "table":
      return { _tag: "raw", content: token.content };
    case "titleHeading":
      return { _tag: "chapter", title: token.title };
    case "chapter":
      return { _tag: "chapter", title: token.title };
    case "sectionHeading":
      return { _tag: "section", title: token.title };
    case "article":
      return { _tag: "article", number: token.number, title: token.title };
    case "subsection":
      return { _tag: "subsection", title: token.title };
    case "annexNumber":
      return { _tag: "annex", number: token.number, title: "" };
    case "annexTitle":
      return { _tag: "annex", number: "", title: token.title };
    case "subparagraph":
      return { _tag: "subparagraph", marker: token.marker, content: token.content };
    case "paragraph":
      return { _tag: "paragraph", content: token.content };
    case "signature":
      return { _tag: "signature", role: token.role, content: token.content };
    case "raw":
      return { _tag: "raw", content: token.content };
  }
}

const isAlphabeticMarker = (marker: string): boolean => /^[a-z]$/i.test(marker);
const isOrdinalMarker = (marker: string): boolean => /^\d+[ªº]$/i.test(marker);

type ClassifierRule = (content: string, className: string) => ClassifiedBlock;

function chapterRule(content: string): ClassifiedBlock {
  const chapter = normalizeChapterHeader(content);
  return {
    _tag: "chapter",
    title: chapter.title,
    isSpecial: chapter.isSpecial,
  };
}

function paragraphOrSubparagraphRule(content: string): ClassifiedBlock {
  const subparagraph = normalizeSubparagraph(content);
  if (isAlphabeticMarker(subparagraph.marker) || isOrdinalMarker(subparagraph.marker)) {
    return {
      _tag: "subparagraph",
      marker: subparagraph.marker,
      content: subparagraph.content,
    };
  }

  return {
    _tag: "paragraph",
    content,
  };
}

function signatureRule(content: string, className: string): ClassifiedBlock {
  return {
    _tag: "signature",
    role: className,
    content,
  };
}

function articleRule(content: string): ClassifiedBlock {
  const article = normalizeArticleHeader(content);
  return {
    _tag: "article",
    number: article.number,
    title: article.title,
    content,
  };
}

export const CLASSIFIER_RULES: Readonly<Record<string, ClassifierRule>> = {
  capitulo: chapterRule,
  titulo: chapterRule,
  centro_redonda: chapterRule,
  capitulo_num: chapterRule,
  titulo_num: (content) => ({ _tag: "titleHeading", title: content }),
  titulo_tit: (content) => ({ _tag: "paragraph", content }),
  capitulo_tit: (content) => ({ _tag: "paragraph", content }),
  seccion: (content) => ({ _tag: "sectionHeading", title: content }),
  articulo: articleRule,
  centro_cursiva: (content) => ({ _tag: "subsection", title: content }),
  anexo_num: (content) => ({ _tag: "annexNumber", number: content }),
  anexo_tit: (content) => ({ _tag: "annexTitle", title: content }),
  parrafo_2: paragraphOrSubparagraphRule,
  parrafo: paragraphOrSubparagraphRule,
  firma_rey: signatureRule,
  firma_ministro: signatureRule,
};
