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

test("T039: cancel / keep path stays fr11-safe (not standardConfirm relocate)", () => {
  // После cancel UI не должен маршрутизировать в confirm-as-relocate.
  assert.equal(
    mapRemovalToUiRoute({
      status: "skipped",
      confirmKind: "unknown_origin",
    }),
    "fr11",
  );
  assert.notEqual(
    mapRemovalToUiRoute({
      status: "needs_confirm",
      confirmKind: "unknown_origin",
      originPresence: "unverified",
    }),
    "standardConfirm",
  );
});

test("T039: identity conflict / failed unverified → fr11 (B/C/D, not relocate confirm)", () => {
  assert.equal(
    mapRemovalToUiRoute({
      status: "failed",
      originPresence: "unverified",
    }),
    "fr11",
  );
  assert.equal(
    mapRemovalToUiRoute({
      status: "failed",
      confirmKind: "unknown_origin",
      fr11Required: true,
    }),
    "fr11",
  );
  assert.equal(
    mapRemovalToUiRoute({
      status: "needs_confirm",
      confirmKind: "ambiguous_origin",
      originPresence: "missing",
    }),
    "fr11",
  );
});
