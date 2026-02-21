export function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

export function buildRemoteDbUrl(baseUrl: string, username: string): string {
  const user = username.trim();
  if (!user) {
    throw new Error('username is required');
  }

  return `${normalizeBaseUrl(baseUrl)}/${encodeURIComponent(user)}`;
}

