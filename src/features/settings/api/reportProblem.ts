/** Subjects for About feedback mailto actions. */
export const BUG_REPORT_SUBJECT = "StitchVue — Bug Report";
export const CONTACT_SUBJECT = "StitchVue — Contact";

export type ReportProblemRoute =
  | { channel: "github_issues" }
  | { channel: "mailto"; subject: typeof BUG_REPORT_SUBJECT }
  | { channel: "unavailable" };

/**
 * Pick bug-report channel from local config only (no network probe).
 * GitHub Issues wins when configured; otherwise mailto with a bug-report subject.
 */
export function resolveReportProblemRoute(
  issuesUrl: string,
  supportEmail: string,
): ReportProblemRoute {
  if (issuesUrl) {
    return { channel: "github_issues" };
  }
  if (supportEmail) {
    return { channel: "mailto", subject: BUG_REPORT_SUBJECT };
  }
  return { channel: "unavailable" };
}

/** Prefilled GitHub issue form (opened in the system browser). */
export function buildBugReportIssueUrl(issuesNewUrl: string, appVersion: string): string {
  const base = issuesNewUrl.replace(/\/$/, "");
  const body = [
    "### StitchVue version",
    appVersion || "—",
    "",
    "### Windows",
    typeof navigator !== "undefined" ? navigator.userAgent : "",
    "",
    "### Steps to reproduce",
    "1. ",
    "",
    "### Expected behavior",
    "",
    "### Actual behavior",
    "",
  ].join("\n");
  const params = new URLSearchParams();
  params.set("title", "Bug report");
  params.set("body", body);
  return `${base}?${params.toString()}`;
}
