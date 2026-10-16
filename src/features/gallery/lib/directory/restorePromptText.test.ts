import assert from 'node:assert/strict';
import { test } from 'node:test';
import { restorePromptText } from './restorePromptText.ts';

test('restorePromptText maps known restore codes', async () => {
    const { initI18n } = await import('../../../../shared/i18n/i18n.ts');
    const { localizeErrorCode } = await import('../../../../shared/i18n/index.ts');
    await initI18n();
    assert.equal(restorePromptText('name_taken'), localizeErrorCode('name_taken'));
    assert.equal(
        restorePromptText('origin_missing'),
        localizeErrorCode('origin_missing'),
    );
});

test('restorePromptText passes through other codes', async () => {
    const { initI18n } = await import('../../../../shared/i18n/i18n.ts');
    const { localizeErrorCode } = await import('../../../../shared/i18n/index.ts');
    await initI18n();
    assert.equal(restorePromptText('locked'), localizeErrorCode('locked'));
});
