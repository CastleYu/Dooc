import type {
  AnchorBlock,
  AnchorsResponse,
  CommentAnchor,
  DomCharPoint,
  AlignedBlockInfo,
  PendingSelection,
} from "./types";

/**
 * Convert a client/viewport rect to document (page) coordinates.
 */
export function toDocRect(
  r: { left: number; top: number; width: number; height: number; right?: number; bottom?: number },
  scrollX: number,
  scrollY: number
): DOMRect {
  if (typeof DOMRect !== "undefined") {
    return new DOMRect(r.left + scrollX, r.top + scrollY, r.width, r.height);
  }
  return {
    left: r.left + scrollX,
    top: r.top + scrollY,
    right: (r.right ?? r.left + r.width) + scrollX,
    bottom: (r.bottom ?? r.top + r.height) + scrollY,
    width: r.width,
    height: r.height,
    x: r.left + scrollX,
    y: r.top + scrollY,
    toJSON: () => ({}),
  } as DOMRect;
}

/**
 * Compare two DOM points (node, offset) in document order.
 * Returns -1 if pointA is before pointB, 1 if pointA is after pointB, 0 if equal.
 */
function childIndex(ancestor: Node, node: Node): number {
  let current: Node | null = node;
  while (current && current.parentNode !== ancestor) current = current.parentNode;
  if (!current) return -1;
  return Array.prototype.indexOf.call(ancestor.childNodes, current);
}

export function comparePoints(
  nodeA: Node,
  offsetA: number,
  nodeB: Node,
  offsetB: number
): number {
  if (nodeA === nodeB) {
    return offsetA < offsetB ? -1 : offsetA > offsetB ? 1 : 0;
  }
  const pos = nodeA.compareDocumentPosition(nodeB);
  if (pos & Node.DOCUMENT_POSITION_FOLLOWING) {
    if (pos & Node.DOCUMENT_POSITION_CONTAINED_BY) {
      const index = childIndex(nodeA, nodeB);
      if (index < 0) return -1;
      return offsetA <= index ? -1 : 1;
    }
    return -1;
  }
  if (pos & Node.DOCUMENT_POSITION_PRECEDING) {
    if (pos & Node.DOCUMENT_POSITION_CONTAINS) {
      const index = childIndex(nodeB, nodeA);
      if (index < 0) return 1;
      return offsetB <= index ? 1 : -1;
    }
    return 1;
  }
  return 0;
}

/**
 * Check if a character at (node, offset)..(node, offset + 1) overlaps with range.
 */
export function isCharInRange(
  node: Text,
  offset: number,
  range: Range
): boolean {
  const isBeforeEnd =
    comparePoints(node, offset, range.endContainer, range.endOffset) < 0;
  const isAfterStart =
    comparePoints(node, offset + 1, range.startContainer, range.startOffset) > 0;
  return isBeforeEnd && isAfterStart;
}

export function pointInSelection(pt: DomCharPoint, range: Range): boolean {
  if (pt.gap) {
    try {
      return range.intersectsNode(pt.gap);
    } catch {
      return false;
    }
  }
  return isCharInRange(pt.node, pt.offset, range);
}

function placeRangeEdge(range: Range, pt: DomCharPoint, edge: "start" | "end"): void {
  if (pt.gap) {
    if (edge === "start") range.setStartBefore(pt.gap);
    else range.setEndAfter(pt.gap);
    return;
  }
  if (edge === "start") range.setStart(pt.node, pt.offset);
  else range.setEnd(pt.node, pt.offset + 1);
}

/**
 * Find duplicate/ambiguous headings across blocks.
 * If the same heading title appears in multiple distinct section_start locations, it is ambiguous.
 */
