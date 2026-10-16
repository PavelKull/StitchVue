/** Подставляет `{{key}}` в шаблон строки. */

export function t(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const value = vars[key];
    return value === undefined ? `{{${key}}}` : String(value);
  });
}
