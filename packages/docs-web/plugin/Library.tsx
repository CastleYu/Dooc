import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Web } from "./keys";

type DocItem = { doc_id: string; title: string; path: string };
type LinkDir = { path: string; documents: DocItem[] };
type BrowseDir = { name: string; path: string; markdown: number };

export default function Library() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [dirs, setDirs] = useState<LinkDir[]>([]);
  const [browsePath, setBrowsePath] = useState("");
  const [parent, setParent] = useState<string | null>(null);
  const [children, setChildren] = useState<BrowseDir[]>([]);
  const [manual, setManual] = useState("");
  const [current, setCurrent] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [base, setBase] = useState("");
  const [token, setToken] = useState("");
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState("");

  const headers = {
    "content-type": "application/json",
    "x-actor-type": "user",
    "x-actor-id": "reader",
  };

  const loadLinks = useCallback(async () => {
    const res = await fetch(`${Web.api}/api/links`, { headers });
    const data = await res.json();
    setDirs(Array.isArray(data.directories) ? data.directories : []);
  }, []);

  const loadBrowse = useCallback(async (path?: string) => {
    const query = path ? `?path=${encodeURIComponent(path)}` : "";
    const res = await fetch(`${Web.api}/api/browse${query}`, { headers });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data?.error?.message || "无法列出目录");
      return;
    }
    setBrowsePath(data.path || "");
    setParent(data.parent ?? null);
    setChildren(Array.isArray(data.directories) ? data.directories : []);
  }, []);

  useEffect(() => {
    const found = document.getElementById("dooc-library");
    setHost(found);
    if (!found) return;
    loadLinks().catch(() => setMessage("无法读取链接目录"));
    loadBrowse().catch(() => setMessage("无法浏览目录"));
  }, [loadLinks, loadBrowse]);

  useEffect(() => {
    if (!current || editing) return;
    const timer = window.setInterval(async () => {
      const res = await fetch(`${Web.api}/api/docs/${encodeURIComponent(current)}`, { headers });
      if (!res.ok) return;
      const data = await res.json();
      if (data.sha256 && data.sha256 !== base && !editing) {
        setMarkdown(data.markdown ?? "");
        setBase(data.sha256);
        paint(data.markdown ?? "");
      }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [current, base, editing]);

  const paint = async (text: string) => {
    const slot = document.getElementById("dooc-library-view");
    if (!slot) return;
    const { marked } = await import("marked");
    const body = text.replace(/^\uFEFF/, "").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
    slot.innerHTML = marked.parse(body, { async: false }) as string;
    window.dispatchEvent(new CustomEvent("dooc-rich-render"));
  };

  const openDoc = async (id: string) => {
    setMessage("");
    setEditing(false);
    setToken("");
    const res = await fetch(`${Web.api}/api/docs/${encodeURIComponent(id)}`, { headers });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data?.error?.message || "无法读取文档");
      return;
    }
    setCurrent(id);
    setMarkdown(data.markdown ?? "");
    setBase(data.sha256 ?? "");
    await paint(data.markdown ?? "");
  };

  const linkDir = async (path: string) => {
    setMessage("");
    const res = await fetch(`${Web.api}/api/links`, {
      method: "POST",
      headers,
      body: JSON.stringify({ path }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data?.error?.message || "链接失败");
      return;
    }
    setDirs(data.directories ?? []);
    setMessage(`已链接 ${path}`);
  };

  const unlink = async (path: string) => {
    const res = await fetch(`${Web.api}/api/links`, {
      method: "DELETE",
      headers,
      body: JSON.stringify({ path }),
    });
    const data = await res.json();
    if (res.ok) setDirs(data.directories ?? []);
  };

  const beginEdit = async () => {
    if (!current) return;
    const res = await fetch(`${Web.api}/api/docs/${encodeURIComponent(current)}/lock`, {
      method: "POST",
      headers,
      body: "{}",
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data?.error?.message || "文件已锁定");
      return;
    }
    setToken(data.lock_token);
    setBase(data.base_sha256);
    setEditing(true);
  };

  const save = async () => {
    const res = await fetch(`${Web.api}/api/docs/${encodeURIComponent(current)}/content`, {
      method: "POST",
      headers,
      body: JSON.stringify({ markdown, base_sha256: base, lock_token: token }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data?.error?.message || "保存失败");
      return;
    }
    if (data.ok === false) {
      setMarkdown(data.markdown ?? markdown);
      setBase(data.sha256 ?? base);
      setMessage("磁盘内容已变化，已保留本地文件。");
      await paint(data.markdown ?? "");
      return;
    }
    setEditing(false);
    setToken("");
    setBase(data.sha256 ?? base);
    setMessage("已写回文件");
    await paint(data.markdown ?? markdown);
    await loadLinks();
  };

  if (!host) return null;

  return createPortal(
    <div className="dooc-library">
      <aside>
        <h2>选择目录</h2>
        <p>{browsePath}</p>
        <div className="dooc-library-actions">
          {parent && <button type="button" onClick={() => loadBrowse(parent)}>上级</button>}
          <button type="button" onClick={() => linkDir(browsePath)}>链接此目录</button>
        </div>
        <ul>
          {children.map((dir) => (
            <li key={dir.path}>
              <button type="button" onClick={() => loadBrowse(dir.path)}>{dir.name}</button>
              <span> {dir.markdown} 篇</span>
            </li>
          ))}
        </ul>
        <label>
          绝对路径
          <input value={manual} onChange={(e) => setManual(e.target.value)} />
        </label>
        <button type="button" onClick={() => manual.trim() && linkDir(manual.trim())}>链接路径</button>
        <h2>已链接</h2>
        {dirs.map((dir) => (
          <section key={dir.path}>
            <div>{dir.path} <button type="button" onClick={() => unlink(dir.path)}>解除</button></div>
            <ul>
              {dir.documents.map((doc) => (
                <li key={doc.doc_id}>
                  <button type="button" onClick={() => openDoc(doc.doc_id)}>{doc.title}</button>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {message && <div className="dooc-library-error">{message}</div>}
      </aside>
      <section>
        {current && (
          <div className="dooc-library-actions">
            {!editing && <button type="button" onClick={beginEdit}>编辑</button>}
            {editing && <button type="button" onClick={save}>保存</button>}
            {editing && (
              <button
                type="button"
                onClick={async () => {
                  if (token) {
                    await fetch(`${Web.api}/api/docs/${encodeURIComponent(current)}/lock`, {
                      method: "DELETE",
                      headers,
                      body: JSON.stringify({ lock_token: token }),
                    }).catch(() => undefined);
                  }
                  setEditing(false);
                  setToken("");
                }}
              >
                取消
              </button>
            )}
          </div>
        )}
        {editing ? (
          <textarea value={markdown} onChange={(e) => setMarkdown(e.target.value)} />
        ) : (
          <div id="dooc-library-view" />
        )}
      </section>
    </div>,
    host,
  );
}