export function findDuplicateHeadings(blocks: AnchorBlock[]): Set<string> {
  const headingSections = new Map<string, Set<number>>();
  for (const b of blocks) {
    if (!headingSections.has(b.heading)) {
      headingSections.set(b.heading, new Set());
    }
    headingSections.get(b.heading)!.add(b.section_start);
  }
  const duplicates = new Set<string>();
  for (const [heading, sections] of headingSections.entries()) {
    if (sections.size > 1) {
      duplicates.add(heading);
    }
  }
  return duplicates;
}

/**
 * Find preceding heading element (h1..h6) before el in document order within container.
 */
export function getPrecedingHeadingText(
  el: HTMLElement,
  container: HTMLElement
): string {
  const headings = Array.from(
    container.querySelectorAll("h1, h2, h3, h4, h5, h6")
  ) as HTMLElement[];
  let lastHeading: HTMLElement | null = null;
  for (const h of headings) {
    if (el.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_PRECEDING) {
      lastHeading = h;
    } else {
      break;
    }
  }
  if (!lastHeading) return "";
  return cleanHeadingText(lastHeading);
}

export function cleanHeadingText(headingEl: HTMLElement): string {
  const clone = headingEl.cloneNode(true) as HTMLElement;
  const anchors = clone.querySelectorAll(".header-anchor, a[href^='#'], svg");
  for (const a of Array.from(anchors)) {
    a.remove();
  }
  return (clone.textContent || "").replace(/\s+/g, " ").trim();
}

export function headingMatches(domHeading: string, blockHeading: string): boolean {
  if (!domHeading || !blockHeading) return true;
  const d = domHeading.replace(/\s+/g, " ").trim().toLowerCase();
  const b = blockHeading.replace(/\s+/g, " ").trim().toLowerCase();
  return d === b || d.includes(b) || b.includes(d);
}

/**
 * Extract text nodes from blockEl, ignoring injected markers, dock elements, and icons.
 */
export function collectBlockTextNodes(
  blockEl: HTMLElement
): Array<{ node: Text; offset: number; char: string; gap?: HTMLElement }> {
  const rawChars: Array<{ node: Text; offset: number; char: string; gap?: HTMLElement }> = [];

  function walk(node: Node) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      if (
        el.hasAttribute("data-dooc-ignore") ||
        el.hasAttribute("data-dooc-marker") ||
        el.classList.contains("dooc-marker-badge") ||
        el.classList.contains("header-anchor") ||
        el.tagName === "BUTTON"
      ) {
        return;
      }
      if (el.tagName === "BR") {
        rawChars.push({
          node: el.ownerDocument.createTextNode(" "),
          offset: 0,
          char: " ",
          gap: el,
        });
        return;
      }
    }

    if (node.nodeType === Node.TEXT_NODE) {
      const textNode = node as Text;
      const text = textNode.data;
      for (let i = 0; i < text.length; i++) {
        let ch = text[i];
        if (ch === "\u00A0") {
          ch = " ";
        }
        if (/[\u200B-\u200D\uFEFF]/.test(ch)) {
          continue;
        }
        rawChars.push({ node: textNode, offset: i, char: ch });
      }
      return;
    }

    let child = node.firstChild;
    while (child) {
      walk(child);
      child = child.nextSibling;
    }
  }

  walk(blockEl);
  return rawChars;
}

/**
 * Build 1:1 DomCharPoint mapping matching targetText.
 */
export function buildDomMappingForBlock(
  blockEl: HTMLElement,
  targetText: string
): DomCharPoint[] | null {
  const rawChars = collectBlockTextNodes(blockEl);
  const domChars: Array<{ node: Text; offset: number; char: string; gap?: HTMLElement }> = [];

  let inSpace = false;
  for (const rc of rawChars) {
    const isWhitespace = /\s/.test(rc.char);
    if (isWhitespace) {
      if (!inSpace) {
        if (
          domChars.length > 0 ||
          (targetText.length > 0 && targetText[0] === " ")
        ) {
          domChars.push({ node: rc.node, offset: rc.offset, char: " " });
          inSpace = true;
        }
      }
    } else {
      inSpace = false;
      domChars.push(rc);
    }
  }

  if (targetText.length > 0 && targetText[targetText.length - 1] !== " ") {
    while (domChars.length > 0 && domChars[domChars.length - 1].char === " ") {
      domChars.pop();
    }
  }

  const extracted = domChars.map((c) => c.char).join("");
  if (extracted === targetText) {
    return domChars.map((c) => ({ node: c.node, offset: c.offset, gap: c.gap }));
  }

  // Fallback: match without whitespace differences or slight differences
  if (extracted.trim() === targetText.trim() && domChars.length === targetText.length) {
    return domChars.map((c) => ({ node: c.node, offset: c.offset, gap: c.gap }));
  }

  return null;
}

