import links from "./external-links.json";

/** CloudTips page for voluntary donations in Russia. */
export const CLOUDTIPS_URL = links.cloudtips;

/** Boosty donate page for international supporters. */
export const BOOSTY_URL = links.boosty;

/** Public Git repository. Empty hides repo/issue links until published. */
export const GITHUB_REPO_URL: string = links.githubRepo;

/** Public LinkedIn profile of the developer. Empty hides the About link. */
export const LINKEDIN_URL: string = links.linkedin;

/** Contact email for bug reports and improvement suggestions. */
export const SUPPORT_EMAIL: string = links.supportEmail;

export function githubIssuesUrl(): string {
  if (!GITHUB_REPO_URL) {
    return "";
  }
  return `${GITHUB_REPO_URL.replace(/\/$/, "")}/issues/new`;
}

/** `mailto:` link for the About feedback actions. */
export function supportMailtoUrl(subject?: string): string {
  if (!SUPPORT_EMAIL) {
    return "";
  }
  if (!subject) {
    return `mailto:${SUPPORT_EMAIL}`;
  }
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`;
}
