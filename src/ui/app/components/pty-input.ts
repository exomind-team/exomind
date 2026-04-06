const PTY_ARROW_SEQUENCE_BY_KEY: Record<string, string> = {
  ArrowUp: 'A',
  ArrowDown: 'B',
  ArrowRight: 'C',
  ArrowLeft: 'D',
};

export interface PtyInputTarget {
  rtBaseUrl: string;
  ptyId: string;
  authToken?: string;
}

function encodeTextAsBase64(text: string): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  let binary = '';
  bytes.forEach((value) => {
    binary += String.fromCharCode(value);
  });
  return btoa(binary);
}

function buildHeaders(authToken?: string): HeadersInit {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (authToken?.trim()) {
    headers.Authorization = `Bearer ${authToken.trim()}`;
  }
  return headers;
}

function resolveArrowModifierCode(shortcut: string): number | null {
  if (shortcut.startsWith('Alt+Shift+')) {
    return 4;
  }
  if (shortcut.startsWith('Alt+')) {
    return 3;
  }
  return null;
}

export function encodeShortcutForPty(shortcut: string): string | null {
  const modifierCode = resolveArrowModifierCode(shortcut);
  const key = shortcut.split('+').pop() ?? '';

  if (key in PTY_ARROW_SEQUENCE_BY_KEY && modifierCode != null) {
    return `\u001b[1;${modifierCode}${PTY_ARROW_SEQUENCE_BY_KEY[key]}`;
  }

  if (key === 'Enter' && modifierCode != null) {
    return '\u001b\r';
  }

  if (key === 'Backspace' && modifierCode != null) {
    return '\u001b\u007f';
  }

  if (/^[A-Z]$/.test(key) && shortcut.startsWith('Alt+')) {
    const typed = shortcut.startsWith('Alt+Shift+') ? key : key.toLowerCase();
    return `\u001b${typed}`;
  }

  return null;
}

export async function sendPtyTextInput(
  target: PtyInputTarget,
  text: string,
): Promise<Response> {
  return fetch(`${target.rtBaseUrl}/pty/${encodeURIComponent(target.ptyId)}/input`, {
    method: 'POST',
    headers: buildHeaders(target.authToken),
    body: JSON.stringify({
      data: encodeTextAsBase64(text),
    }),
  });
}

export async function sendPtyShortcutInput(
  target: PtyInputTarget,
  shortcut: string,
): Promise<boolean> {
  const text = encodeShortcutForPty(shortcut);
  if (!text) {
    return false;
  }

  const response = await sendPtyTextInput(target, text);
  return response.ok;
}