/**
 * Align DOM p/li elements in container with backend blocks in document order.
 */
export function alignDomBlocks(
  container: HTMLElement,
  blocks: AnchorBlock[]
): Map<HTMLElement, AlignedBlockInfo> {
  const result = new Map<HTMLElement, AlignedBlockInfo>();
  if (!blocks || blocks.length === 0) return result;

  const candidateElements = Array.from(
    container.querySelectorAll("p, li")
  ) as HTMLElement[];

  let blockIdx = 0;
  for (const el of candidateElements) {
    if (blockIdx >= blocks.length) break;

    // Skip elements in nav/dock/aside
    if (
      el.closest(
        "nav, aside, .rspress-sidebar, .rp-sidebar, .rspress-toc, .rp-outline, .dooc-dock, .dooc-root"
      )
    ) {
      continue;
    }

    const currentTarget = blocks[blockIdx];
    const mapping = buildDomMappingForBlock(el, currentTarget.text);
    if (mapping) {
      result.set(el, {
        block: currentTarget,
        domMapping: mapping,
      });
      blockIdx += 1;
    }
  }

  return result;
}

/**
 * Non-overlapping occurrence calculation with strict verification.
 * SectionStart to targetStart search in markdown.
 */
export function calculateOccurrence(
  markdown: string,
  sectionStart: number,
  targetStart: number,
  quote: string
): { occurrence: number } | { error: string } {
  if (!quote) {
    return { error: "选区为空" };
  }
  if (targetStart < sectionStart) {
    return { error: "选区超出当前标题区间" };
  }

  let occurrence = 0;
  let searchPos = sectionStart;
  let targetOccurrence = -1;

  while (searchPos <= targetStart) {
    const idx = markdown.indexOf(quote, searchPos);
    if (idx === -1 || idx > targetStart) {
      break;
    }
    occurrence += 1;
    if (idx === targetStart) {
      targetOccurrence = occurrence;
      break;
    }
    searchPos = idx + quote.length;
  }

  if (targetOccurrence === -1) {
    return { error: "无法精确定位所选文本在 Markdown 中的出现位置" };
  }

  // Verification step: verify that the targetOccurrence-th match from sectionStart is indeed targetStart
  let verifyPos = sectionStart;
  let verifyCount = 0;
  let verified = false;
  while (true) {
    const idx = markdown.indexOf(quote, verifyPos);
    if (idx === -1) break;
    verifyCount += 1;
    if (verifyCount === targetOccurrence) {
      if (idx === targetStart) {
        verified = true;
      }
      break;
    }
    verifyPos = idx + quote.length;
  }

  if (!verified) {
    return { error: "选区计数验证不一致" };
  }

  return { occurrence: targetOccurrence };
}

/**
 * Find enclosing p or li element for a node in doc content.
 */
export function findEnclosingBlock(node: Node | null): HTMLElement | null {
  if (!node) return null;
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement;
  if (!el) return null;
  if (el.closest(".dooc-root, .dooc-dock, nav, aside, [data-dooc-ignore]")) return null;
  return el.closest("p, li");
}

/**
 * Extract selection anchor data from DOM selection according to the contract.
 */
