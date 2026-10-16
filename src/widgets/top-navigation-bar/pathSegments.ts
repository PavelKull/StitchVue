import i18n from "../../shared/i18n/i18n.ts";

export type PathSegment = {
  label: string;
  path: string | null;
  ellipsis?: boolean;
};

export function segmentsFromPath(path: string | null): PathSegment[] {
  if (path === null) {
    return [{ label: i18n.t("places.thisComputer"), path: null }];
  }

  const normalized = path.replace(/\//g, "\\").replace(/\\+$/, "");
  const match = /^([A-Za-z]:)(?:\\(.*))?$/.exec(normalized);
  if (!match) {
    return [{ label: folderLabel(normalized), path: normalized }];
  }

  const driveRoot = `${match[1]}\\`;
  const result: PathSegment[] = [{ label: match[1], path: driveRoot }];
  const tail = match[2];
  if (!tail) {
    return result;
  }

  let current = driveRoot.slice(0, -1);
  for (const part of tail.split("\\").filter(Boolean)) {
    current = `${current}\\${part}`;
    result.push({ label: part, path: current });
  }
  return result;
}

export function collapseBreadcrumbSegments(segments: PathSegment[]): PathSegment[] {
  if (segments.length <= 4) {
    return segments;
  }
  return [
    segments[0],
    { label: "…", path: null, ellipsis: true },
    segments[segments.length - 2],
    segments[segments.length - 1],
  ];
}

function folderLabel(path: string): string {
  const parts = path.replace(/[/\\]+$/, "").split(/[/\\]/);
  return parts[parts.length - 1] || path;
}
