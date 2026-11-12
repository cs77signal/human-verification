
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const response = await fetch(
      "https://cs77-human-counter.vercel.app/api/stats",
      {
        cache: "no-store",
      }
    );

    if (!response.ok) {
      throw new Error("Counter API unavailable");
    }

    const data = await response.json();

    if (data.success !== true || !data.stats) {
      throw new Error("Invalid counter response");
    }

    return NextResponse.json(
      {
        success: true,
        stats: data.stats,
        updatedAt: data.updatedAt ?? null,
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      }
    );
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: "Statistics unavailable",
      },
      { status: 503 }
    );
  }
}