export function extractSelectionFromDOM(
  range: Range,
  anchors: AnchorsResponse,
  alignedBlocks: Map<HTMLElement, AlignedBlockInfo>,
  duplicateHeadings: Set<string>
): { success: true; pending: PendingSelection } | { success: false; reason: string } {
  if (range.collapsed) {
    return { success: false, reason: "选区为空" };
  }

  const hits: Array<{ el: HTMLElement; info: AlignedBlockInfo }> = [];
  for (const [el, info] of alignedBlocks) {
    try {
      if (range.intersectsNode(el)) hits.push({ el, info });
    } catch {
      /* detached node */
    }
  }

  if (hits.length === 0) {
    return { success: false, reason: "请在正文段落内选择文字" };
  }

  const heading = hits[0].info.block.heading;
  if (hits.some((hit) => hit.info.block.heading !== heading)) {
    return { success: false, reason: "请在同一标题下选择文字" };
  }
  if (duplicateHeadings.has(heading)) {
    return { success: false, reason: "文档存在同名标题，无法唯一定位" };
  }

  let sourceStart = Number.POSITIVE_INFINITY;
  let sourceEnd = -1;
  let visibleText = "";
  let sectionStart = hits[0].info.block.section_start;
  for (const hit of hits) {
    const { block, domMapping } = hit.info;
    sectionStart = Math.min(sectionStart, block.section_start);
    for (let i = 0; i < domMapping.length; i++) {
      const pt = domMapping[i];
      if (!pt || !pointInSelection(pt, range)) continue;
      sourceStart = Math.min(sourceStart, block.starts[i]);
      sourceEnd = Math.max(sourceEnd, block.ends[i]);
      visibleText += block.text[i] ?? "";
    }
  }

  if (!Number.isFinite(sourceStart) || sourceEnd < sourceStart) {
    return { success: false, reason: "选区未包含有效正文字符" };
  }

  const rawQuote = anchors.markdown.slice(sourceStart, sourceEnd);
  if (!rawQuote) {
    return { success: false, reason: "选区为空" };
  }

  const occRes = calculateOccurrence(
    anchors.markdown,
    sectionStart,
    sourceStart,
    rawQuote
  );

  if ("error" in occRes) {
    return { success: false, reason: occRes.error };
  }

  const scrollX = typeof window !== "undefined" ? window.scrollX || window.pageXOffset : 0;
  const scrollY = typeof window !== "undefined" ? window.scrollY || window.pageYOffset : 0;
  const rect = toDocRect(range.getBoundingClientRect(), scrollX, scrollY);
  const rects = Array.from(range.getClientRects());
  const last = rects.length > 0 ? rects[rects.length - 1] : range.getBoundingClientRect();
  const buttonWidth = 72;
  let buttonLeft = last.right + scrollX + 8;
  let buttonTop = last.top + scrollY;
  if (last.right + 8 + buttonWidth > window.innerWidth) {
    buttonLeft = last.left + scrollX;
    buttonTop = last.bottom + scrollY + 6;
  }

  return {
    success: true,
    pending: {
      heading,
      quote: rawQuote,
      occurrence: occRes.occurrence,
      version_sha: anchors.version_sha,
      rect,
      buttonTop,
      buttonLeft,
      blockEl: hits[0].el,
      text: visibleText,
    },
  };
}

/**
 * Reverse-lookup an anchor to Range and DOMRects for rendering existing markers.
 */
