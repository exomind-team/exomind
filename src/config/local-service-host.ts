export function resolveLocalServiceHost(host: string | null | undefined): string {
  const trimmed = host?.trim();
  if (!trimmed) {
    return 'localhost';
  }

  const normalized = trimmed.toLowerCase();
  if (
    normalized === '0.0.0.0'
    || normalized === '::'
    || normalized === '[::]'
    || normalized === 'tauri.localhost'
  ) {
    return '127.0.0.1';
  }

  return trimmed;
}
