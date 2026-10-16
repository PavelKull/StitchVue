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
