import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Web } from "./keys";
import { paintMarkdown } from "./paint";

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
    if (!host || editing) return;
    const timer = window.setInterval(() => {
      loadLinks().catch(() => undefined);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [host, editing, loadLinks]);

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
    const start = Date.now();
    let slot: HTMLElement | null = null;
    while (Date.now() - start < 4000) {
      slot = document.getElementById("dooc-library-view");
      if (slot) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!slot) return false;
    await paintMarkdown(slot, text);
    return true;
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
    return paint(data.markdown ?? "");
  };

  useEffect(() => {
    let opened = "";
    let pending = "";
    const show = (id: string) => {
      if (!id || id === opened || id === pending) return;
      pending = id;
      openDoc(id).then((ok) => {
        if (ok !== false) opened = id;
        if (pending === id) pending = "";
      });
    };
    const fromUrl = () => {
      const slot = document.getElementById("dooc-library");
      if (!slot) {
        opened = "";
        pending = "";
        return;
      }
      show(new URLSearchParams(window.location.search).get("doc") ?? "");
    };
    const onOpen = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (id) show(id);
    };
    fromUrl();
    const timer = window.setInterval(fromUrl, 400);
    window.addEventListener("dooc-open-doc", onOpen);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("dooc-open-doc", onOpen);
    };
  }, []);

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
    window.dispatchEvent(new Event("dooc-nav-refresh"));
  };

  const unlink = async (path: string) => {
    const res = await fetch(`${Web.api}/api/links`, {
      method: "DELETE",
      headers,
      body: JSON.stringify({ path }),
    });
    const data = await res.json();
    if (res.ok) {
      setDirs(data.directories ?? []);
      window.dispatchEvent(new Event("dooc-nav-refresh"));
    }
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
      window.dispatchEvent(new Event("dooc-nav-refresh"));
      return;
    }
    setEditing(false);
    setToken("");
    setBase(data.sha256 ?? base);
    setMessage("已写回文件");
    await paint(data.markdown ?? markdown);
    await loadLinks();
    window.dispatchEvent(new Event("dooc-nav-refresh"));
  };

  if (!host) return null;

  return createPortal(
    <div className="dooc-library">
      <aside>
        <h2>选择目录</h2>
        <p>{browsePath}</p>
        <div className="dooc-library-actions">
          {parent && <button type="button" onClick={() => loadBrowse(parent)}>上级</button>}
          <button type="button" onClick={() => linkDir(manual.trim() || browsePath)}>链接这个目录</button>
        </div>
        <ul>
          {children.map((dir) => (
            <li key={dir.path}>
              <button type="button" onClick={() => loadBrowse(dir.path)}>{dir.name}</button>
              <span> {dir.markdown} 篇</span>
              <button type="button" onClick={() => linkDir(dir.path)}>链接</button>
            </li>
          ))}
        </ul>
        <label>
          其他路径
          <input
            value={manual}
            placeholder="留空则链接当前目录"
            onChange={(e) => setManual(e.target.value)}
          />
        </label>
        <h2>已链接</h2>
        {dirs.map((dir) => (
          <section key={dir.path}>
            <div>{dir.path} <button type="button" onClick={() => unlink(dir.path)}>解除</button></div>
            <ul>
              {dir.documents.map((doc) => (
                <li key={doc.doc_id}>
                  <button
                    type="button"
                    onClick={() => {
                      const href = `/library?doc=${encodeURIComponent(doc.doc_id)}`;
                      window.history.pushState({}, "", href);
                      window.dispatchEvent(new CustomEvent("dooc-open-doc", { detail: doc.doc_id }));
                    }}
                  >
                    {doc.title}
                  </button>
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
