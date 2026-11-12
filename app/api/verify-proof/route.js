
import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

const RP_ID = "rp_6e6a7b45f63d731d";
const ACTION = "human-verification";
const MAX_BODY_SIZE = 65536;

const COUNTER_KEYS = {
  uniqueHumans: "cs77:human-counter:unique-humans",
  verificationRequests: "cs77:human-counter:verification-requests",
  successfulVerifications:
    "cs77:human-counter:successful-verifications",
  failedAttempts: "cs77:human-counter:failed-attempts",
};

async function incrementSafely(redis, key) {
  try {
    await redis.incr(key);
  } catch {
    // A falha de uma métrica não deve interromper a verificação.
  }
}

const ACCEPT_PROOF_SCRIPT = `
local stored = redis.call("SET", KEYS[1], "1", "NX")

if stored then
  redis.call("INCR", KEYS[2])
  redis.call("INCR", KEYS[3])
  return 1
end

return 0
`;

export async function POST(request) {
  try {
    const redis = new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });

    await incrementSafely(
      redis,
      COUNTER_KEYS.verificationRequests
    );

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

    const contentLength = request.headers.get("content-length");

    if (contentLength !== null) {
      const declaredSize = Number(contentLength);

      if (
        !Number.isSafeInteger(declaredSize) ||
        declaredSize < 0 ||
        declaredSize > MAX_BODY_SIZE
      ) {
        return NextResponse.json(
          { verified: false, error: "Request body too large" },
          { status: 413 }
        );
      }
    }

    if (!request.body) {
      return NextResponse.json(
        { verified: false, error: "Missing request body" },
        { status: 400 }
      );
    }

    const reader = request.body.getReader();
    const chunks = [];
    let totalSize = 0;

    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      totalSize += value.byteLength;

      if (totalSize > MAX_BODY_SIZE) {
        await reader.cancel();

        return NextResponse.json(
          { verified: false, error: "Request body too large" },
          { status: 413 }
        );
      }

      chunks.push(value);
    }

    const bodyBytes = new Uint8Array(totalSize);
    let offset = 0;

    for (const chunk of chunks) {
      bodyBytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    let proof;

    try {
      proof = JSON.parse(new TextDecoder().decode(bodyBytes));
    } catch {
      return NextResponse.json(
        { verified: false, error: "Invalid JSON request" },
        { status: 400 }
      );
    }

    if (
      !proof ||
      typeof proof !== "object" ||
      Array.isArray(proof) ||
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
      await incrementSafely(
        redis,
        COUNTER_KEYS.failedAttempts
      );

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

    const accepted = await redis.eval(
      ACCEPT_PROOF_SCRIPT,
      [
        key,
        COUNTER_KEYS.uniqueHumans,
        COUNTER_KEYS.successfulVerifications,
      ],
      []
    );

    if (Number(accepted) !== 1) {
      await incrementSafely(
        redis,
        COUNTER_KEYS.failedAttempts
      );

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
