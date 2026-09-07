export async function api<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const { headers, ...requestOptions } = options;
  const response = await fetch(path, {
    ...requestOptions,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      body.message || "Операция не выполнена.",
    ) as Error & { code?: string };
    error.code = body.error;
    throw error;
  }
  return body;
}
export const post = <T = any>(
  path: string,
  body: unknown,
  headers?: HeadersInit,
) => api<T>(path, { method: "POST", body: JSON.stringify(body), headers });
