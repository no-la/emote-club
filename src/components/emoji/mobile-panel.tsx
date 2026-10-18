"use client";

import type { ComponentPropsWithRef, ComponentPropsWithoutRef, ReactNode } from "react";
import { ChevronUp, X } from "lucide-react";
import styles from "./mobile-panel.module.css";

export type MobilePanelControls = {
  onClose: () => void;
  expanded: boolean;
  onToggleExpanded: () => void;
};

type Props = ComponentPropsWithoutRef<"section"> & {
  controls: MobilePanelControls;
  heading: ReactNode;
  headingClassName?: string;
  headingActions?: ReactNode;
  /** The inspector uses categories instead of its desktop heading on mobile. */
  mobileToolbar?: ReactNode;
  toolbarClassName?: string;
};

function PanelControls({ controls }: { controls: MobilePanelControls }) {
  return <span className={styles.controls} data-panel-controls>
    <button type="button" className={styles.expand} aria-label={controls.expanded ? "パネルを縮小" : "パネルを拡大"} aria-expanded={controls.expanded} onClick={controls.onToggleExpanded}><ChevronUp size={18} style={{ transform: controls.expanded ? "rotate(180deg)" : undefined }} /></button>
    <button type="button" className={styles.close} aria-label="編集パネルを閉じる" onClick={controls.onClose}><X size={20} /></button>
  </span>;
}

/** Shared shell for materials, layers and the inspector; desktop layout stays with each caller. */
export default function MobilePanel({ controls, heading, headingClassName = "", headingActions, mobileToolbar, toolbarClassName = "", className = "", children, ...props }: Props) {
  return <section {...props} className={`${styles.panel} ${className}`}>
    <div className={`${styles.heading} ${headingClassName}`}>
      {heading}
      {headingActions}
      {!mobileToolbar && <PanelControls controls={controls} />}
    </div>
    {mobileToolbar && <div className={`${styles.toolbar} ${toolbarClassName}`} aria-label="編集項目">
      <div className={styles.toolbarContent}>{mobileToolbar}</div><PanelControls controls={controls} />
    </div>}
    {children}
  </section>;
}

type BodyProps = ({ as: "ul" } & ComponentPropsWithRef<"ul">) | ({ as?: "div" } & ComponentPropsWithRef<"div">);
/** Keep the actual scrolling element (and list ref used for touch reordering) intact. */
export function PanelBody(props: BodyProps) {
  if (props.as === "ul") {
    const { as: Tag, className = "", ...rest } = props;
    return <Tag {...rest} className={`${styles.body} ${className}`} />;
  }
  const { as: Tag = "div", className = "", ...rest } = props;
  return <Tag {...rest} className={`${styles.body} ${className}`} />;
}
