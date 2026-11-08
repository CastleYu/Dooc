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
    return -1;
  }
  if (pos & Node.DOCUMENT_POSITION_PRECEDING) {
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
): Array<{ node: Text; offset: number; char: string }> {
  const rawChars: Array<{ node: Text; offset: number; char: string }> = [];

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
  const domChars: Array<{ node: Text; offset: number; char: string }> = [];

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
    return domChars.map((c) => ({ node: c.node, offset: c.offset }));
  }

  // Fallback: match without whitespace differences or slight differences
  if (extracted.trim() === targetText.trim() && domChars.length === targetText.length) {
    return domChars.map((c) => ({ node: c.node, offset: c.offset }));
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

  const startBlock = findEnclosingBlock(range.startContainer);
  const endBlock = findEnclosingBlock(range.endContainer);

  if (!startBlock || !endBlock) {
    return { success: false, reason: "请在正文段落内选择文字" };
  }

  if (startBlock !== endBlock) {
    return { success: false, reason: "请在同一段落内选择文字" };
  }

  const aligned = alignedBlocks.get(startBlock);
  if (!aligned) {
    return { success: false, reason: "当前段落暂不支持批注" };
  }

  const { block, domMapping } = aligned;

  if (duplicateHeadings.has(block.heading)) {
    return { success: false, reason: "文档存在同名标题，无法唯一定位" };
  }

  let firstIndex = -1;
  let lastIndex = -1;

  for (let i = 0; i < domMapping.length; i++) {
    const pt = domMapping[i];
    if (isCharInRange(pt.node, pt.offset, range)) {
      if (firstIndex === -1) {
        firstIndex = i;
      }
      lastIndex = i;
    }
  }

  if (firstIndex === -1 || lastIndex === -1 || firstIndex > lastIndex) {
    return { success: false, reason: "选区未包含有效正文字符" };
  }

  const a = firstIndex;
  const b = lastIndex + 1;

  const rawQuote = anchors.markdown.slice(block.starts[a], block.ends[b - 1]);
  if (!rawQuote) {
    return { success: false, reason: "选区为空" };
  }

  const occRes = calculateOccurrence(
    anchors.markdown,
    block.section_start,
    block.starts[a],
    rawQuote
  );

  if ("error" in occRes) {
    return { success: false, reason: occRes.error };
  }

  const scrollX = typeof window !== "undefined" ? window.scrollX || window.pageXOffset : 0;
  const scrollY = typeof window !== "undefined" ? window.scrollY || window.pageYOffset : 0;
  const rect = toDocRect(range.getBoundingClientRect(), scrollX, scrollY);
  const visibleText = block.text.slice(a, b);

  return {
    success: true,
    pending: {
      heading: block.heading,
      quote: rawQuote,
      occurrence: occRes.occurrence,
      version_sha: anchors.version_sha,
      rect,
      blockEl: startBlock,
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
        range.setStart(domMapping[a].node, domMapping[a].offset);
        range.setEnd(domMapping[bEnd - 1].node, domMapping[bEnd - 1].offset + 1);

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

  return null;
}
