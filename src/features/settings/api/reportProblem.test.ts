import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BUG_REPORT_SUBJECT,
  CONTACT_SUBJECT,
  buildBugReportIssueUrl,
  resolveReportProblemRoute,
} from "./reportProblem.ts";

describe("resolveReportProblemRoute", () => {
  it("prefers GitHub Issues when configured", () => {
    assert.deepEqual(
      resolveReportProblemRoute("https://github.com/example/repo/issues/new", "dev@example.com"),
      { channel: "github_issues" },
    );
  });

  it("falls back to bug-report mailto when Issues is empty", () => {
    assert.deepEqual(resolveReportProblemRoute("", "pk.connect.mail@gmail.com"), {
      channel: "mailto",
      subject: BUG_REPORT_SUBJECT,
    });
  });

  it("does not invent a mailto subject other than the bug-report subject", () => {
    const route = resolveReportProblemRoute("", "dev@example.com");
    assert.equal(route.channel, "mailto");
    if (route.channel === "mailto") {
      assert.equal(route.subject, "StitchVue — Bug Report");
      assert.notEqual(route.subject, CONTACT_SUBJECT);
    }
  });

  it("is unavailable when neither Issues nor email is set", () => {
    assert.deepEqual(resolveReportProblemRoute("", ""), { channel: "unavailable" });
  });

  it("builds a prefilled GitHub new-issue URL", () => {
    const url = buildBugReportIssueUrl("https://github.com/example/repo/issues/new", "0.1.3");
    assert.match(url, /^https:\/\/github\.com\/example\/repo\/issues\/new\?/);
    assert.match(url, /title=Bug\+report/);
    assert.match(url, /0\.1\.3/);
    assert.match(url, /Steps\+to\+reproduce/);
  });

  it("ignores email when Issues URL is present (no silent email fallback)", () => {
    const route = resolveReportProblemRoute(
      "https://github.com/example/repo/issues/new",
      "dev@example.com",
    );
    assert.equal(route.channel, "github_issues");
  });
});
