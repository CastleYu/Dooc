import { useRef, useEffect, useMemo, useState } from "react";
import type {
  CommentItem,
  MarkerAggregate,
  SidebarCardItem,
  NavigationIntent,
  NavigationSource,
} from "./types";

export interface CommentSidebarProps {
  comments: CommentItem[];
  markers: MarkerAggregate[];
  activeMarkerKey: string | null;
  navIntent?: NavigationIntent | null;
  onSelectMarkerKey?: (key: string | null, source?: NavigationSource) => void;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  isMobile?: boolean;
  trackLeft?: number;
  trackWidth?: number;
}

interface PositionedSidebarCard extends SidebarCardItem {
  actualTop: number;
  quoteTop: number;
  quoteRight: number;
  quoteCenterY: number;
  isPushedDown: boolean;
}

export function CommentSidebar({
  comments,
  markers,
  activeMarkerKey,
  navIntent,
  onSelectMarkerKey,
  loading,
  error,
  onRetry,
  isMobile = false,
  trackLeft = 0,
  trackWidth = 320,
}: CommentSidebarProps) {
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [cardHeights, setCardHeights] = useState<Map<string, number>>(new Map());

  // Aggregate mapped and unmapped comments into sidebar cards
  const mappedCards = useMemo(() => {
    const list: SidebarCardItem[] = markers.map((marker) => {
      const firstRect = marker.highlightRects[0] || marker.rect;
      const quoteTop = firstRect ? firstRect.top : (marker.rect?.top ?? 0);
      const quoteRight = firstRect ? firstRect.right : (marker.rect?.right ?? 0);
      const quoteHeight = firstRect ? firstRect.height : (marker.rect?.height ?? 18);
      const quoteCenterY = quoteTop + quoteHeight / 2;

      return {
        key: marker.key,
        isMapped: true,
        anchor: marker.anchor,
        quote: marker.displayText || marker.anchor?.quote,
        heading: marker.anchor?.heading,
        comments: marker.comments,
        rectTop: quoteTop,
        quoteTop,
        quoteRight,
        actualTop: quoteTop,
        isOrphaned: false,
      };
    });

    // Sort strictly by vertical document quote position (原文顺序)
    list.sort((a, b) => (a.quoteTop ?? 0) - (b.quoteTop ?? 0));
    return list;
  }, [markers]);

  const unmappedCards = useMemo(() => {
    const mappedCommentIds = new Set<string>();
    for (const m of markers) {
      for (const c of m.comments) {
        mappedCommentIds.add(c.id);
      }
    }

    const unmappedMap = new Map<string, CommentItem[]>();
    for (const comment of comments) {
      if (mappedCommentIds.has(comment.id)) continue;
      const quote = comment.anchor?.quote || "";
      const heading = comment.anchor?.heading || "";
      const occ = comment.anchor?.occurrence ?? 1;
      const groupKey = quote
        ? `unmapped::${heading}::${quote}::${occ}`
        : `unmapped-orphan::${comment.id}`;

      if (!unmappedMap.has(groupKey)) {
        unmappedMap.set(groupKey, []);
      }
      unmappedMap.get(groupKey)!.push(comment);
    }

    const unmappedList: SidebarCardItem[] = [];
    for (const [groupKey, groupComments] of unmappedMap.entries()) {
      const first = groupComments[0];
      unmappedList.push({
        key: groupKey,
        isMapped: false,
        anchor: first.anchor,
        quote: first.anchor?.quote,
        heading: first.anchor?.heading,
        comments: groupComments,
        isOrphaned: true,
      });
    }

    return unmappedList;
  }, [comments, markers]);

  // Measure card heights with ResizeObserver + document.fonts.ready, avoiding observer loops
  useEffect(() => {
    if (typeof window === "undefined" || isMobile) return;

    let rafId: number | null = null;
    const ro = new ResizeObserver((entries) => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        let changed = false;
        const nextMap = new Map(cardHeights);
        for (const entry of entries) {
          const key = (entry.target as HTMLElement).getAttribute("data-card-key");
          if (key) {
            const h = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
            const currentH = nextMap.get(key);
            if (!currentH || Math.abs(currentH - h) > 1.5) {
              nextMap.set(key, Math.round(h));
              changed = true;
            }
          }
        }
        if (changed) {
          setCardHeights(nextMap);
        }
      });
    });

    for (const [, el] of cardRefs.current.entries()) {
      if (el) ro.observe(el);
    }

    if (typeof document !== "undefined" && document.fonts?.ready) {
      document.fonts.ready.then(() => {
        let changed = false;
        const nextMap = new Map(cardHeights);
        for (const [key, el] of cardRefs.current.entries()) {
          if (el) {
            const h = el.getBoundingClientRect().height;
            if (Math.abs((nextMap.get(key) || 0) - h) > 1.5) {
              nextMap.set(key, Math.round(h));
              changed = true;
            }
          }
        }
        if (changed) {
          setCardHeights(nextMap);
        }
      });
    }

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, [isMobile, mappedCards, unmappedCards, cardHeights]);

  // Compute non-overlapping vertical document coordinates for desktop track
  // Card 0 aligns exactly with Quote 1 first line.
  // Subsequent cards minimally pushed down with 8px gap when colliding.
  const positionedCards = useMemo<PositionedSidebarCard[]>(() => {
    const PADDING = 8;
    const DEFAULT_HEIGHT = 72;
    let currentBottom = 0;

    const result: PositionedSidebarCard[] = [];

    for (let i = 0; i < mappedCards.length; i++) {
      const card = mappedCards[i];
      const idealTop = card.quoteTop ?? 0;
      // First card starts at idealTop; subsequent cards minimally pushed down
      const actualTop = Math.max(idealTop, currentBottom);
      const measuredH = cardHeights.get(card.key) || DEFAULT_HEIGHT;
      currentBottom = actualTop + measuredH + PADDING;
      const isPushedDown = actualTop > idealTop + 3;

      const firstRect = markers.find((m) => m.key === card.key)?.highlightRects[0] ||
        markers.find((m) => m.key === card.key)?.rect;
      const quoteRight = firstRect ? firstRect.right : (card.quoteRight ?? 0);
      const quoteHeight = firstRect ? firstRect.height : 18;
      const quoteCenterY = (card.quoteTop ?? 0) + quoteHeight / 2;

      result.push({
        ...card,
        actualTop,
        quoteTop: idealTop,
        quoteRight,
        quoteCenterY,
        isPushedDown,
      });
    }

    // Append unmapped/orphaned cards below all mapped cards
    for (const card of unmappedCards) {
      const actualTop = currentBottom > 0 ? currentBottom : 120;
      const measuredH = cardHeights.get(card.key) || DEFAULT_HEIGHT;
      currentBottom = actualTop + measuredH + PADDING;
      result.push({
        ...card,
        actualTop,
        quoteTop: actualTop,
        quoteRight: 0,
        quoteCenterY: actualTop,
        isPushedDown: false,
      });
    }

    return result;
  }, [mappedCards, unmappedCards, cardHeights, markers]);

  // Smooth navigation handling with strict source intent preservation
  useEffect(() => {
    if (!navIntent || navIntent.source !== "text_marker") return;
    const cardEl = cardRefs.current.get(navIntent.key);
    if (!cardEl) return;

    if (isMobile) {
      cardEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } else {
      // On desktop, card is already positioned at quote level in document space.
      // If card was pushed down or partially offscreen, smoothly reveal it:
      const rect = cardEl.getBoundingClientRect();
      const inView = rect.top >= 60 && rect.bottom <= window.innerHeight - 20;
      if (!inView) {
        cardEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
  }, [navIntent, isMobile]);

  // Locate and scroll to marker in document text (card -> text)
  const handleLocateInText = (e: React.MouseEvent, card: SidebarCardItem) => {
    e.stopPropagation();
    onSelectMarkerKey?.(card.key, "card_locate");
    if (!card.isMapped) return;
    const targetMarker = markers.find((m) => m.key === card.key);
    if (targetMarker && targetMarker.rect) {
      window.scrollTo({
        top: Math.max(0, targetMarker.rect.top - 120),
        behavior: "smooth",
      });
    }
  };

  const totalCommentCount = comments.length;

  // Render individual card content (zero avatar, zero username, zero identity badge)
  const renderCard = (card: PositionedSidebarCard | SidebarCardItem, isDesktopTrack = false) => {
    const isActive = activeMarkerKey === card.key;
    const isPushed = "isPushedDown" in card && Boolean(card.isPushedDown);
    const cardId = `dooc-card-${card.key}`;
    const actualTop = "actualTop" in card ? card.actualTop : undefined;

    const actionElement = card.isOrphaned ? (
      <span
        className="dooc-sidebar-status-tag dooc-sidebar-status-tag--orphaned"
        title="正文内容变更或被删除，该批注暂时无法唯一定位到正文标记"
      >
        未锚定
      </span>
    ) : (
      <button
        type="button"
        className="dooc-sidebar-locate-btn"
        title="在正文中定位此段文字"
        aria-label="在正文中定位"
        onClick={(e) => handleLocateInText(e, card)}
      >
        <svg
          viewBox="0 0 24 24"
          width="11"
          height="11"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="15 3 21 3 21 9" />
          <polyline points="9 21 3 21 3 15" />
          <line x1="21" y1="3" x2="14" y2="10" />
          <line x1="3" y1="21" x2="10" y2="14" />
        </svg>
        <span>定位</span>
      </button>
    );

    return (
      <article
        key={card.key}
        id={cardId}
        data-card-key={card.key}
        ref={(el) => {
          if (el) {
            cardRefs.current.set(card.key, el);
          } else {
            cardRefs.current.delete(card.key);
          }
        }}
        className={`dooc-sidebar-card ${
          isActive ? "dooc-sidebar-card--active" : ""
        } ${card.isOrphaned ? "dooc-sidebar-card--orphaned" : ""} ${
          isPushed ? "dooc-sidebar-card--pushed" : ""
        }`}
        style={
          isDesktopTrack && typeof actualTop === "number"
            ? {
                position: "absolute",
                top: `${actualTop}px`,
                left: 0,
                width: "100%",
                pointerEvents: "auto",
              }
            : undefined
        }
        onClick={() => onSelectMarkerKey?.(card.key, "card_select")}
      >
        {card.quote ? (
          <div className="dooc-sidebar-quote-row">
            <blockquote className="dooc-sidebar-quote-snippet">
              <span className="dooc-quote-mark">“</span>
              <span className="dooc-quote-text">{card.quote}</span>
              <span className="dooc-quote-mark">”</span>
            </blockquote>
            {actionElement}
          </div>
        ) : (
          <div className="dooc-sidebar-card-actions">{actionElement}</div>
        )}

        {/* Comment Thread (Zero username, zero avatar, zero identity tags) */}
        <div className="dooc-sidebar-comments-thread">
          {card.comments.map((comment) => (
            <div key={comment.id} className="dooc-sidebar-comment-entry">
              <div className="dooc-sidebar-content">{comment.content}</div>

              {/* Nested replies (Zero username, zero avatar) */}
              {comment.replies && comment.replies.length > 0 && (
                <div className="dooc-sidebar-replies">
                  {comment.replies.map((reply) => (
                    <div key={reply.id} className="dooc-sidebar-reply-item">
                      <div className="dooc-sidebar-content dooc-sidebar-content--reply">
                        {reply.content}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </article>
    );
  };

  // ==========================================
  // MOBILE RENDER (Compact post-document list)
  // ==========================================
  if (isMobile) {
    return (
      <div className="dooc-sidebar dooc-sidebar--mobile" data-dooc-interactive="true">
        <div className="dooc-sidebar-header">
          <div className="dooc-sidebar-title-group">
            <svg
              className="dooc-sidebar-icon"
              viewBox="0 0 24 24"
              width="15"
              height="15"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <span className="dooc-sidebar-title">批注</span>
          </div>

          <div className="dooc-sidebar-header-actions">
            {loading && (
              <div className="dooc-sidebar-loading-indicator" title="正在同步批注...">
                <svg className="dooc-spinner" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                  <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
                </svg>
              </div>
            )}
          </div>
        </div>

        {error && totalCommentCount > 0 && (
          <div className="dooc-sidebar-inline-error" role="alert">
            <span className="dooc-sidebar-inline-error-text">{error}</span>
            <button
              type="button"
              className="dooc-retry-btn"
              onClick={onRetry}
              aria-label="重试加载"
            >
              重试
            </button>
          </div>
        )}

        {totalCommentCount === 0 ? (
          <div className="dooc-sidebar-state-box dooc-sidebar-state-box--empty">
            <div className="dooc-sidebar-empty-icon">
              <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                <line x1="9" y1="10" x2="15" y2="10" strokeDasharray="1 3" strokeWidth="2.5" />
              </svg>
            </div>
            <div className="dooc-sidebar-state-title">暂无批注</div>
            <div className="dooc-sidebar-state-desc">在正文中选中文字即可发表批注</div>
          </div>
        ) : (
          <div className="dooc-sidebar-cards-list">
            {[...mappedCards, ...unmappedCards].map((card) => renderCard(card, false))}
          </div>
        )}
      </div>
    );
  }

  // ==========================================
  // DESKTOP RENDER (Document-coordinate track)
  // ==========================================
  const totalCards = positionedCards.length;
  if (totalCards === 0 && !loading && !error) {
    return null;
  }

  // Calculate bounding SVG height
  const maxCardBottom =
    positionedCards.length > 0
      ? positionedCards[positionedCards.length - 1].actualTop +
        (cardHeights.get(positionedCards[positionedCards.length - 1].key) || 100) +
        30
      : 600;

  return (
    <>
      {/* SVG Connecting lines between quote end and card left */}
      <svg
        className="dooc-sidebar-connector-layer"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: `${maxCardBottom}px`,
          pointerEvents: "none",
          zIndex: 26,
        }}
        aria-hidden="true"
      >
        {positionedCards.map((card) => {
          if (!card.isMapped) return null;
          const isActive = activeMarkerKey === card.key;
          const qX = card.quoteRight;
          const qY = card.quoteCenterY;
          const cX = trackLeft;
          const cY = card.actualTop + 14;

          // Only draw when card is to the right of quote
          if (cX <= qX + 6) return null;

          const deltaX = Math.max(16, cX - qX);
          const cp1X = qX + deltaX * 0.42;
          const cp1Y = qY;
          const cp2X = cX - deltaX * 0.42;
          const cp2Y = cY;
          const pathD = `M ${qX} ${qY} C ${cp1X} ${cp1Y}, ${cp2X} ${cp2Y}, ${cX} ${cY}`;

          return (
            <path
              key={`conn-${card.key}`}
              d={pathD}
              fill="none"
              className={`dooc-connector-line ${
                isActive
                  ? "dooc-connector-line--active"
                  : card.isPushedDown
                  ? "dooc-connector-line--pushed"
                  : "dooc-connector-line--idle"
              }`}
            />
          );
        })}
      </svg>

      {/* Real document-coordinate comment track (scrolls synchronously with document body) */}
      <div
        className="dooc-sidebar dooc-sidebar--desktop-track"
        data-dooc-interactive="true"
        style={{
          position: "absolute",
          top: 0,
          left: `${trackLeft}px`,
          width: `${trackWidth}px`,
          minHeight: `${maxCardBottom}px`,
          pointerEvents: "none",
          zIndex: 27,
        }}
      >
        {error && totalCommentCount > 0 && (
          <div
            className="dooc-sidebar-inline-error"
            role="alert"
            style={{
              position: "absolute",
              top: `${Math.max(10, (positionedCards[0]?.actualTop ?? 100) - 38)}px`,
              left: 0,
              width: "100%",
              pointerEvents: "auto",
            }}
          >
            <span className="dooc-sidebar-inline-error-text">{error}</span>
            <button
              type="button"
              className="dooc-retry-btn"
              onClick={onRetry}
              aria-label="重试加载"
            >
              重试
            </button>
          </div>
        )}

        {positionedCards.map((card) => renderCard(card, true))}
      </div>
    </>
  );
}
