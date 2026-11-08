import path from "node:path";
import { defineConfig } from "@rspress/core";
import { pluginCollab } from "./plugin/collab";

const root = path.join(__dirname, "..", "..", "docs");

export default defineConfig({
  root,
  title: "Dooc",
  description: "面向外部 Agent CLI 的 Markdown 协作文档",
  outDir: path.join(__dirname, "doc_build"),
  llms: true,
  search: {},
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
      { text: "架构", link: "/architecture/quartz-lantern" },
      { text: "接入", link: "/guides/agent-setup" },
    ],
    sidebar: {
      "/": [
        {
          text: "文档",
          items: [
            { text: "北档石英灯架构", link: "/architecture/quartz-lantern" },
            { text: "批注存储", link: "/design/annotation-store" },
            { text: "Git 作为正文来源", link: "/decisions/0001-git-as-source" },
            { text: "协作接口", link: "/api/collaboration" },
            { text: "接入外部 Agent", link: "/guides/agent-setup" },
            { text: "Frontmatter 字段", link: "/reference/frontmatter" },
            { text: "范围说明", link: "/analysis/scope" },
          ],
        },
      ],
    },
  },
});
