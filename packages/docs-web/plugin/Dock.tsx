import { usePageData } from "@rspress/core/runtime";
import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { Web } from "./keys";
import type {
  AnchorsResponse,
  CommentItem,
  MarkerAggregate,
  PendingSelection,
  AlignedBlockInfo,
  NavigationIntent,
  NavigationSource,
} from "./types";
import {
  alignDomBlocks,
  findDuplicateHeadings,
  extractSelectionFromDOM,
  reverseMapAnchor,
  toDocRect,
} from "./anchorMapping";
import { FloatingCommentBox } from "./FloatingCommentBox";
import { CommentMarkerLayer } from "./CommentMarkerLayer";
import { CommentSidebar } from "./CommentSidebar";
import { TaskPopover } from "./TaskPopover";

export default function Dock() {
  const page = usePageData() as { page?: { frontmatter?: { id?: string } } };
  const docId = page?.page?.frontmatter?.id ?? "";

  const [anchors, setAnchors] = useState<AnchorsResponse | null>(null);
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [markers, setMarkers] = useState<MarkerAggregate[]>([]);
  const [activeMarkerKey, setActiveMarkerKey] = useState<string | null>(null);
  const [navIntent, setNavIntent] = useState<NavigationIntent | null>(null);
  const [pendingSelection, setPendingSelection] = useState<PendingSelection | null>(null);

  const [commentsLoading, setCommentsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitSubmitting, setSubmitSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [selectionTip, setSelectionTip] = useState<{
    text: string;
    rect: DOMRect;
  } | null>(null);

  const [mounted, setMounted] = useState(false);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [desktopTrack, setDesktopTrack] = useState<{ left: number; width: number }>({
    left: 0,
    width: 320,
  });

  const alignedBlocksRef = useRef<Map<HTMLElement, AlignedBlockInfo>>(new Map());
  const duplicateHeadingsRef = useRef<Set<string>>(new Set());
  const abortControllerRef = useRef<AbortController | null>(null);

  const pendingRangeRef = useRef<Range | null>(null);

  const pendingSelectionRef = useRef<PendingSelection | null>(null);
  pendingSelectionRef.current = pendingSelection;

  const draftRef = useRef("");
  draftRef.current = draft;

  const submitSubmittingRef = useRef(false);
  submitSubmittingRef.current = submitSubmitting;

  const submitErrorRef = useRef<string | null>(null);
  submitErrorRef.current = submitError;

  // Measure desktop track in real document space
  const measureDesktopTrack = useCallback(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return { left: 0, width: 320 };
    }
    const scrollX = window.scrollX || window.pageXOffset;
    const vw = window.innerWidth;

    const docEl =
      (document.querySelector(".rspress-doc") as HTMLElement) ||
      (document.querySelector("article") as HTMLElement) ||
      (document.querySelector(".rp-doc-layout__doc-container") as HTMLElement);

    const outlineEl =
      (document.querySelector(".rp-doc-layout__outline") as HTMLElement) ||
      (document.querySelector(".rp-doc-layout__outline-placeholder") as HTMLElement);

    if (vw >= 1440) {
      if (outlineEl && outlineEl.getBoundingClientRect().width > 0) {
        const oRect = outlineEl.getBoundingClientRect();
        return {
          left: Math.round(oRect.left + scrollX),
          width: 260,
        };
      }
      if (docEl) {
        const dRect = docEl.getBoundingClientRect();
        return {
          left: Math.round(dRect.right + 24 + scrollX),
          width: 260,
        };
      }
    } else {
      if (outlineEl && outlineEl.getBoundingClientRect().width > 0) {
        const oRect = outlineEl.getBoundingClientRect();
        return {
          left: Math.round(oRect.left + scrollX),
          width: Math.max(260, Math.min(320, Math.round(oRect.width))),
        };
      }
      if (docEl) {
        const dRect = docEl.getBoundingClientRect();
        const avail = vw - (dRect.right + 20);
        return {
          left: Math.round(dRect.right + 20 + scrollX),
          width: Math.max(250, Math.min(310, Math.round(avail - 20))),
        };
      }
    }

    return { left: Math.round(vw - 330 + scrollX), width: 300 };
  }, []);

  // Rebuild markers whenever anchors, comments, or DOM layout change
  const refreshMarkers = useCallback(
    (
      currentAnchors: AnchorsResponse | null,
      currentComments: CommentItem[]
    ) => {
      if (!currentAnchors || !docId) {
        setMarkers([]);
        return;
      }

      const container =
        (document.querySelector(".rspress-doc") as HTMLElement) ||
        (document.querySelector("article") as HTMLElement) ||
        (document.querySelector(".rp-doc") as HTMLElement) ||
        (document.querySelector("main") as HTMLElement) ||
        document.body;

      const aligned = alignDomBlocks(container, currentAnchors.blocks);
      alignedBlocksRef.current = aligned;

      const dupes = findDuplicateHeadings(currentAnchors.blocks);
      duplicateHeadingsRef.current = dupes;

      const markerMap = new Map<string, MarkerAggregate>();

      for (const comment of currentComments) {
        if (!comment.anchor || !comment.anchor.quote) continue;
        const key = `${comment.anchor.heading}::${comment.anchor.quote}::${comment.anchor.occurrence}`;

        if (markerMap.has(key)) {
          markerMap.get(key)!.comments.push(comment);
        } else {
          const mapped = reverseMapAnchor(
            comment.anchor,
            currentAnchors,
            aligned,
            dupes
          );
          if (mapped) {
            let visibleText = "";
            try {
              visibleText = mapped.range.toString().trim();
            } catch {
              visibleText = "";
            }
            markerMap.set(key, {
              key,
              anchor: comment.anchor,
              comments: [comment],
              rect: mapped.boundingRect,
              highlightRects: mapped.clientRects,
              displayText: visibleText || undefined,
            });
          }
        }
      }

      setMarkers(Array.from(markerMap.values()));
    },
    [docId]
  );

  // Fetch anchors and comments when docId changes
  const fetchData = useCallback(
    async (id: string) => {
      if (!id) {
        setAnchors(null);
        setComments([]);
        setMarkers([]);
        setLoadError(null);
        return;
      }

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setCommentsLoading(true);
      setLoadError(null);

      try {
        const headers: Record<string, string> = {
          "content-type": "application/json",
          "x-actor-type": "user",
          "x-actor-id": "reader",
        };

        const [anchorsRes, commentsRes] = await Promise.all([
          fetch(`${Web.api}/api/docs/${encodeURIComponent(id)}/anchors`, {
            headers,
            signal: controller.signal,
          }),
          fetch(`${Web.api}/api/comments?doc_id=${encodeURIComponent(id)}`, {
            headers,
            signal: controller.signal,
          }),
        ]);

        let loadedAnchors: AnchorsResponse | null = null;
        if (anchorsRes.ok) {
          loadedAnchors = await anchorsRes.json();
          setAnchors(loadedAnchors);
        } else {
          const errText = await anchorsRes.text().catch(() => "");
          throw new Error(
            `获取文档锚点失败 (${anchorsRes.status}): ${errText.slice(0, 80)}`
          );
        }

        let loadedComments: CommentItem[] = [];
        if (commentsRes.ok) {
          const commentsData = await commentsRes.json();
          loadedComments = Array.isArray(commentsData.comments)
            ? commentsData.comments
            : [];
          setComments(loadedComments);
        } else {
          const errText = await commentsRes.text().catch(() => "");
          throw new Error(
            `获取批注列表失败 (${commentsRes.status}): ${errText.slice(0, 80)}`
          );
        }

        refreshMarkers(loadedAnchors, loadedComments);
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
          return;
        }
        setLoadError(err instanceof Error ? err.message : String(err));
      } finally {
        setCommentsLoading(false);
      }
    },
    [refreshMarkers]
  );

  // Reset and fetch data on doc switch - 切文档不能显示上页评论
  useEffect(() => {
    setAnchors(null);
    setComments([]);
    setMarkers([]);
    setActiveMarkerKey(null);
    setNavIntent(null);
    setLoadError(null);
    setPendingSelection(null);
    pendingSelectionRef.current = null;
    pendingRangeRef.current = null;
    setSubmitError(null);
    submitErrorRef.current = null;
    setDraft("");
    draftRef.current = "";
    setSelectionTip(null);
    fetchData(docId);

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [docId, fetchData]);

  // Mounted SSR guard
  useEffect(() => {
    setMounted(true);
  }, []);

  // Portal target & TOC layout management: strictly scoped to docId with cleanup
  useEffect(() => {
    if (!mounted || !docId || typeof document === "undefined") {
      setPortalTarget(null);
      document.body.classList.remove("dooc-doc-active");
      const dHost = document.getElementById("dooc-sidebar-desktop-host");
      if (dHost) dHost.remove();
      const mHost = document.getElementById("dooc-sidebar-mobile-host");
      if (mHost) mHost.remove();
      return;
    }

    document.body.classList.add("dooc-doc-active");

    const updatePortalTarget = () => {
      const mobile = window.innerWidth < 1280;
      setIsMobile(mobile);

      if (mobile) {
        const dHost = document.getElementById("dooc-sidebar-desktop-host");
        if (dHost) dHost.remove();

        // Mobile layout: place after document body
        const docContainer =
          (document.querySelector(".rspress-doc") as HTMLElement)?.parentElement ||
          (document.querySelector(".rp-doc-layout__doc-container") as HTMLElement) ||
          (document.querySelector("article") as HTMLElement)?.parentElement ||
          (document.querySelector("main") as HTMLElement);

        if (docContainer) {
          let mobileHost = document.getElementById("dooc-sidebar-mobile-host");
          if (!mobileHost) {
            mobileHost = document.createElement("div");
            mobileHost.id = "dooc-sidebar-mobile-host";
            mobileHost.className = "dooc-sidebar-mobile-host";
          }
          const rspressDoc =
            document.querySelector(".rspress-doc") ||
            document.querySelector("article");
          if (rspressDoc && rspressDoc.nextSibling) {
            rspressDoc.parentNode?.insertBefore(mobileHost, rspressDoc.nextSibling);
          } else {
            docContainer.appendChild(mobileHost);
          }
          setPortalTarget(mobileHost);
        }
      } else {
        const mHost = document.getElementById("dooc-sidebar-mobile-host");
        if (mHost) mHost.remove();
        const dHost = document.getElementById("dooc-sidebar-desktop-host");
        if (dHost) dHost.remove();
        setPortalTarget(null);
        setDesktopTrack(measureDesktopTrack());
      }
    };

    updatePortalTarget();
    window.addEventListener("resize", updatePortalTarget);

    return () => {
      window.removeEventListener("resize", updatePortalTarget);
      document.body.classList.remove("dooc-doc-active");
      const dHost = document.getElementById("dooc-sidebar-desktop-host");
      if (dHost) dHost.remove();
      const mHost = document.getElementById("dooc-sidebar-mobile-host");
      if (mHost) mHost.remove();
    };
  }, [docId, mounted]);

  // Recalculate markers and desktop track on window resize and font load
  useEffect(() => {
    const handleResize = () => {
      setDesktopTrack(measureDesktopTrack());
      if (anchors && comments) {
        refreshMarkers(anchors, comments);
      }
      if (pendingRangeRef.current) {
        try {
          const r = pendingRangeRef.current;
          const sX = window.scrollX || window.pageXOffset;
          const sY = window.scrollY || window.pageYOffset;
          const bRect = toDocRect(r.getBoundingClientRect(), sX, sY);
          setPendingSelection((prev) => {
            if (!prev) return null;
            return {
              ...prev,
              rect: bRect,
            };
          });
        } catch {
          // range may be detached
        }
      }
    };

    window.addEventListener("resize", handleResize);

    if (typeof document !== "undefined" && document.fonts?.ready) {
      document.fonts.ready.then(() => {
        handleResize();
      });
    }

    return () => window.removeEventListener("resize", handleResize);
  }, [anchors, comments, refreshMarkers, measureDesktopTrack]);

  // Selection detection
  useEffect(() => {
    if (!docId || !anchors) return;

    const isInsideInteractiveOverlay = (target: Node | null): boolean => {
      if (!target || !(target instanceof Element)) return false;
      return Boolean(
        target.closest(".dooc-floating-box-wrapper") ||
        target.closest(".dooc-task-container") ||
        target.closest(".dooc-task-popover") ||
        target.closest(".dooc-detail-popover") ||
        target.closest(".dooc-sidebar") ||
        target.closest(".dooc-marker-badge") ||
        target.closest(".dooc-error-toast") ||
        target.closest("[data-dooc-interactive]")
      );
    };

    const handleSelectionChange = () => {
      // If user is interacting inside the floating box or task popover, do nothing
      const activeEl = document.activeElement;
      if (isInsideInteractiveOverlay(activeEl)) {
        return;
      }

      // During active submission, do not alter pendingSelection or draft
      if (submitSubmittingRef.current) {
        return;
      }

      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        // Only clear pending selection if no draft was typed and no retry error is active
        if (!draftRef.current.trim() && !submitErrorRef.current) {
          setPendingSelection(null);
          pendingSelectionRef.current = null;
          pendingRangeRef.current = null;
        }
        return;
      }

      const range = sel.getRangeAt(0);
      const text = range.toString().trim();
      if (!text) {
        return;
      }

      const result = extractSelectionFromDOM(
        range,
        anchors,
        alignedBlocksRef.current,
        duplicateHeadingsRef.current
      );

      if (result.success) {
        pendingRangeRef.current = range.cloneRange();
        setPendingSelection(result.pending);
        pendingSelectionRef.current = result.pending;
        setSelectionTip(null);
        setSubmitError(null);
        submitErrorRef.current = null;
      } else {
        pendingRangeRef.current = null;
        // Show short hint if user selected across paragraphs or invalid block
        if (
          result.reason === "请在同一段落内选择文字" ||
          result.reason === "文档存在同名标题，无法唯一定位" ||
          result.reason === "当前段落暂不支持批注"
        ) {
          const sX = typeof window !== "undefined" ? window.scrollX || window.pageXOffset : 0;
          const sY = typeof window !== "undefined" ? window.scrollY || window.pageYOffset : 0;
          setSelectionTip({
            text: result.reason,
            rect: toDocRect(range.getBoundingClientRect(), sX, sY),
          });
          const timer = setTimeout(() => {
            setSelectionTip(null);
          }, 3200);
          return () => clearTimeout(timer);
        }
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (isInsideInteractiveOverlay(e.target as Node | null)) {
        return;
      }
      setTimeout(handleSelectionChange, 10);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (isInsideInteractiveOverlay(document.activeElement)) {
        return;
      }
      if (e.key === "Shift" || e.key.startsWith("Arrow")) {
        setTimeout(handleSelectionChange, 10);
      }
    };

    document.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("keyup", handleKeyUp);

    return () => {
      document.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("keyup", handleKeyUp);
    };
  }, [docId, anchors]);

  // Submit comment handler
  const handleSubmitComment = async (content: string) => {
    const currentPending = pendingSelectionRef.current || pendingSelection;
    if (!currentPending || !docId || submitSubmittingRef.current) return;

    setSubmitSubmitting(true);
    submitSubmittingRef.current = true;
    setSubmitError(null);
    submitErrorRef.current = null;

    try {
      const res = await fetch(`${Web.api}/api/comments`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-actor-type": "user",
          "x-actor-id": "reader",
        },
        body: JSON.stringify({
          doc_id: docId,
          anchor: {
            heading: currentPending.heading,
            quote: currentPending.quote,
            occurrence: currentPending.occurrence,
          },
          content,
          version_sha: currentPending.version_sha,
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        let errMsg = `提交失败 (${res.status}): ${errText.slice(0, 100)}`;
        if (res.status === 400 && errText.includes("stale")) {
          errMsg = "文档版本已更新，请刷新页面后重试";
        } else if (res.status === 500) {
          errMsg = `服务器错误 (${res.status})，点击重试`;
        }
        setSubmitError(errMsg);
        submitErrorRef.current = errMsg;
        return;
      }

      // Success: close floating box, clear draft, reload comments
      setPendingSelection(null);
      pendingSelectionRef.current = null;
      pendingRangeRef.current = null;
      setDraft("");
      draftRef.current = "";
      setSubmitError(null);
      submitErrorRef.current = null;
      window.getSelection()?.removeAllRanges();

      // Refresh comment list
      fetchData(docId);
    } catch (err: unknown) {
      const errMsg =
        err instanceof Error ? err.message : "网络连接失败，点击重试";
      setSubmitError(errMsg);
      submitErrorRef.current = errMsg;
    } finally {
      setSubmitSubmitting(false);
      submitSubmittingRef.current = false;
    }
  };

  const handleSelectMarkerFromSidebar = useCallback(
    (key: string | null, source: NavigationSource = "card_select") => {
      setActiveMarkerKey(key);
      if (key) {
        setNavIntent({
          key,
          source,
          timestamp: Date.now(),
        });
      } else {
        setNavIntent(null);
      }
    },
    []
  );

  const scrollX = typeof window !== "undefined" ? window.scrollX || window.pageXOffset : 0;
  const scrollY = typeof window !== "undefined" ? window.scrollY || window.pageYOffset : 0;

  return (
    <div className="dooc-root" data-dooc-marker={Web.marker}>
      {/* Load error toast with retry */}
      {loadError && (
        <div className="dooc-error-toast" role="alert">
          <span className="dooc-error-toast-text">{loadError}</span>
          <button
            type="button"
            className="dooc-retry-btn"
            aria-label="重试加载"
            onClick={() => fetchData(docId)}
          >
            重试
          </button>
        </div>
      )}

      {/* Floating selection tooltip for errors like cross-paragraph */}
      {selectionTip && (
        <div
          className="dooc-selection-tip"
          role="status"
          style={{
            position: "absolute",
            top: `${selectionTip.rect.top - 38}px`,
            left: `${Math.max(
              16 + scrollX,
              Math.min(
                selectionTip.rect.left,
                window.innerWidth - 220 + scrollX
              )
            )}px`,
            zIndex: 105,
          }}
        >
          {selectionTip.text}
        </div>
      )}

      {/* Markers overlay on text */}
      {docId && (
        <CommentMarkerLayer
          markers={markers}
          activeMarkerKey={activeMarkerKey}
          pendingSelection={pendingSelection}
        />
      )}

      {/* Floating compact input box near selection */}
      {docId && pendingSelection && (
        <FloatingCommentBox
          pending={pendingSelection}
          submitting={submitSubmitting}
          errorMessage={submitError}
          draft={draft}
          onDraftChange={(newDraft) => {
            setDraft(newDraft);
            draftRef.current = newDraft;
          }}
          onSubmit={handleSubmitComment}
          onClose={() => {
            setPendingSelection(null);
            pendingSelectionRef.current = null;
            pendingRangeRef.current = null;
            setSubmitError(null);
            submitErrorRef.current = null;
            setDraft("");
            draftRef.current = "";
          }}
          onRetry={() => {
            if (draftRef.current.trim()) {
              handleSubmitComment(draftRef.current.trim());
            }
          }}
        />
      )}

      {/* Comment sidebar:
          Desktop: Real document-coordinate track (no independent scroll, aligns with quote)
          Mobile: Portaled into post-document host with bidirectional locate */}
      {mounted && docId && (
        isMobile ? (
          portalTarget && createPortal(
            <CommentSidebar
              comments={comments}
              markers={markers}
              activeMarkerKey={activeMarkerKey}
              navIntent={navIntent}
              onSelectMarkerKey={handleSelectMarkerFromSidebar}
              loading={commentsLoading}
              error={loadError}
              onRetry={() => fetchData(docId)}
              isMobile={true}
            />,
            portalTarget
          )
        ) : (
          <CommentSidebar
            comments={comments}
            markers={markers}
            activeMarkerKey={activeMarkerKey}
            navIntent={navIntent}
            onSelectMarkerKey={handleSelectMarkerFromSidebar}
            loading={commentsLoading}
            error={loadError}
            onRetry={() => fetchData(docId)}
            isMobile={false}
            trackLeft={desktopTrack.left}
            trackWidth={desktopTrack.width}
          />
        )
      )}

      {/* Independent Task Entrance */}
      <TaskPopover />
    </div>
  );
}
