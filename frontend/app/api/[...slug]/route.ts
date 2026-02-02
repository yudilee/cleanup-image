import { NextRequest, NextResponse } from "next/server";

// Determine backend URL. 
// In Docker, it should be 'http://backend:8000'.
// Locally, it should be 'http://127.0.0.1:8000'.
const API_URL = process.env.API_URL || "http://127.0.0.1:8000";

async function proxy(req: NextRequest, { params }: { params: Promise<{ slug: string[] }> }) {
    try {
        const resolvedParams = await params;
        const path = resolvedParams.slug.join("/");
        const queryString = req.nextUrl.search;
        const url = `${API_URL}/${path}${queryString}`;

        // console.log(`Proxying ${req.method} ${req.nextUrl.pathname} -> ${url}`);

        const headers = new Headers(req.headers);
        headers.delete("host");
        headers.delete("connection");
        // headers.delete("content-length"); // Fetch usually handles this, but keeping it explicit can prevent mismatch

        const body = req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined;

        const res = await fetch(url, {
            method: req.method,
            headers,
            body,
            // @ts-ignore
            duplex: "half",
            cache: "no-store",
        });

        return new NextResponse(res.body, {
            status: res.status,
            statusText: res.statusText,
            headers: res.headers,
        });
    } catch (error: any) {
        console.error("Proxy error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as DELETE, proxy as PATCH };
