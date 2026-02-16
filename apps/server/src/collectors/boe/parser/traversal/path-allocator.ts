import type { NodePath, NodePathSegment } from "../types";
import { NodePathString } from "../types";

export const Path = {
  chapter: (index: number): NodePathSegment => ({ _tag: "chapter", index }),
  article: (index: number): NodePathSegment => ({ _tag: "article", index }),
  paragraph: (index: number): NodePathSegment => ({ _tag: "paragraph", index }),
  subparagraph: (index: number): NodePathSegment => ({ _tag: "subparagraph", index }),
  annex: (index: number): NodePathSegment => ({ _tag: "annex", index }),
  table: (index: number): NodePathSegment => ({ _tag: "table", index }),
  section: (index: number): NodePathSegment => ({ _tag: "section", index }),
  header: (index: number): NodePathSegment => ({ _tag: "header", index }),
};

export const renderPath = (path: NodePath) => {
  const rendered = `/${path
    .map((segment) => {
      switch (segment._tag) {
        case "chapter":
          return `c/${segment.index}`;
        case "article":
          return `a/${segment.index}`;
        case "paragraph":
          return `p/${segment.index}`;
        case "subparagraph":
          return `sp/${segment.index}`;
        case "annex":
          return `x/${segment.index}`;
        case "table":
          return `t/${segment.index}`;
        case "section":
          return `s/${segment.index}`;
        case "header":
          return `h/${segment.index}`;
      }
    })
    .join("/")}`;

  return NodePathString(rendered);
};
