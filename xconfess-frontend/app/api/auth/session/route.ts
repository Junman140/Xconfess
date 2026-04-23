import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getApiBaseUrl } from "@/app/lib/config";
import { createApiErrorResponse } from "@/lib/apiErrorHandler";

const API_URL = getApiBaseUrl();
const SESSION_COOKIE_NAME = "xconfess_session";

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const email = typeof body?.email === "string" ? body.email : undefined;
        const password = typeof body?.password === "string" ? body.password : undefined;

        if (!email || !password) {
            return createApiErrorResponse("Email and password are required", { status: 400 });
        }

        const response = await fetch(`${API_URL}/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password }),
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ message: "Login failed" }));
            return createApiErrorResponse(error, {
                status: response.status,
                fallbackMessage: "Login failed",
                route: "POST /api/auth/session"
            });
        }

        const data = await response.json();
        const token = data.access_token;

        // ✅ Await cookies() here
        const cookieStore = await cookies();
        cookieStore.set(SESSION_COOKIE_NAME, token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            maxAge: 60 * 60 * 24 * 7, // 1 week
            path: "/",
        });

        return NextResponse.json({ user: data.user });
    } catch (error) {
        return createApiErrorResponse(error, {
            status: 500,
            fallbackMessage: "An unexpected error occurred during login",
            route: "POST /api/auth/session"
        });
    }
}

export async function GET() {
    const cookieStore = await cookies(); // ✅ Await cookies
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

    if (!token) {
        return createApiErrorResponse("Not authenticated", { status: 401 });
    }

    try {
        // Bridges the session to the backend to get current user info
        const response = await fetch(`${API_URL}/auth/profile`, {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });

        if (!response.ok) {
            cookieStore.delete(SESSION_COOKIE_NAME);
            return createApiErrorResponse("Session expired", { status: 401 });
        }

        const user = await response.json();
        return NextResponse.json({ authenticated: true, user });
    } catch (error) {
        return createApiErrorResponse(error, {
            status: 500,
            route: "GET /api/auth/session"
        });
    }
}

export async function DELETE() {
    const cookieStore = await cookies(); // ✅ Await cookies
    cookieStore.delete(SESSION_COOKIE_NAME);
    return NextResponse.json({ success: true });
}

