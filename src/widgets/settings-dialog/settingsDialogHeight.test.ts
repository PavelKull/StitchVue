import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scss = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'SettingsDialog.module.scss'),
    'utf8',
);

const SHELL_HEIGHT = 'var(--settings-dialog-cap)';
const SHELL_CAP_DECL =
    'min(760px, 78vh, calc(100dvh - 32px))';

function ruleBody(source: string, selector: string): string {
    const needle = `${selector} {`;
    const start = source.indexOf(needle);
    assert.ok(start >= 0, `не найден селектор ${selector}`);
    const open = source.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < source.length; i += 1) {
        const ch = source[i];
        if (ch === '{') depth += 1;
        else if (ch === '}') {
            depth -= 1;
            if (depth === 0) return source.slice(open + 1, i);
        }
    }
    throw new Error(`незакрытый блок ${selector}`);
}

function topLevelText(body: string): string {
    let depth = 0;
    let out = '';
    for (const ch of body) {
        if (ch === '{') depth += 1;
        else if (ch === '}') depth = Math.max(0, depth - 1);
        else if (depth === 0) out += ch;
    }
    return out;
}

function declaration(body: string, property: string): string | null {
    const match = topLevelText(body).match(
        new RegExp(`(?:^|\\n)\\s*${property}\\s*:\\s*([^;]+);`),
    );
    return match ? match[1].trim() : null;
}

test('.dialog shell height is pinned to max-height cap, not auto', () => {
    const dialog = ruleBody(scss, '.dialog');
    const capVar = declaration(dialog, '--settings-dialog-cap');
    const height = declaration(dialog, 'height');
    const maxHeight = declaration(dialog, 'max-height');
    assert.ok(height, 'у .dialog должна быть height');
    assert.notEqual(height, 'auto');
    assert.doesNotMatch(topLevelText(dialog), /height\s*:\s*auto/);
    assert.equal(capVar, SHELL_CAP_DECL);
    assert.equal(height, SHELL_HEIGHT);
    assert.equal(maxHeight, SHELL_HEIGHT);
    assert.equal(height, maxHeight);
});

test('.panelPane[data-active="true"] keeps overflow-y auto', () => {
    const pane = ruleBody(scss, '.panelPane');
    const active = ruleBody(pane, '&[data-active="true"]');
    assert.match(active, /overflow-y:\s*auto/);
});
