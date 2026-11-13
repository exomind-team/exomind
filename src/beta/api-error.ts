export class BetaApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 0) { super(message); }
}
