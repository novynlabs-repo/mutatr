import type { ApiResult } from "../types/contracts";

export function unwrap<T>(result: ApiResult<T>): T {
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.payload;
}
