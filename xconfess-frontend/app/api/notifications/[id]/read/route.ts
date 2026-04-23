import { NextRequest, NextResponse } from "next/server";
import { createApiErrorResponse } from "@/lib/apiErrorHandler";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const token = request.headers.get("authorization")?.replace("Bearer ", "");

    const response = await fetch(
      `${process.env.BACKEND_URL}/notifications/${id}/read`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      return createApiErrorResponse(errData, {
        status: response.status,
        fallbackMessage: "Failed to mark notification as read",
        route: "PATCH /api/notifications/[id]/read"
      });
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    return createApiErrorResponse(error, {
      status: 500,
      route: "PATCH /api/notifications/[id]/read"
    });
  }
}

