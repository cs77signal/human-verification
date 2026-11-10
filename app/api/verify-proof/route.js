
import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";

const RP_ID = "rp_6e6a7b45f63d731d";
const ACTION = "human-verification";
const EXPECTED_ENVIRONMENT = "production";

export async function POST(request) {
  try {
    const { rp_id, idkitResponse } = await request.json();

    if (
      rp_id !== RP_ID ||
      !idkitResponse ||
      idkitResponse.action !== ACTION ||
      idkitResponse.environment !== EXPECTED_ENVIRONMENT ||
      !Array.isArray(idkitResponse.responses) ||
      idkitResponse.responses.length !== 1
    ) {
      return NextResponse.json(
        { verified: false, error: "Invalid verification request" },
        { status: 400 }
      );
    }

    const nullifier = idkitResponse.responses[0]?.nullifier;

    if (
      typeof nullifier !== "string" ||
      !/^0x[0-9a-fA-F]+$/.test(nullifier)
    ) {
      return NextResponse.json(
        { verified: false, error: "Invalid proof" },
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
        body: JSON.stringify({
          ...idkitResponse,
          environment: EXPECTED_ENVIRONMENT,
        }),
        cache: "no-store",
      }
    );

    if (!worldResponse.ok) {
      return NextResponse.json(
        { verified: false, error: "Verification failed" },
        { status: 400 }
      );
    }

    const verification = await worldResponse.json();

    if (
      verification?.success !== true ||
      verification?.environment !== EXPECTED_ENVIRONMENT
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

    const key = `worldid:nullifier:${ACTION}:${nullifier.toLowerCase()}`;

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
      { verified: false, error: "Verification service unavailable" },
      { status: 500 }
    );
  }
}
