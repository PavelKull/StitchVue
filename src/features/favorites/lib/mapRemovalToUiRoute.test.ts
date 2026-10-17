import test from "node:test";
import assert from "node:assert/strict";
import {
  mapRemovalToUiRoute,
  mapRemovalToUiRouteOrProceed,
} from "./mapRemovalToUiRoute.ts";

test("unverified / missing / inaccessible origin → fr11, not standardConfirm", () => {
  for (const originPresence of ["unverified", "missing", "inaccessible"] as const) {
    assert.equal(
      mapRemovalToUiRoute({ status: "needs_confirm", originPresence }),
      "fr11",
    );
  }
});

test("unknown_origin confirmKind → fr11", () => {
  assert.equal(
    mapRemovalToUiRoute({
      status: "needs_confirm",
      confirmKind: "unknown_origin",
    }),
    "fr11",
  );
  assert.notEqual(
    mapRemovalToUiRoute({
      status: "needs_confirm",
      confirmKind: "unknown_origin",
    }),
    "standardConfirm",
  );
});

test("fr11Required hint forces fr11 even for otherwise standard kinds", () => {
  assert.equal(
    mapRemovalToUiRoute({
      status: "needs_confirm",
      confirmKind: "origin_changed",
      fr11Required: true,
    }),
    "fr11",
  );
});

test("verified-safe confirms → standardConfirm; trash → originInTrash", () => {
  assert.equal(
    mapRemovalToUiRoute({
      status: "needs_confirm",
      confirmKind: "origin_changed",
    }),
    "standardConfirm",
  );
  assert.equal(
    mapRemovalToUiRoute({
      status: "needs_confirm",
      confirmKind: "copy_changed",
    }),
    "standardConfirm",
  );
  assert.equal(
    mapRemovalToUiRoute({
      status: "needs_confirm",
      confirmKind: "ambiguous_origin",
    }),
    "standardConfirm",
  );
  assert.equal(
    mapRemovalToUiRoute({
      status: "needs_confirm",
      confirmKind: "origin_in_local_trash",
    }),
    "originInTrash",
  );
});

test("ready → ready; proceed alias", () => {
  assert.equal(mapRemovalToUiRoute({ status: "ready" }), "ready");
  assert.equal(mapRemovalToUiRouteOrProceed({ status: "ready" }), "proceed");
});
