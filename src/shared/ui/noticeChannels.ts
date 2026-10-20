import type { OperationNotice } from "../../features/selection/lib/fileOperation.ts";

/**
 * C-002: единая шкала «куда класть сообщение».
 * Новый кейс — сначала выбрать канал; не добавлять четвёртый ad-hoc strip.
 */
export type NoticeChannel = "toast" | "modal" | "empty";

/** Короткий результат / undo / boot — `OperationNoticeView` + `fileNotice` в GalleryPage. */
export const TOAST_CHANNEL_HOST = "OperationNoticeView";

/**
 * Решение с кнопками — `useAnimatedModal` + backdrop в виджете диалога.
 * Общий shell визуально совпадает (modal-motion SCSS); код пока per-dialog.
 */
export const MODAL_CHANNEL_PATTERN = "AnimatedModalFrame + useAnimatedModal";

/** Центр галереи — `galleryEmptyCopy` / C-001 `emptyGallery`. */
export const EMPTY_CHANNEL_HOST = "galleryLayer.emptyGallery";

export type NoticeChannelRoute = {
  channel: NoticeChannel;
  host: string;
  examples: string[];
};

/** Карта для ревью и ui-catalog; не runtime-router. */
export const NOTICE_CHANNEL_MAP: NoticeChannelRoute[] = [
  {
    channel: "toast",
    host: TOAST_CHANNEL_HOST,
    examples: [
      "copy/move/delete summary",
      "favorites partial / needs review",
      "boot: last folder unavailable (was bootNotice)",
    ],
  },
  {
    channel: "modal",
    host: MODAL_CHANNEL_PATTERN,
    examples: [
      "SettingsDialog",
      "ConfirmMoveDialog",
      "RenameFolderDialog / TrashFolderDelete",
      "FavoriteTrashUnfavorite / FavoriteMissingOrigin",
      "PhotoProperties / SupportReminder",
      "UpdateDialog (C-003, mock)",
    ],
  },
  {
    channel: "empty",
    host: EMPTY_CHANNEL_HOST,
    examples: [
      "loading / open folder",
      "empty album / unsupported formats",
      "empty favorites / trash / subfolders-only",
      "openError (live error text in description)",
    ],
  },
];

/** Boot path notices → toast channel (same widget as file ops). */
export function bootToastNotice(text: string): OperationNotice {
  return {
    tone: "ok",
    text,
    details: [],
  };
}
