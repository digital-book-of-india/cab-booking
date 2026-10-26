/**
 * Type-safe error message extraction utility.
 * Eliminates `any` casts in catch blocks and mutation error callbacks.
 */
export function getErrorMessage(err: unknown, fallback = 'An error occurred'): string {
  if (!err) return fallback;

  if (typeof err === 'string') return err;

  if (typeof err === 'object') {
    const errorObj = err as Record<string, unknown>;

    // Axios error response envelope: { response: { data: { error: { message } } } }
    if (errorObj['response'] && typeof errorObj['response'] === 'object') {
      const resp = errorObj['response'] as Record<string, unknown>;
      if (resp['data'] && typeof resp['data'] === 'object') {
        const data = resp['data'] as Record<string, unknown>;
        if (data['error'] && typeof data['error'] === 'object') {
          const innerError = data['error'] as Record<string, unknown>;
          if (typeof innerError['message'] === 'string') {
            return innerError['message'];
          }
        }
        if (typeof data['message'] === 'string') {
          return data['message'];
        }
      }
    }

    // Direct backend error envelope: { error: { message } }
    if (errorObj['error'] && typeof errorObj['error'] === 'object') {
      const inner = errorObj['error'] as Record<string, unknown>;
      if (typeof inner['message'] === 'string') {
        return inner['message'];
      }
    }

    // Standard Error: { message }
    if (typeof errorObj['message'] === 'string') {
      return errorObj['message'];
    }
  }

  return fallback;
}
