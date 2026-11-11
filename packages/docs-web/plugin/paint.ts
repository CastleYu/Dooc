export function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^\uFEFF/, "").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
}

function headingId(text: string, used: Map<string, number>): string {
  const base = text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w\u4e00-\u9fff-]+/g, "")
    .replace(/^-+|-+$/g, "") || "section";
  const n = used.get(base) ?? 0;
  used.set(base, n + 1);
  return n === 0 ? base : `${base}-${n}`;
}

export function tagHeadings(root: ParentNode): void {
  const used = new Map<string, number>();
  root.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((node) => {
    const el = node as HTMLElement;
    if (!el.id) el.id = headingId(el.textContent || "", used);
    if (el.tagName === "H2" || el.tagName === "H3" || el.tagName === "H4") el.classList.add("rp-toc-include");
  });
}

export async function paintMarkdown(host: HTMLElement, markdown: string): Promise<boolean> {
  const token = `${Date.now()}-${Math.random()}`;
  host.dataset.doocPaint = token;
  const { marked } = await import("marked");
  if (host.dataset.doocPaint !== token) return false;
  host.innerHTML = marked.parse(stripFrontmatter(markdown), { async: false }) as string;
  if (host.dataset.doocPaint !== token) return false;
  tagHeadings(host);
  window.dispatchEvent(new CustomEvent("dooc-rich-render"));
  return true;
}
