import { useState, useRef, useEffect } from "react";
import { Web } from "./keys";

export function TaskPopover() {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  const popoverRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      titleInputRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };

    if (open) {
      window.addEventListener("keydown", handleKeyDown);
      const timer = setTimeout(() => {
        window.addEventListener("mousedown", handleClickOutside);
      }, 50);
      return () => {
        window.removeEventListener("keydown", handleKeyDown);
        window.removeEventListener("mousedown", handleClickOutside);
        clearTimeout(timer);
      };
    }
  }, [open]);

  const handleCreate = async () => {
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    setStatus(null);

    try {
      const res = await fetch(`${Web.api}/api/tasks`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-actor-type": "user",
          "x-actor-id": "reader",
        },
        body: JSON.stringify({
          title: title.trim(),
          description: desc.trim(),
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        setStatus({
          type: "error",
          msg: `创建失败 (${res.status}): ${text.slice(0, 100)}`,
        });
        setSubmitting(false);
        return;
      }

      let data: any;
      try {
        data = await res.json();
      } catch {
        setStatus({
          type: "error",
          msg: "响应解析失败，保持草稿",
        });
        setSubmitting(false);
        return;
      }

      const taskId = data?.task_id ? ` (#${data.task_id})` : "";
      setStatus({
        type: "success",
        msg: `任务已创建${taskId}`,
      });
      setTitle("");
      setDesc("");
      setTimeout(() => {
        setOpen(false);
        setStatus(null);
      }, 1500);
    } catch (err) {
      setStatus({
        type: "error",
        msg: err instanceof Error ? err.message : "网络错误，创建失败",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="dooc-task-container" ref={popoverRef}>
      {!open && (
        <button
          type="button"
          className="dooc-task-trigger"
          aria-label="创建任务"
          aria-expanded={false}
          onClick={() => setOpen(true)}
        >
          <svg
            viewBox="0 0 24 24"
            width="15"
            height="15"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span>{Web.task}</span>
        </button>
      )}

      {open && (
        <div
          className="dooc-task-popover"
          role="dialog"
          aria-label="创建任务面板"
        >
          <div className="dooc-task-header">
            <h3 className="dooc-task-title">{Web.task}</h3>
            <button
              type="button"
              className="dooc-icon-btn"
              aria-label="关闭任务面板"
              title="关闭 (Esc)"
              onClick={() => setOpen(false)}
            >
              <svg
                viewBox="0 0 24 24"
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <div className="dooc-task-body">
            <label className="dooc-task-field">
              <span className="dooc-field-label">标题</span>
              <input
                ref={titleInputRef}
                className="dooc-field-input"
                type="text"
                placeholder="任务标题..."
                aria-label="任务标题"
                value={title}
                disabled={submitting}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    handleCreate();
                  }
                }}
              />
            </label>

            <label className="dooc-task-field">
              <span className="dooc-field-label">说明</span>
              <textarea
                className="dooc-field-textarea"
                placeholder="任务说明 (可选)..."
                aria-label="任务说明"
                rows={3}
                value={desc}
                disabled={submitting}
                onChange={(e) => setDesc(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    handleCreate();
                  }
                }}
              />
            </label>

            {status && (
              <div
                className={`dooc-task-status dooc-task-status--${status.type}`}
                role="status"
              >
                {status.msg}
              </div>
            )}
          </div>

          <div className="dooc-task-footer">
            <button
              type="button"
              className="dooc-btn dooc-btn--secondary"
              aria-label="取消创建"
              onClick={() => setOpen(false)}
            >
              取消
            </button>
            <button
              type="button"
              className="dooc-btn dooc-btn--primary"
              aria-label="确认创建任务"
              disabled={submitting || !title.trim()}
              onClick={handleCreate}
            >
              {submitting ? "创建中..." : "创建"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
