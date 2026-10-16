import { directoryTitle } from '../../entities/folder/folderDisplayName.ts';
import type { DirectoryView } from '../../entities/folder/types.ts';

export function createEmptyView(title: string): DirectoryView {
    return {
        title,
        path: null,
        parent: null,
        folders: [],
        images: [],
        serviceRole: null,
    };
}

export function withLocalizedDirectory(view: DirectoryView): DirectoryView {
    return { ...view, title: directoryTitle(view) };
}
