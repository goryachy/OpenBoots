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
    ) as Error & { code?: string; details?: any };
    error.code = body.error;
    error.details = body;
    throw error;
  }
  return body;
}
export const post = <T = any>(
  path: string,
  body: unknown,
  headers?: HeadersInit,
) => api<T>(path, { method: "POST", body: JSON.stringify(body), headers });

export const validateProductImage = (file?: File) => {
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('Добавьте фото в формате JPEG, PNG или WebP.');
  }
  if (file.size > 8 * 1024 * 1024) {
    throw new Error('Фото должно быть не больше 8 МБ.');
  }
};

export async function uploadProductPhoto<T = any>(productId: number, file: File): Promise<T> {
  validateProductImage(file);
  const form = new FormData();
  form.append("image", file, file.name || "product-photo.jpg");
  const response = await fetch(`/api/products/${productId}/photo`, {
    method: "POST",
    body: form,
    credentials: "include",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.message || "Не удалось сохранить фото.");
  }
  return body;
}

export const removeProductPhoto = <T = any>(productId: number) =>
  api<T>(`/api/products/${productId}/photo`, { method: "DELETE" });
