import { useState, useEffect } from "react";
import type { MarkerAggregate, PendingSelection } from "./types";

interface CommentMarkerLayerProps {
  markers: MarkerAggregate[];
  activeMarkerKey: string | null;
  pendingSelection: PendingSelection | null;
}

export function CommentMarkerLayer({
  markers,
  activeMarkerKey,
  pendingSelection,
}: CommentMarkerLayerProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || typeof window === "undefined") {
    return <div className="dooc-marker-layer" data-dooc-ignore="true" />;
  }

  return (
    <div className="dooc-marker-layer" data-dooc-ignore="true">
      {/* Pending selection highlight */}
      {pendingSelection && (
        <div
          className="dooc-selection-active-highlight"
          style={{
            position: "absolute",
            left: `${pendingSelection.rect.left}px`,
            top: `${pendingSelection.rect.top}px`,
            width: `${pendingSelection.rect.width}px`,
            height: `${pendingSelection.rect.height}px`,
            pointerEvents: "none",
          }}
        />
      )}

      {/* Existing comment highlights (pointer-events: none preserves normal text selection) */}
      {markers.map((marker) => {
        const isActive = activeMarkerKey === marker.key;

        return (
          <div key={marker.key} className="dooc-marker-group">
            {marker.highlightRects.map((hr, idx) => (
              <div
                key={idx}
                className={`dooc-comment-highlight ${
                  isActive ? "dooc-comment-highlight--active" : ""
                }`}
                style={{
                  position: "absolute",
                  left: `${hr.left}px`,
                  top: `${hr.top}px`,
                  width: `${hr.width}px`,
                  height: `${hr.height}px`,
                  pointerEvents: "none",
                }}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}
