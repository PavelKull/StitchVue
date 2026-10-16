/** Полоса от низа окна: при входе курсора показывается нижняя панель (peek). */
export const TOOLBAR_PEEK_ACTIVATE_PX = 84;
/** Выше этой линии от низа панель скрывается (с задержкой), если курсор не на панели. */
export const TOOLBAR_PEEK_HIDE_PX = 148;

export function toolbarPeekDistanceFromBottom(clientY: number, viewportBottom = window.innerHeight): number {
  return viewportBottom - clientY;
}

/** Включает зону ниже окна (fromBottom < 0): курсор ушёл под панель — peek остаётся. */
export function toolbarPeekShouldActivate(fromBottom: number): boolean {
  return fromBottom <= TOOLBAR_PEEK_ACTIVATE_PX;
}

export function toolbarPeekShouldHide(fromBottom: number): boolean {
  return fromBottom > TOOLBAR_PEEK_HIDE_PX;
}

/** Не гасить peek при уходе через низ (gap под панелью / за край окна). */
export function toolbarPeekShouldKeepOnLeave(fromBottom: number): boolean {
  return !toolbarPeekShouldHide(fromBottom);
}
