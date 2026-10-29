import test from 'node:test';
import assert from 'node:assert/strict';
import {
  UI_REF_WIDTH_PX,
  UI_SCALE_MIN,
  scaleChromePx,
  uiScaleForViewportWidth,
} from './adaptiveUiScale.ts';

test('uiScaleForViewportWidth эталон и clamp', () => {
  assert.equal(uiScaleForViewportWidth(UI_REF_WIDTH_PX), 1);
  assert.equal(uiScaleForViewportWidth(2560), 1);
  assert.equal(uiScaleForViewportWidth(960), UI_SCALE_MIN);
  assert.equal(uiScaleForViewportWidth(100), UI_SCALE_MIN);
});

test('scaleChromePx при эталонной ширине', () => {
  assert.equal(scaleChromePx(32, UI_REF_WIDTH_PX), 32);
  assert.equal(scaleChromePx(16, 1280), Math.round(16 * UI_SCALE_MIN));
});
