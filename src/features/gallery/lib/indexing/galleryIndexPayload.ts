import type { ImageFile } from '../../../../entities/image/types.ts';

export function indexPayload(files: ImageFile[]) {
    return files.map((file) => ({
        path: file.path,
        size: file.size,
        modifiedAt: file.modifiedAt,
    }));
}
