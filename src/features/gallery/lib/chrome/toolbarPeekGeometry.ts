import { scaleChromePx, UI_REF_WIDTH_PX } from './adaptiveUiScale.ts';

/** Полоса от низа окна: при входе курсора показывается нижняя панель (peek). */
const TOOLBAR_PEEK_ACTIVATE_BASE_PX = 84;
/** Выше этой линии от низа панель скрывается (с задержкой), если курсор не на панели. */
const TOOLBAR_PEEK_HIDE_BASE_PX = 148;

export const TOOLBAR_PEEK_ACTIVATE_PX = scaleChromePx(
  TOOLBAR_PEEK_ACTIVATE_BASE_PX,
  UI_REF_WIDTH_PX,
);
export const TOOLBAR_PEEK_HIDE_PX = scaleChromePx(
  TOOLBAR_PEEK_HIDE_BASE_PX,
  UI_REF_WIDTH_PX,
);

function toolbarPeekActivatePx(): number {
  return scaleChromePx(TOOLBAR_PEEK_ACTIVATE_BASE_PX);
}

function toolbarPeekHidePx(): number {
  return scaleChromePx(TOOLBAR_PEEK_HIDE_BASE_PX);
}

export function toolbarPeekDistanceFromBottom(clientY: number, viewportBottom = window.innerHeight): number {
  return viewportBottom - clientY;
}

/** Включает зону ниже окна (fromBottom < 0): курсор ушёл под панель — peek остаётся. */
export function toolbarPeekShouldActivate(fromBottom: number): boolean {
  return fromBottom <= toolbarPeekActivatePx();
}

export function toolbarPeekShouldHide(fromBottom: number): boolean {
  return fromBottom > toolbarPeekHidePx();
}

/** Не гасить peek при уходе через низ (gap под панелью / за край окна). */
export function toolbarPeekShouldKeepOnLeave(fromBottom: number): boolean {
  return !toolbarPeekShouldHide(fromBottom);
}
