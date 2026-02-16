import {
  normalizeArticleHeader,
  normalizeChapterHeader,
  normalizeSubparagraph,
} from "../normalize";
import type { BoeTextNode, LinearBlock } from "../types";
import type { ClassifiedBlock } from "./types";

export const classifyBlock = (block: LinearBlock): ClassifiedBlock => {
  if (block.kind === "table") {
    return { _tag: "table", content: block.text };
  }

  const cls = block.className;
  const content = block.text;

  if (cls === "capitulo" || cls === "titulo" || cls === "centro_redonda") {
    const chapter = normalizeChapterHeader(content);
    return {
      _tag: "chapter",
      title: chapter.title,
      isSpecial: chapter.isSpecial,
    };
  }

  if (cls === "titulo_num") {
    return {
      _tag: "titleHeading",
      title: content,
    };
  }

  if (cls === "titulo_tit") {
    return {
      _tag: "paragraph",
      content,
    };
  }

  if (cls === "capitulo_num") {
    const chapter = normalizeChapterHeader(content);
    return {
      _tag: "chapter",
      title: chapter.title,
      isSpecial: chapter.isSpecial,
    };
  }

  if (cls === "capitulo_tit") {
    return {
      _tag: "paragraph",
      content,
    };
  }

  if (cls === "seccion") {
    return {
      _tag: "sectionHeading",
      title: content,
    };
  }

  if (cls === "articulo") {
    const article = normalizeArticleHeader(content);
    return {
      _tag: "article",
      number: article.number,
      title: article.title,
      content,
    };
  }

  if (cls === "centro_cursiva") {
    return { _tag: "subsection", title: content };
  }

  if (cls === "anexo_num") {
    return { _tag: "annexNumber", number: content };
  }

  if (cls === "anexo_tit") {
    return { _tag: "annexTitle", title: content };
  }

  if (cls === "parrafo_2") {
    const subparagraph = normalizeSubparagraph(content);
    if (subparagraph.marker.length > 0) {
      return {
        _tag: "subparagraph",
        marker: subparagraph.marker,
        content: subparagraph.content,
      };
    }

    return {
      _tag: "paragraph",
      content: subparagraph.content,
    };
  }

  if (cls === "firma_rey" || cls === "firma_ministro") {
    return {
      _tag: "signature",
      role: cls,
      content,
    };
  }

  if (cls === "parrafo") {
    return { _tag: "paragraph", content };
  }

  return {
    _tag: "raw",
    content,
    className: cls,
  };
};

export const toTextNode = (token: ClassifiedBlock): BoeTextNode => {
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
};
