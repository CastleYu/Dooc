export interface AnchorBlock {
  index: number;
  heading: string;
  section_start: number;
  text: string;
  starts: number[];
  ends: number[];
}

export interface AnchorsResponse {
  doc_id: string;
  version_sha: string;
  markdown: string;
  blocks: AnchorBlock[];
}

export interface CommentAnchor {
  heading: string;
  quote: string;
  occurrence: number;
  state?: string;
}

export interface CommentReply {
  id: string;
  author: {
    type: string;
    id: string;
    name?: string;
  };
  content: string;
  created_at?: string;
}

export interface CommentItem {
  id: string;
  doc_id: string;
  anchor: CommentAnchor;
  author: {
    type: string;
    id: string;
    name?: string;
  };
  content: string;
  status?: string;
  replies?: CommentReply[];
  created_at: string;
  updated_at?: string;
}

export interface DomCharPoint {
  node: Text;
  offset: number;
  gap?: HTMLElement;
}

export interface AlignedBlockInfo {
  block: AnchorBlock;
  domMapping: DomCharPoint[];
}

export interface PendingSelection {
  heading: string;
  quote: string;
  occurrence: number;
  version_sha: string;
  rect: DOMRect;
  buttonTop: number;
  buttonLeft: number;
  blockEl: HTMLElement;
  text: string;
}

export interface MarkerAggregate {
  key: string;
  anchor: CommentAnchor;
  comments: CommentItem[];
  rect: DOMRect;
  highlightRects: DOMRect[];
  displayText?: string;
}

export interface SidebarCardItem {
  key: string;
  isMapped: boolean;
  anchor?: CommentAnchor;
  quote?: string;
  heading?: string;
  comments: CommentItem[];
  rectTop?: number;
  quoteTop?: number;
  quoteRight?: number;
  actualTop?: number;
  isPushedDown?: boolean;
  isOrphaned?: boolean;
}

export type NavigationSource = "text_marker" | "card_locate" | "card_select";

export interface NavigationIntent {
  key: string;
  source: NavigationSource;
  timestamp: number;
}

