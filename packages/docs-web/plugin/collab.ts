import fs from "node:fs";
import path from "node:path";
import type { RspressPlugin } from "@rspress/core";
import { Web } from "./keys";

export function pluginCollab(): RspressPlugin {
  const dir = __dirname;
  return {
    name: "dooc-collab",
    globalStyles: path.join(dir, "dock.css"),
    globalUIComponents: [
      path.join(dir, "Dock.tsx"),
      path.join(dir, "RichBlocks.tsx"),
      path.join(dir, "Library.tsx"),
      path.join(dir, "DocNav.tsx"),
    ],
    async afterBuild() {
      const out = path.join(dir, "..", "doc_build");
      fs.mkdirSync(out, { recursive: true });
      fs.writeFileSync(path.join(out, "dooc-plugin-marker.txt"), `${Web.marker}\n`, "utf8");
    },
  };
}
