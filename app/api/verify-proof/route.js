
import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";

const RP_ID = "rp_6e6a7b45f63d731d";
const ACTION = "human-verification";

export async function POST(request) {
  try {
    const proof = await request.json();

    if (
      !proof ||
      proof.action !== ACTION ||
      !Array.isArray(proof.responses)
    ) {
      return NextResponse.json(
        { error: "Invalid verification request" },
        { status: 400 }
      );
    }

    const worldResponse = await fetch(
      `https://developer.world.org/api/v4/verify/${RP_ID}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(proof),
        cache: "no-store",
      }
    );

    const verification = await worldResponse.json();

    if (
      !worldResponse.ok ||
      verification?.success !== true ||
      verification?.action !== ACTION ||
      typeof verification?.nullifier !== "string" ||
      verification.nullifier.length === 0
    ) {
      return NextResponse.json(
        { verified: false, error: "Verification failed" },
        { status: 400 }
      );
    }

    const redis = new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });

    const key =
      `worldid:nullifier:${ACTION}:${encodeURIComponent(
        verification.nullifier
      )}`;

    const stored = await redis.set(key, "1", { nx: true });

    if (stored !== "OK") {
      return NextResponse.json(
        {
          verified: false,
          error: "This proof has already been used",
        },
        { status: 409 }
      );
    }

    return NextResponse.json({ verified: true });

  } catch {
    return NextResponse.json(
      { error: "Verification service unavailable" },
      { status: 500 }
    );
  }
}
