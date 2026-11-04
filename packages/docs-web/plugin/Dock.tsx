import { usePageData } from "@rspress/core/runtime";
import { useState } from "react";
import { Web } from "./keys";

export default function Dock() {
  const page = usePageData() as { page?: { frontmatter?: { id?: string } } };
  const docId = page?.page?.frontmatter?.id ?? "";
  const [heading, setHeading] = useState("");
  const [quote, setQuote] = useState("");
  const [content, setContent] = useState("");
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [msg, setMsg] = useState("");

  async function post(path: string, body: unknown) {
    try {
      const res = await fetch(`${Web.api}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-actor-type": "user",
          "x-actor-id": "reader",
        },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      setMsg(text.slice(0, 180));
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <section className="dooc-dock" aria-label="协作" data-dooc-marker={Web.marker}>
      <div className="dooc-dock-bar">
        <h2>批注</h2>
        <button
          type="button"
          onClick={() =>
            post("/api/comments", {
              doc_id: docId,
              anchor: { heading, quote, occurrence: 1 },
              content,
              author: { type: "user", id: "reader" },
            })
          }
        >
          {Web.note}
        </button>
        <h2>任务</h2>
        <button type="button" onClick={() => post("/api/tasks", { title, description: desc })}>
          {Web.task}
        </button>
      </div>
      <p>批注提交到协作服务，不写入 Markdown。</p>
      <label>
        标题锚点
        <input value={heading} onChange={(ev) => setHeading(ev.target.value)} />
      </label>
      <label>
        引用
        <textarea value={quote} onChange={(ev) => setQuote(ev.target.value)} />
      </label>
      <label>
        批注内容
        <textarea value={content} onChange={(ev) => setContent(ev.target.value)} />
      </label>
      <h2 className="dooc-dock-sub">任务字段</h2>
      <label>
        任务标题
        <input value={title} onChange={(ev) => setTitle(ev.target.value)} />
      </label>
      <label>
        任务说明
        <textarea value={desc} onChange={(ev) => setDesc(ev.target.value)} />
      </label>
      <p role="status">{msg}</p>
      <p className="dooc-marker">{Web.marker}</p>
    </section>
  );
}
