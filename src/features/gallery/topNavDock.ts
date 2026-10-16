/** True while the pointer is over the top navigation dock (full bar width). */
export function pointerOverTopNavDock(clientX: number, clientY: number): boolean {
  const dock = document.querySelector<HTMLElement>("[data-top-nav-dock]");
  if (!dock) {
    return false;
  }
  const rect = dock.getBoundingClientRect();
  return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
}
