/**
 * @file HTTP client of the editor API (`/api/editor`). Sends the session's
 * CSRF token in the `X-CSRF-Token` header and turns error responses into
 * `EditorApiError` carrying the translation key returned by the server.
 */

/** Error returned by the editor API. */
export class EditorApiError extends Error {
  constructor(
    readonly key: string,
    readonly params: Record<string, string | number> = {},
    readonly status = 0,
  ) {
    super(key);
  }
}

/** Thin wrapper around `fetch` for the editor API. */
export class EditorApi {
  /** @param csrf - Session CSRF token. */
  constructor(private readonly csrf: string) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`/api/editor${path}`, {
        method,
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'x-csrf-token': this.csrf },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new EditorApiError('error.editor.network');
    }
    const data = (await res.json().catch(() => ({}))) as { error?: string; params?: Record<string, string | number> };
    if (!res.ok) throw new EditorApiError(data.error ?? 'error.http.server', data.params ?? {}, res.status);
    return data as T;
  }

  /**
   * Sends a file as the raw request body (resource uploads, project import).
   * @param path - API path (with query string).
   * @param file - File or blob.
   */
  async upload<T>(path: string, file: Blob): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`/api/editor${path}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/octet-stream', 'x-csrf-token': this.csrf },
        body: file,
      });
    } catch {
      throw new EditorApiError('error.editor.network');
    }
    const data = (await res.json().catch(() => ({}))) as { error?: string; params?: Record<string, string | number> };
    if (!res.ok) throw new EditorApiError(data.error ?? (res.status === 413 ? 'error.resources.too_large' : 'error.http.server'), data.params ?? {}, res.status);
    return data as T;
  }

  /** GET request. */
  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  /** POST request. */
  post<T>(path: string, body: unknown = {}): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  /** PUT request. */
  put<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('PUT', path, body);
  }

  /** PATCH request. */
  patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('PATCH', path, body);
  }

  /** DELETE request. */
  delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }
}
