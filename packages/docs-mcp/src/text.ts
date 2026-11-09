import { DocType, Need } from "@dooc/docs-api";

export class Std {
  static markdown(): string {
    return [
      "# Markdown standard",
      "",
      "Markdown is the document body. MDX is only for a page that needs interaction.",
      "Keep the stable frontmatter id. Do not store annotations in the Markdown file.",
      `Required keys: ${[Need.id, Need.title, Need.description, Need.type, Need.status, Need.tags, Need.owners, Need.codeRefs, Need.symbols, Need.created, Need.updated].join(", ")}.`,
      "Linked files can be edited on disk. Site edits call docs_lock then docs_write. A sha256 mismatch keeps the local file. Proposals remain for reviewed changes.",
      "Anchor a comment with heading, quote, and occurrence. Do not use a line number as the only key.",
    ].join("\n");
  }

  static types(): string {
    return JSON.stringify({
      types: DocType.all.map((type) => ({ type, meaning: Std.meaning(type) })),
    });
  }

  static meaning(type: string): string {
    const map: Record<string, string> = {
      [DocType.architecture]: "架构设计",
      [DocType.design]: "详细设计",
      [DocType.adr]: "架构决策记录",
      [DocType.api]: "API 文档",
      [DocType.guide]: "使用指南",
      [DocType.reference]: "技术参考",
      [DocType.analysis]: "分析报告",
    };
    return map[type] ?? type;
  }
}
