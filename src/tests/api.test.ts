import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";

describe("api client", () => {
  afterEach(() => vi.restoreAllMocks());

  it("preserves JSON content type when custom headers are omitted", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));

    await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "admin", password: "admin" }),
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/login",
      expect.objectContaining({
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  it("preserves the server error code for workflow decisions", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "UNKNOWN_BARCODE",
          message: "Штрихкод не найден.",
        }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(api("/api/scan")).rejects.toMatchObject({
      code: "UNKNOWN_BARCODE",
      message: "Штрихкод не найден.",
    });
  });
});
