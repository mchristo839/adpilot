import type { MetaError } from "./types.js";

export class GraphApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly meta: MetaError | undefined,
    public readonly path: string,
  ) {
    super(`Graph API ${status} on ${path}: ${meta?.error_user_msg ?? meta?.message ?? "unknown error"} (code ${meta?.code ?? "?"}${meta?.error_subcode ? `/${meta.error_subcode}` : ""})`);
    this.name = "GraphApiError";
  }

  /** Rate limit and transient codes worth retrying. */
  get retryable(): boolean {
    const c = this.meta?.code;
    if (this.status >= 500) return true;
    // 4 app-level throttling, 17 user-level, 32 page-level, 613 custom rate limit, 80004 ads insights throttling, 2 service temporarily unavailable, 1 unknown
    return c === 1 || c === 2 || c === 4 || c === 17 || c === 32 || c === 613 || c === 80004 || c === 80000;
  }
}

export class DryRunError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "DryRunError";
  }
}
