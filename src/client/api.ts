// API access. The app talks to the server through `api`; the preview build swaps in a demo implementation.

export class ApiError extends Error {
  constructor(public status: number, message: string, public code = 'error') {
    super(message);
  }
}

export interface Api {
  request<T = any>(method: string, path: string, body?: unknown): Promise<T>;
  readonly demo: boolean;
}

export class HttpApi implements Api {
  readonly demo = false;
  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let r: Response;
    try {
      r = await fetch(path, {
        method,
        credentials: 'same-origin',
        headers: body !== undefined ? { 'Content-Type': 'application/json', 'X-Kyvo-Request': '1' } : { 'X-Kyvo-Request': '1' },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError(0, 'You appear to be offline. Check your connection and try again.', 'offline');
    }
    const data = r.headers.get('content-type')?.includes('application/json') ? await r.json() : null;
    if (!r.ok) throw new ApiError(r.status, data?.error ?? 'Something went wrong.', data?.code ?? 'error');
    return data as T;
  }
}

let current: Api = new HttpApi();
export const setApi = (a: Api) => (current = a);
export const api = {
  get demo() {
    return current.demo;
  },
  get: <T = any>(p: string) => current.request<T>('GET', p),
  post: <T = any>(p: string, b: unknown = {}) => current.request<T>('POST', p, b),
  put: <T = any>(p: string, b: unknown = {}) => current.request<T>('PUT', p, b),
  patch: <T = any>(p: string, b: unknown = {}) => current.request<T>('PATCH', p, b),
  del: <T = any>(p: string) => current.request<T>('DELETE', p),
};
