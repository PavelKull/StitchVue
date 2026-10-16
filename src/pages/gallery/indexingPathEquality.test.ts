import assert from 'node:assert/strict';
import { test } from 'node:test';
import { samePathList, samePathSet } from './indexingPathEquality.ts';

const FAVORITES_PLAIN = 'C:\\Users\\Pavel\\Photos\\Избранное';
const FAVORITES_VERBATIM = '\\\\?\\C:\\Users\\Pavel\\Photos\\Избранное';

type Case = {
    fn: 'list' | 'set';
    left: readonly string[];
    right: readonly string[];
    expected: boolean;
};

const cases: Case[] = [
    { fn: 'list', left: [], right: [], expected: true },
    { fn: 'list', left: [], right: ['a'], expected: false },
    { fn: 'list', left: ['a'], right: ['a'], expected: true },
    { fn: 'list', left: ['a', 'b'], right: ['b', 'a'], expected: false },
    { fn: 'list', left: ['a'], right: ['a', 'b'], expected: false },
    { fn: 'set', left: [], right: [], expected: true },
    { fn: 'set', left: ['a', 'b'], right: ['b', 'a'], expected: true },
    { fn: 'set', left: ['a'], right: ['b'], expected: false },
    { fn: 'set', left: ['a', 'a'], right: ['a'], expected: false },
    { fn: 'set', left: ['a', 'a'], right: ['a', 'a'], expected: true },
    {
        fn: 'list',
        left: [FAVORITES_PLAIN],
        right: [FAVORITES_VERBATIM],
        expected: true,
    },
    {
        fn: 'set',
        left: [FAVORITES_PLAIN, FAVORITES_VERBATIM],
        right: [FAVORITES_VERBATIM, FAVORITES_PLAIN],
        expected: true,
    },
];

for (const { fn, left, right, expected } of cases) {
    const name = fn === 'list' ? 'samePathList' : 'samePathSet';
    test(`${name}(${JSON.stringify(left)} vs ${JSON.stringify(right)}) → ${expected}`, () => {
        const actual =
            fn === 'list'
                ? samePathList(left, right)
                : samePathSet(left, right);
        assert.equal(actual, expected);
    });
}
