import { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { StitchVueIcon } from "../../shared/icons/StitchVueIcon";
import { collapseBreadcrumbSegments, segmentsFromPath, type PathSegment } from "./pathSegments";
import styles from "./TopNavigationBar.module.scss";

type BreadcrumbsProps = {
  path: string | null;
  onNavigate: (path: string | null) => void;
};

export function Breadcrumbs({ path, onNavigate }: BreadcrumbsProps) {
  const { t } = useTranslation();
  const navRef = useRef<HTMLElement>(null);
  const measureRef = useRef<HTMLOListElement>(null);
  const fullSegments = segmentsFromPath(path);
  const [collapsed, setCollapsed] = useState(false);

  useLayoutEffect(() => {
    const nav = navRef.current;
    const measure = measureRef.current;
    if (!nav || !measure) {
      return;
    }
    const sync = () => {
      setCollapsed(measure.scrollWidth > nav.clientWidth);
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [path]);

  const segments = collapsed ? collapseBreadcrumbSegments(fullSegments) : fullSegments;

  return (
    <nav ref={navRef} className={styles.breadcrumbs} aria-label={t("topNav.breadcrumbsAria")}>
      <ol ref={measureRef} className={styles.breadcrumbMeasure} aria-hidden="true">
        <BreadcrumbItems segments={fullSegments} onNavigate={onNavigate} measureOnly />
      </ol>
      <ol className={styles.breadcrumbList}>
        <BreadcrumbItems segments={segments} onNavigate={onNavigate} />
      </ol>
    </nav>
  );
}

type BreadcrumbItemsProps = {
  segments: PathSegment[];
  onNavigate: (path: string | null) => void;
  measureOnly?: boolean;
};

function BreadcrumbItems({ segments, onNavigate, measureOnly }: BreadcrumbItemsProps) {
  return (
    <>
      {segments.map((segment, index) => {
        const isLast = index === segments.length - 1;
        return (
          <li key={`${segment.label}-${index}`} className={styles.breadcrumbItem}>
            {index > 0 && (
              <span className={styles.breadcrumbSep} aria-hidden="true">
                <StitchVueIcon name="breadcrumb-chevron-right" />
              </span>
            )}
            {segment.ellipsis ? (
              <span className={styles.breadcrumbEllipsis}>{segment.label}</span>
            ) : isLast ? (
              <span className={styles.breadcrumbCurrent} aria-current={measureOnly ? undefined : "location"}>
                {segment.label}
              </span>
            ) : (
              <button
                type="button"
                className={styles.breadcrumbLink}
                tabIndex={measureOnly ? -1 : undefined}
                onClick={measureOnly ? undefined : () => onNavigate(segment.path)}
              >
                {segment.label}
              </button>
            )}
          </li>
        );
      })}
    </>
  );
}
