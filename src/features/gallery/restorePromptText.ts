import { localizeErrorCode } from '../../shared/i18n/index.ts';

export function restorePromptText(code: string): string {
    if (code === 'name_taken') {
        return localizeErrorCode('name_taken');
    }
    if (code === 'origin_missing') {
        return localizeErrorCode('origin_missing');
    }
    return localizeErrorCode(code);
}
