export function resolveLocalServiceHost(host: string | null | undefined): string {
  const trimmed = host?.trim();
  if (!trimmed) {
    return '127.0.0.1';
  }

  const normalized = trimmed.toLowerCase();
  if (
    normalized === '0.0.0.0'
    || normalized === '::'
    || normalized === '[::]'
    || normalized === 'localhost'
    || normalized === '127.0.0.1'
    || normalized === '::1'
    || normalized === '[::1]'
    || normalized === 'tauri.localhost'
  ) {
    return '127.0.0.1';
  }

  return trimmed;
}
