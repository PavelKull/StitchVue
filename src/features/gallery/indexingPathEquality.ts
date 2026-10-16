import { pathKey } from '../selection/selection.ts';

export function samePathList(
    left: readonly string[],
    right: readonly string[],
): boolean {
    return (
        left.length === right.length &&
        left.every(
            (item, index) => pathKey(item) === pathKey(right[index] ?? ''),
        )
    );
}

export function samePathSet(
    left: readonly string[],
    right: readonly string[],
): boolean {
    if (left.length !== right.length) {
        return false;
    }
    const known = new Set(left.map((item) => pathKey(item)));
    return right.every((item) => known.has(pathKey(item)));
}
