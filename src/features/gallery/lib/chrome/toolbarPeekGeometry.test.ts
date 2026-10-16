import test from "node:test";
import assert from "node:assert/strict";
import {
  toolbarPeekDistanceFromBottom,
  toolbarPeekShouldActivate,
  toolbarPeekShouldHide,
  toolbarPeekShouldKeepOnLeave,
  TOOLBAR_PEEK_ACTIVATE_PX,
  TOOLBAR_PEEK_HIDE_PX,
} from "./toolbarPeekGeometry.ts";

test("toolbar peek activate band at viewport bottom", () => {
  const bottom = 800;
  assert.equal(toolbarPeekDistanceFromBottom(bottom - 10, bottom), 10);
  assert.equal(toolbarPeekShouldActivate(TOOLBAR_PEEK_ACTIVATE_PX), true);
  assert.equal(toolbarPeekShouldActivate(TOOLBAR_PEEK_ACTIVATE_PX + 1), false);
  assert.equal(toolbarPeekShouldHide(TOOLBAR_PEEK_HIDE_PX), false);
  assert.equal(toolbarPeekShouldHide(TOOLBAR_PEEK_HIDE_PX + 1), true);
});

test("cursor below the panel or window keeps peek visible", () => {
  assert.equal(toolbarPeekShouldActivate(-1), true);
  assert.equal(toolbarPeekShouldHide(-1), false);
  assert.equal(toolbarPeekShouldKeepOnLeave(0), true);
  assert.equal(toolbarPeekShouldKeepOnLeave(TOOLBAR_PEEK_HIDE_PX), true);
  assert.equal(toolbarPeekShouldKeepOnLeave(TOOLBAR_PEEK_HIDE_PX + 1), false);
});
