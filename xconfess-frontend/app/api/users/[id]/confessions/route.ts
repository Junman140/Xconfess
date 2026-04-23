import { createApiErrorResponse } from "@/lib/apiErrorHandler";

const BASE_API_URL = process.env.BACKEND_API_URL;

export async function GET(request: Request, { params }: { params: { id: string } }) {
  if (!BASE_API_URL) {
    return createApiErrorResponse("BACKEND_API_URL is not set", { status: 503 });
  }

  const correlationId = request.headers.get("X-Correlation-ID") || "unknown";

  try {
    const { id } = params;
    const backendUrl = `${BASE_API_URL}/users/${id}/confessions`;

    const response = await fetch(backendUrl, {
      method: "GET",
      headers: {
        "X-Correlation-ID": correlationId,
      },
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      return createApiErrorResponse(errData, {
        status: response.status,
        correlationId,
        route: "GET /api/users/[id]/confessions"
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
      route: "GET /api/users/[id]/confessions"
    });
  }
}

