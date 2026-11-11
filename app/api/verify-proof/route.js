
import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

const RP_ID = "rp_6e6a7b45f63d731d";
const ACTION = "human-verification";

export async function POST(request) {
  try {
    const redis = new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });

    const ip = request.headers
      .get("x-forwarded-for")
      ?.split(",")[0]
      .trim();

    if (!ip) {
      return NextResponse.json(
        { verified: false, error: "Request source unavailable" },
        { status: 400 }
      );
    }

    const ratelimit = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(10, "1 m"),
      prefix: "cs77:verify-proof:ratelimit",
    });

    const { success, reset } = await ratelimit.limit(ip);

    if (!success) {
      const retryAfter = Math.max(
        1,
        Math.ceil((reset - Date.now()) / 1000)
      );

      return NextResponse.json(
        { verified: false, error: "Too many requests. Try again later." },
        {
          status: 429,
          headers: {
            "Retry-After": String(retryAfter),
          },
        }
      );
    }

    const proof = await request.json();

    if (
      !proof ||
      typeof proof !== "object" ||
      proof.action !== ACTION ||
      (proof.environment && proof.environment !== "production")
    ) {
      return NextResponse.json(
        { verified: false, error: "Invalid verification request" },
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
      (verification.environment &&
        verification.environment !== "production") ||
      (verification.action && verification.action !== ACTION)
    ) {
      return NextResponse.json(
        { verified: false, error: "World ID verification failed" },
        { status: 400 }
      );
    }

    const nullifier =
      verification.nullifier ||
      verification.results?.find(
        (result) =>
          result?.success === true &&
          typeof result.nullifier === "string"
      )?.nullifier;

    if (
      typeof nullifier !== "string" ||
      nullifier.length === 0
    ) {
      return NextResponse.json(
        { verified: false, error: "Verified nullifier unavailable" },
        { status: 400 }
      );
    }

    const key =
      `worldid:nullifier:${ACTION}:${nullifier.toLowerCase()}`;

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
      {
        verified: false,
        error: "Verification service unavailable",
      },
      { status: 500 }
    );
  }
}
