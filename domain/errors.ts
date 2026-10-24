/** Normalized error codes (PRD §99). */
export type ErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_FAILED"
  | "INVALID_STATE_TRANSITION"
  | "QUALIFICATION_REQUIRED"
  | "PAYMENT_REQUIRED"
  | "APPROVAL_REQUIRED"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_AUTH_REQUIRED"
  | "RATE_LIMITED"
  | "PROCESSING_FAILED"
  | "INTERNAL_ERROR";

const HTTP_STATUS: Record<ErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 422,
  INVALID_STATE_TRANSITION: 409,
  QUALIFICATION_REQUIRED: 409,
  PAYMENT_REQUIRED: 402,
  APPROVAL_REQUIRED: 409,
  PROVIDER_UNAVAILABLE: 503,
  PROVIDER_AUTH_REQUIRED: 424,
  RATE_LIMITED: 429,
  PROCESSING_FAILED: 500,
  INTERNAL_ERROR: 500,
};

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
  get httpStatus() {
    return HTTP_STATUS[this.code];
  }
}

/** Maps a transition_launch() database error ("CODE: message") to an AppError. */
export function fromDbError(message: string): AppError {
  const match = /^(\w+):\s*(.*)$/.exec(message);
  // The database uses CONFLICT for "already decided / locked"; §99 has no such code, so it maps to 409.
  const raw = match?.[1] === "CONFLICT" ? "INVALID_STATE_TRANSITION" : match?.[1];
  const code = raw as ErrorCode | undefined;
  if (code && code in HTTP_STATUS) return new AppError(code, match![2]);
  return new AppError("INTERNAL_ERROR", "Unexpected database error");
}
