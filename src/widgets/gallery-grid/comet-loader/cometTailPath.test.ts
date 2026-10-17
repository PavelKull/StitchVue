import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_LOADING_SWEEP,
  TWO_PI,
  buildCometTailPath,
  cometHeadPoint,
  cometWidth,
  stepToward,
  sweepFromRatio,
} from "./cometTailPath.ts";

test("width profile is thin at the far end and thick at the head", () => {
  const far = cometWidth(0, 0.4, 3.1);
  const mid = cometWidth(0.5, 0.4, 3.1);
  const head = cometWidth(1, 0.4, 3.1);
  assert.equal(far, 0.4);
  assert.equal(head, 3.1);
  assert.ok(mid > far && mid < head);
  assert.ok(mid < 0.4 + (3.1 - 0.4) * 0.5);
});

test("loading sweep never closes the ring before ratio 1 mapped through finish", () => {
  assert.equal(sweepFromRatio(null), sweepFromRatio(null));
  assert.ok(sweepFromRatio(0)! < sweepFromRatio(0.25)!);
  assert.ok(sweepFromRatio(0.99)! < TWO_PI);
  assert.ok(Math.abs(sweepFromRatio(1) - MAX_LOADING_SWEEP) < 1e-12);
  assert.ok(MAX_LOADING_SWEEP < TWO_PI);
});

test("open tail path is a closed ribbon and closed sweep is an annulus", () => {
  const open = buildCometTailPath({
    sweepRad: Math.PI,
    minWidth: 0.4,
    maxWidth: 3.1,
  });
  assert.match(open, /^M /);
  assert.match(open, /Z$/);
  assert.ok(!open.includes("A 26"));

  const closed = buildCometTailPath({
    sweepRad: TWO_PI,
    minWidth: 0.4,
    maxWidth: 3.1,
  });
  assert.ok(closed.includes("Z"));
  assert.ok(closed.split("Z").length >= 3);
  assert.notEqual(open, closed);
});

test("head sits at the top of the ring", () => {
  const head = cometHeadPoint(28, 28, 24.5);
  assert.equal(head.x, 28);
  assert.ok(Math.abs(head.y - (28 - 24.5)) < 1e-9);
});

test("interpolation approaches the target without overshooting a step", () => {
  const next = stepToward(0.1, 0.8, 16, 180);
  assert.ok(next > 0.1 && next < 0.8);
  assert.equal(stepToward(0.2, 0.9, 16, 0), 0.9);
});
