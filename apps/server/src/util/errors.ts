export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code)
    this.name = 'ApiError'
  }
}

export const errors = {
  badRequest: (code: string, message?: string) => new ApiError(400, code, message),
  unauthorized: (code = 'UNAUTHORIZED', message?: string) => new ApiError(401, code, message),
  forbidden: (code = 'FORBIDDEN', message?: string) => new ApiError(403, code, message),
  notFound: (code = 'NOT_FOUND', message?: string) => new ApiError(404, code, message),
  conflict: (code: string, message?: string) => new ApiError(409, code, message),
  tooMany: (message?: string) => new ApiError(429, 'RATE_LIMITED', message),
  internal: (message?: string) => new ApiError(500, 'INTERNAL', message),
}
