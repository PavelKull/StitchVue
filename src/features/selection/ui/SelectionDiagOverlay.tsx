import { useEffect, useState, type CSSProperties } from "react";
import {
  clearSelectionDiag,
  getSelectionDiagDump,
  selectionDiagEnabled,
  selectionDiagText,
  subscribeSelectionDiag,
} from "./selectionDiag";

/** Floating DEV panel — last selection diag lines + copy dump. */
export function SelectionDiagOverlay() {
  const [lines, setLines] = useState(() => getSelectionDiagDump().slice(-14));
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!selectionDiagEnabled()) {
      return;
    }
    return subscribeSelectionDiag(() => {
      setLines(getSelectionDiagDump().slice(-14));
    });
  }, []);

  if (!selectionDiagEnabled()) {
    return null;
  }

  return (
    <div
      data-sv-sel-diag-overlay="true"
      style={{
        position: "fixed",
        left: 8,
        top: 48,
        zIndex: 9999,
        width: 440,
        maxHeight: 260,
        overflow: "auto",
        padding: "8px 10px",
        borderRadius: 8,
        background: "rgb(8 12 20 / 92%)",
        color: "#d7e2f2",
        font: "11px/1.35 ui-monospace, Consolas, monospace",
        boxShadow: "0 8px 24px rgb(0 0 0 / 45%)",
        pointerEvents: "auto",
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
    >
      <div style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "center" }}>
        <strong style={{ flex: 1 }}>sv-sel-diag (DEV)</strong>
        <button
          type="button"
          style={btnStyle}
          onClick={() => {
            void navigator.clipboard.writeText(selectionDiagText()).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1200);
            });
          }}
        >
          {copied ? "copied" : "copy"}
        </button>
        <button type="button" style={btnStyle} onClick={() => clearSelectionDiag()}>
          clear
        </button>
      </div>
      {lines.length === 0 ? (
        <div style={{ opacity: 0.7 }}>Ctrl/Shift+click or Ctrl+A — events appear here</div>
      ) : (
        lines.map((entry, index) => (
          <div key={`${entry.t}-${index}`} style={{ marginBottom: 4, wordBreak: "break-word" }}>
            <span style={{ color: "#7eb6ff" }}>{entry.kind}</span>{" "}
            <span style={{ opacity: 0.9 }}>{summarize(entry.detail)}</span>
          </div>
        ))
      )}
    </div>
  );
}

const btnStyle: CSSProperties = {
  border: "1px solid rgb(255 255 255 / 25%)",
  background: "rgb(255 255 255 / 8%)",
  color: "#fff",
  borderRadius: 4,
  padding: "2px 8px",
  cursor: "pointer",
  font: "inherit",
};

function summarize(detail: Record<string, unknown>): string {
  const keys = [
    "target",
    "layerAtPoint",
    "ctrlKey",
    "shiftKey",
    "defaultPrevented",
    "earlyReturn",
    "path",
    "countBefore",
    "countAfter",
    "countAfterSync",
    "modeAfterSync",
    "matchedInViewImages",
    "orderedCount",
    "selectionMode",
    "called",
    "doubleToggleRisk",
    "key",
    "code",
    "sampleSel",
    "sampleImg",
    "attached",
    "fired",
    "gestureId",
    "toggles",
  ];
  const parts: string[] = [];
  for (const key of keys) {
    if (detail[key] === undefined || detail[key] === null) {
      continue;
    }
    const value = detail[key];
    if (typeof value === "boolean" || typeof value === "number") {
      parts.push(`${key}=${value}`);
    } else {
      parts.push(`${key}=${String(value).slice(0, 80)}`);
    }
  }
  return parts.join(" · ") || JSON.stringify(detail).slice(0, 120);
}
