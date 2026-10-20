import type { ReactNode, RefObject } from "react";
import { useAnimatedModal } from "./useAnimatedModal";
import styles from "./AnimatedModalFrame.module.scss";

export type AnimatedModalFrameProps = {
  open: boolean;
  titleId?: string;
  wide?: boolean;
  onBackdropClick?: () => void;
  panelRef?: RefObject<HTMLDivElement | null>;
  children: ReactNode;
};

/** C-002 modal channel: shared backdrop + motion shell (content stays per dialog). */
export function AnimatedModalFrame({
  open,
  titleId,
  wide = false,
  onBackdropClick,
  panelRef,
  children,
}: AnimatedModalFrameProps) {
  const { mounted, phase } = useAnimatedModal(open);

  if (!mounted) {
    return null;
  }

  const panelClass = wide ? `${styles.panel} ${styles.panelWide}` : styles.panel;

  return (
    <div
      className={styles.backdrop}
      data-modal-phase={phase}
      role="presentation"
      onClick={onBackdropClick}
    >
      <div
        ref={panelRef}
        className={panelClass}
        data-modal-phase={phase}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
