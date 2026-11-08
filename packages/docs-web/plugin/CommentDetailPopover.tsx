import type { MarkerAggregate } from "./types";

export interface CommentDetailPopoverProps {
  marker?: MarkerAggregate | null;
  onClose?: () => void;
}

/**
 * @deprecated 批注详情大浮层已取消，所有批注默认常显于右侧栏 CommentSidebar。
 * 点击正文标记仅在右侧栏精确定位并高亮强调对应卡片，不再在正文上叠加浮层。
 */
export function CommentDetailPopover(_props: CommentDetailPopoverProps) {
  return null;
}
