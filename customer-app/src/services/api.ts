import { API_CONFIG } from "../constants/config";

export class ApiError extends Error {
  constructor(message: string, public status: number, public data?: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

type ApiOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
  token?: string | null;
};

async function parseResponse(response: Response): Promise<unknown> {
  if (response.status === 204) {
    return null;
  }

  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return response.json();
  }

  return response.text();
}

export async function apiRequest<T>(
  path: string,
  options: ApiOptions = {}
): Promise<T> {
  const baseURL = API_CONFIG.baseURL;

  if (!baseURL) {
    throw new Error("Missing EXPO_PUBLIC_API_URL in customer-app/.env");
  }

  const { token, headers, body, signal, ...requestOptions } = options;

  const controller = new AbortController();
  let timedOut = false;

  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, API_CONFIG.timeout);

  const abortFromCaller = () => controller.abort();

  if (signal?.aborted) {
    controller.abort();
  } else {
    signal?.addEventListener("abort", abortFromCaller);
  }

  try {
    const response = await fetch(`${baseURL}/${path.replace(/^\/+/, "")}`, {
      ...requestOptions,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      ...(body !== undefined
        ? {
            body: typeof body === "string" ? body : JSON.stringify(body),
          }
        : {}),
    });

    const data = await parseResponse(response);

    if (!response.ok) {
      const message =
        typeof data === "object" &&
        data !== null &&
        "message" in data &&
        typeof data.message === "string"
          ? data.message
          : `Request failed (${response.status})`;

      throw new ApiError(message, response.status, data);
    }

    return data as T;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    if (timedOut) {
      throw new Error("Request timed out. Please try again.");
    }

    if (error instanceof Error && error.name === "AbortError") {
      throw error;
    }

    throw new Error(
      "Unable to connect to the server. Check your connection and try again."
    );
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}
