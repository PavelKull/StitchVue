import { invoke } from "@tauri-apps/api/core";
import { supportMailtoUrl } from "../../../shared/config";
import { CONTACT_SUBJECT } from "./reportProblem";

export type ExternalLinkKind =
  | "cloudtips"
  | "boosty"
  | "github_repo"
  | "github_issues"
  | "linkedin"
  | "support_email";

export type OpenExternalLinkOptions = {
  /** Subject for `support_email` mailto. Defaults to contact subject. */
  subject?: string;
  /** Full `…/issues/new?…` URL when kind is `github_issues` (must match configured repo). */
  issuesUrl?: string;
};

export async function openExternalLink(
  kind: ExternalLinkKind,
  options?: OpenExternalLinkOptions,
): Promise<void> {
  if (kind === "support_email") {
    const url = supportMailtoUrl(options?.subject ?? CONTACT_SUBJECT);
    if (!url) {
      throw new Error("support email not configured");
    }
    await invoke("open_external_link", { kind, url });
    return;
  }
  await invoke("open_external_link", { kind, url: options?.issuesUrl ?? null });
}
