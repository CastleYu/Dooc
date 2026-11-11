import { useState } from "react";
import { Web } from "./keys";

export function EditorBar({
  docId,
  active,
  onActive,
}: {
  docId: string;
  active: boolean;
  onActive: (open: boolean) => void;
}) {
  const [markdown, setMarkdown] = useState("");
  const [token, setToken] = useState("");
  const [base, setBase] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const headers = {
    "content-type": "application/json",
    "x-actor-type": "user",
    "x-actor-id": "reader",
  };

  const open = async () => {
    setBusy(true);
    setMessage("");
    try {
      const locked = await fetch(`${Web.api}/api/docs/${encodeURIComponent(docId)}/lock`, {
        method: "POST",
        headers,
        body: "{}",
      });
      const data = await locked.json();
      if (!locked.ok) {
        setMessage(data?.error?.message || "无法锁定文件");
        return;
      }
      const doc = await fetch(`${Web.api}/api/docs/${encodeURIComponent(docId)}`, { headers });
      const body = await doc.json();
      setToken(data.lock_token);
      setBase(data.base_sha256);
      setMarkdown(body.markdown ?? "");
      onActive(true);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "无法打开编辑");
    } finally {
      setBusy(false);
    }
  };

  const close = async () => {
    if (token) {
      await fetch(`${Web.api}/api/docs/${encodeURIComponent(docId)}/lock`, {
        method: "DELETE",
        headers,
        body: JSON.stringify({ lock_token: token }),
      }).catch(() => undefined);
    }
    setToken("");
    onActive(false);
  };

  const save = async () => {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`${Web.api}/api/docs/${encodeURIComponent(docId)}/content`, {
        method: "POST",
        headers,
        body: JSON.stringify({ markdown, base_sha256: base, lock_token: token }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data?.error?.message || "保存失败");
        return;
      }
      if (data.ok === false && data.kept === "local") {
        setMarkdown(data.markdown ?? markdown);
        setBase(data.sha256 ?? base);
        setMessage("磁盘内容已变化，已保留本地文件。");
        window.dispatchEvent(new Event("dooc-nav-refresh"));
        return;
      }
      setMessage("已写回文件");
      setToken("");
      onActive(false);
      window.dispatchEvent(new CustomEvent("dooc-doc-saved"));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  if (!active) {
    return (
      <button type="button" className="dooc-library-trigger" style={{ position: "fixed", right: 24, bottom: 24, zIndex: 70 }} onClick={open} disabled={busy}>
        编辑正文
      </button>
    );
  }

  return (
    <div className="dooc-editor" data-dooc-interactive="true">
      <strong>编辑正文</strong>
      <p>保存时锁定文件。若磁盘已改动，保留磁盘内容。</p>
      <textarea value={markdown} onChange={(e) => setMarkdown(e.target.value)} />
      {message && <div className="dooc-library-error">{message}</div>}
      <div className="dooc-editor-actions">
        <button type="button" onClick={save} disabled={busy}>保存</button>
        <button type="button" onClick={close} disabled={busy}>取消</button>
      </div>
    </div>
  );
}
