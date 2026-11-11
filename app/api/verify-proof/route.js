
import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";

const RP_ID = "rp_6e6a7b45f63d731d";
const ACTION = "human-verification";

export async function POST(request) {
  try {
    const proof = await request.json();

    if (
      !proof ||
      typeof proof !== "object" ||
      proof.action !== ACTION
    ) {
      return NextResponse.json(
        { verified: false, error: "Invalid verification request" },
        { status: 400 }
      );
    }

    const worldResponse = await fetch(
      `https://developer.worldcoin.org/api/v4/verify/${RP_ID}`,
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

    const redis = new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });

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
