import { useEffect } from "react";
import { Web } from "./keys";

type SceneElement = {
  type?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  text?: string;
  strokeColor?: string;
  backgroundColor?: string;
  fontSize?: number;
  points?: [number, number][];
};

function drawExcalidraw(source: string): { ok: true; svg: string } | { ok: false; error: string } {
  let data: { elements?: SceneElement[] };
  try {
    data = JSON.parse(source) as { elements?: SceneElement[] };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Excalidraw JSON 无法解析" };
  }
  const elements = Array.isArray(data.elements) ? data.elements : null;
  if (!elements) return { ok: false, error: "Excalidraw 场景缺少 elements 数组" };
  let maxX = 320;
  let maxY = 180;
  const parts: string[] = [];
  for (const el of elements) {
    const x = el.x ?? 0;
    const y = el.y ?? 0;
    const w = el.width ?? 0;
    const h = el.height ?? 0;
    maxX = Math.max(maxX, x + w + 24);
    maxY = Math.max(maxY, y + h + 24);
    const stroke = el.strokeColor || "#1e1e1e";
    const fill = el.backgroundColor && el.backgroundColor !== "transparent" ? el.backgroundColor : "none";
    if (el.type === "rectangle" || el.type === "diamond") {
      parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" />`);
    } else if (el.type === "ellipse") {
      parts.push(`<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" fill="${fill}" stroke="${stroke}" />`);
    } else if (el.type === "text") {
      const size = el.fontSize ?? 16;
      parts.push(`<text x="${x}" y="${y + size}" font-size="${size}" fill="${stroke}">${escapeXml(el.text ?? "")}</text>`);
      maxY = Math.max(maxY, y + size + 16);
    } else if ((el.type === "arrow" || el.type === "line") && el.points && el.points.length > 1) {
      const d = el.points.map((pt, i) => `${i === 0 ? "M" : "L"} ${x + pt[0]} ${y + pt[1]}`).join(" ");
      parts.push(`<path d="${d}" fill="none" stroke="${stroke}" />`);
    } else if (el.type) {
      return { ok: false, error: `暂不支持的 Excalidraw 元素：${el.type}` };
    }
  }
  return {
    ok: true,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${maxX} ${maxY}" width="100%">${parts.join("")}</svg>`,
  };
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fenceLang(code: HTMLElement): string | null {
  const fromClass = code.className.match(/(?:^|\s)language-([\w-]+)/)?.[1];
  if (fromClass) return fromClass;
  const fromPre = code.parentElement?.getAttribute("data-lang");
  if (fromPre) return fromPre;
  const block = code.closest("[class*='language-']");
  return block?.className.match(/(?:^|\s)language-([\w-]+)/)?.[1] ?? null;
}

function fenceRoot(pre: HTMLElement): HTMLElement {
  return (pre.closest(".rp-codeblock") as HTMLElement) || pre;
}

function showError(pre: HTMLElement, message: string): void {
  const box = document.createElement("div");
  box.className = "dooc-render-error";
  box.setAttribute("data-dooc-rich", "1");
  box.textContent = message;
  fenceRoot(pre).replaceWith(box);
}

async function upgrade(root: ParentNode): Promise<void> {
  const blocks = Array.from(root.querySelectorAll("pre code")) as HTMLElement[];
  for (const code of blocks) {
    const pre = code.parentElement;
    if (!pre || pre.getAttribute("data-dooc-rich") === "1" || code.getAttribute("data-dooc-rich") === "1") continue;
    const lang = fenceLang(code);
    if (!lang || !["mermaid", "plantuml", "puml", "excalidraw", "html-embed"].includes(lang)) continue;
    const fence = fenceRoot(pre);
    pre.setAttribute("data-dooc-rich", "1");
    fence.setAttribute("data-dooc-rich", "1");
    const source = code.textContent ?? "";
    if (lang === "mermaid") {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
        await mermaid.parse(source);
        const id = `dooc-mmd-${Math.random().toString(36).slice(2)}`;
        const drawn = await mermaid.render(id, source);
        const host = document.createElement("div");
        host.setAttribute("data-dooc-rich", "1");
        host.innerHTML = drawn.svg;
        fenceRoot(pre).replaceWith(host);
      } catch (err) {
        showError(pre, err instanceof Error ? err.message : String(err));
      }
      continue;
    }
    if (lang === "plantuml" || lang === "puml") {
      try {
        const res = await fetch(`${Web.api}/api/render/plantuml`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ source }),
        });
        const data = await res.json();
        if (!data.ok) {
          showError(pre, data.error || "PlantUML 编译失败");
          continue;
        }
        const host = document.createElement("div");
        host.setAttribute("data-dooc-rich", "1");
        host.innerHTML = data.svg;
        fenceRoot(pre).replaceWith(host);
      } catch (err) {
        showError(pre, err instanceof Error ? err.message : String(err));
      }
      continue;
    }
    if (lang === "excalidraw") {
      const drawn = drawExcalidraw(source);
      if (!drawn.ok) {
        showError(pre, drawn.error);
        continue;
      }
      const host = document.createElement("div");
      host.setAttribute("data-dooc-rich", "1");
      host.innerHTML = drawn.svg;
      fenceRoot(pre).replaceWith(host);
      continue;
    }
    const parsed = new DOMParser().parseFromString(source, "text/html");
    const broken = parsed.querySelector("parsererror");
    if (broken) {
      showError(pre, broken.textContent || "HTML 无法解析");
      continue;
    }
    const frame = document.createElement("iframe");
    frame.className = "dooc-html-frame";
    frame.setAttribute("sandbox", "allow-scripts");
    frame.setAttribute("data-dooc-rich", "1");
    frame.srcdoc = source;
    fenceRoot(pre).replaceWith(frame);
  }
}

export default function RichBlocks() {
  useEffect(() => {
    let timer = 0;
    const run = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        upgrade(document).catch(() => undefined);
      }, 60);
    };
    run();
    const observer = new MutationObserver(run);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("dooc-rich-render", run);
    return () => {
      observer.disconnect();
      window.removeEventListener("dooc-rich-render", run);
      window.clearTimeout(timer);
    };
  }, []);
  return null;
}
