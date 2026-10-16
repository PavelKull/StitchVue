import {
    DISK_SERVICE_FOLDER_LEAF,
    type ServiceRole,
} from '../../entities/folder/serviceFolder.ts';
import type { FolderShortcut } from '../../entities/folder/types.ts';
import { pathKey } from '../selection/selection.ts';
import { orderFoldersForDisplay } from './folderOrder.ts';

const SERVICE_FOLDER_LEAF = DISK_SERVICE_FOLDER_LEAF;

export function insertServiceFolder(
    folders: FolderShortcut[],
    folderPath: string,
    role: ServiceRole,
): FolderShortcut[] {
    const key = pathKey(folderPath);
    const serviceLeaf = SERVICE_FOLDER_LEAF[role];
    const without = folders.filter((folder) => {
        if (pathKey(folder.path) === key) {
            return false;
        }
        if (folder.serviceRole === role) {
            return false;
        }
        if (folder.kind === 'folder' && folder.name === serviceLeaf) {
            return false;
        }
        return true;
    });
    const name = folderPath.split(/[\\/]/).filter(Boolean).pop() ?? folderPath;
    const next = [
        ...without,
        { name, path: folderPath, kind: 'folder' as const, serviceRole: role },
    ];
    return orderFoldersForDisplay(next);
}