export function reverseMapAnchor(
  anchor: CommentAnchor,
  anchors: AnchorsResponse,
  alignedBlocks: Map<HTMLElement, AlignedBlockInfo>,
  duplicateHeadings: Set<string>
): { range: Range; boundingRect: DOMRect; clientRects: DOMRect[] } | null {
  if (duplicateHeadings.has(anchor.heading)) {
    return null;
  }

  const matchingBlocks = anchors.blocks.filter((b) => b.heading === anchor.heading);
  if (matchingBlocks.length === 0) return null;
  const sectionStart = matchingBlocks[0].section_start;

  let sectionEnd = anchors.markdown.length;
  for (const b of anchors.blocks) {
    if (b.section_start > sectionStart && b.section_start < sectionEnd) {
      sectionEnd = b.section_start;
    }
  }

  // Find the occurrence-th non-overlapping appearance in markdown within section
  let searchPos = sectionStart;
  let matchStart = -1;
  for (let i = 1; i <= anchor.occurrence; i++) {
    const idx = anchors.markdown.indexOf(anchor.quote, searchPos);
    if (idx === -1 || idx >= sectionEnd) {
      matchStart = -1;
      break;
    }
    if (i === anchor.occurrence) {
      matchStart = idx;
    }
    searchPos = idx + anchor.quote.length;
  }

  if (matchStart === -1) {
    return null;
  }
  const matchEnd = matchStart + anchor.quote.length;

  // Find which block contains this raw range
  for (const { block, domMapping } of alignedBlocks.values()) {
    if (block.heading !== anchor.heading) continue;
    if (block.starts.length === 0) continue;

    let a = -1;
    let bEnd = -1;

    for (let i = 0; i < block.starts.length; i++) {
      if (block.starts[i] === matchStart) {
        a = i;
        break;
      }
    }
    if (a === -1) {
      for (let i = 0; i < block.starts.length; i++) {
        if (block.starts[i] >= matchStart) {
          a = i;
          break;
        }
      }
    }

    for (let i = block.ends.length - 1; i >= 0; i--) {
      if (block.ends[i] === matchEnd) {
        bEnd = i + 1;
        break;
      }
    }
    if (bEnd === -1) {
      for (let i = block.ends.length - 1; i >= 0; i--) {
        if (block.ends[i] <= matchEnd) {
          bEnd = i + 1;
          break;
        }
      }
    }

    if (a !== -1 && bEnd > a && domMapping[a] && domMapping[bEnd - 1]) {
      try {
        const range = document.createRange();
        placeRangeEdge(range, domMapping[a], "start");
        placeRangeEdge(range, domMapping[bEnd - 1], "end");

        const scrollX = typeof window !== "undefined" ? window.scrollX || window.pageXOffset : 0;
        const scrollY = typeof window !== "undefined" ? window.scrollY || window.pageYOffset : 0;
        const clientRects = Array.from(range.getClientRects()).map((r) =>
          toDocRect(r, scrollX, scrollY)
        );
        const boundingRect = toDocRect(range.getBoundingClientRect(), scrollX, scrollY);

        if (clientRects.length > 0 && boundingRect.width > 0) {
          return { range, boundingRect, clientRects };
        }
      } catch {
        continue;
      }
    }
  }

  const spanned: Array<{ pt: DomCharPoint; start: number }> = [];
  for (const { block, domMapping } of alignedBlocks.values()) {
    if (block.heading !== anchor.heading) continue;
    for (let i = 0; i < block.starts.length; i++) {
      if (block.ends[i] <= matchStart || block.starts[i] >= matchEnd) continue;
      if (!domMapping[i]) continue;
      spanned.push({ pt: domMapping[i], start: block.starts[i] });
    }
  }
  spanned.sort((a, b) => a.start - b.start);
  if (spanned.length > 0) {
    try {
      const range = document.createRange();
      placeRangeEdge(range, spanned[0].pt, "start");
      placeRangeEdge(range, spanned[spanned.length - 1].pt, "end");
      const scrollX = typeof window !== "undefined" ? window.scrollX || window.pageXOffset : 0;
      const scrollY = typeof window !== "undefined" ? window.scrollY || window.pageYOffset : 0;
      const clientRects = Array.from(range.getClientRects()).map((r) => toDocRect(r, scrollX, scrollY));
      const boundingRect = toDocRect(range.getBoundingClientRect(), scrollX, scrollY);
      if (clientRects.length > 0 && boundingRect.width > 0) {
        return { range, boundingRect, clientRects };
      }
    } catch {
      return null;
    }
  }

  return null;
}
