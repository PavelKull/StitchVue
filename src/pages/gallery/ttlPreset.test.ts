import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ttlPreset } from './ttlPreset.ts';

const THREE_D = 3 * 24 * 60 * 60;
const SEVEN_D = 7 * 24 * 60 * 60;

const cases: { secs: number | null | undefined; expected: string }[] = [
    { secs: null, expected: 'never' },
    { secs: undefined, expected: 'never' },
    { secs: 0, expected: '3' },
    { secs: -1, expected: '3' },
    { secs: THREE_D - 1, expected: '3' },
    { secs: THREE_D, expected: '3' },
    { secs: THREE_D + 1, expected: '7' },
    { secs: SEVEN_D, expected: '7' },
    { secs: SEVEN_D + 1, expected: '30' },
    { secs: Number.NaN, expected: '30' },
];

for (const { secs, expected } of cases) {
    test(`ttlPreset(${String(secs)}) → ${expected}`, () => {
        assert.equal(ttlPreset(secs), expected);
    });
}
