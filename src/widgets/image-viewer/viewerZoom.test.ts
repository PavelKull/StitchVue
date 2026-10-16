import assert from "node:assert/strict";
import test from "node:test";
import { VIEWER_MAX_EDGE, viewerNeededEdge } from "./viewerZoom.ts";

test("viewer edge follows the frame and stays inside the safety cap", () => {
  assert.equal(viewerNeededEdge(800, 600, 1), 800);
  assert.equal(viewerNeededEdge(800, 600, 2), 1600);
  assert.equal(viewerNeededEdge(100, 80, 1), 256);
  assert.equal(viewerNeededEdge(9000, 4000, 2), VIEWER_MAX_EDGE);
});
