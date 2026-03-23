import type { ZodError, ZodType } from 'zod';

function formatZodError(error: ZodError): string {
  const issues = error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    return `${path}: ${issue.message}`;
  });
  return issues.length > 0 ? issues.join('; ') : 'Invalid input';
}

export function parseToolArgs<T>(schema: ZodType<T>, args: unknown): T {
  const parsed = schema.safeParse(args);
  if (!parsed.success) {
    throw new Error(formatZodError(parsed.error));
  }
  return parsed.data;
}

