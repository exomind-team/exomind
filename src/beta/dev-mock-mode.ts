/** The in-memory profile route must never be enabled in a production build. */
export function isBetaMockProfileRequested(search: string, development: boolean): boolean {
  return development && new URLSearchParams(search).get('mock') === '1';
}
