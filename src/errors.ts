export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code = "api_error",
  ) {
    super(message);
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}
