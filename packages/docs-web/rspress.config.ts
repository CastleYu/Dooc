import path from "node:path";
import { defineConfig } from "@rspress/core";
import { pluginCollab } from "./plugin/collab";

const root = path.join(__dirname, "..", "..", "docs");

const plain = (name: string, aliases: string[] = []) => ({
  name,
  aliases,
  scopeName: `source.${name.replace(/-/g, ".")}`,
  patterns: [{ match: "[\\s\\S]+", name: "text" }],
});

export default defineConfig({
  root,
  title: "Dooc",
  description: "面向外部 Agent CLI 的 Markdown 协作文档",
  outDir: path.join(__dirname, "doc_build"),
  llms: true,
  search: {},
  markdown: {
    shiki: {
      langs: [
        "tsx",
        "ts",
        "js",
        "jsx",
        "json",
        "bash",
        "md",
        "html",
        "css",
        "txt",
        "text",
        "mermaid",
        plain("plantuml", ["puml"]),
        plain("excalidraw"),
        plain("html-embed"),
      ],
    },
  },
  plugins: [pluginCollab()],
  builderConfig: {
    server: {
      proxy: {
        "/api": "http://127.0.0.1:8787",
      },
    },
  },
  themeConfig: {
    nav: [
      { text: "UI 组件", link: "/guide/rspress-ui" },
      { text: "接入", link: "/guide/integration" },
      { text: "链接文档", link: "/library" },
    ],
    sidebar: {
      "/": [
        {
          text: "文档",
          items: [
            { text: "Rspress UI 组件", link: "/guide/rspress-ui" },
            { text: "接入指南", link: "/guide/integration" },
            { text: "链接文档", link: "/library" },
          ],
        },
      ],
    },
  },
});
