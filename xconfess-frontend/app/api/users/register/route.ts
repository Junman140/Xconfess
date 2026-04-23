import { createApiErrorResponse } from "@/lib/apiErrorHandler";

const BASE_API_URL = process.env.BACKEND_API_URL;

export async function POST(request: Request) {
  if (!BASE_API_URL) {
    return createApiErrorResponse("BACKEND_API_URL is not set", { status: 503 });
  }

  const correlationId = request.headers.get("X-Correlation-ID") || "unknown";

  try {
    const body = await request.json();
    const backendUrl = `${BASE_API_URL}/users/register`;

    const response = await fetch(backendUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Correlation-ID": correlationId,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      return createApiErrorResponse(errData, {
        status: response.status,
        correlationId,
        route: "POST /api/users/register"
      });
    }

    const responseBody = await response.text();
    return new Response(responseBody, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    return createApiErrorResponse(error, {
      status: 500,
      correlationId,
      route: "POST /api/users/register"
    });
  }
}

