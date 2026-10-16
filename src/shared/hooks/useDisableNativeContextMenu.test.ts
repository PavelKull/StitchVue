import assert from "node:assert/strict";
import test from "node:test";
import { suppressNativeContextMenu } from "./useDisableNativeContextMenu.ts";

test("suppressNativeContextMenu only prevents the default action", () => {
  let prevented = false;
  let stopped = false;
  const event = {
    preventDefault() {
      prevented = true;
    },
    stopPropagation() {
      stopped = true;
    },
    stopImmediatePropagation() {
      stopped = true;
    },
  } as Event;

  suppressNativeContextMenu(event);

  assert.equal(prevented, true);
  assert.equal(stopped, false);
});
