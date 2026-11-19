
import { NextResponse } from "next/server";
import { createHmac, randomBytes } from "node:crypto";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

const RP_ID = "rp_6e6a7b45f63d731d";
const ACTION = "human-verification";
const MAX_BODY_SIZE = 65536;
const ACCESS_CODE_TTL = 60;

const COUNTER_KEYS = {
  uniqueHumans: "cs77:human-counter:unique-humans",
  verificationRequests: "cs77:human-counter:verification-requests",
  successfulVerifications:
    "cs77:human-counter:successful-verifications",
  failedAttempts: "cs77:human-counter:failed-attempts",
};

const ACCEPT_PROOF_SCRIPT = `
local stored = redis.call("SET", KEYS[1], "1", "NX")

if not stored then
  return 0
end

local codeStored = redis.call(
  "SET",
  KEYS[4],
  "1",
  "NX",
  "EX",
  ARGV[1]
)

if not codeStored then
  redis.call("DEL", KEYS[1])
  return -1
end

redis.call("INCR", KEYS[2])
redis.call("INCR", KEYS[3])

return 1
`;

async function incrementSafely(redis, key) {
  try {
    await redis.incr(key);
  } catch {
    // Uma falha de métricas não deve interromper a verificação.
  }
}

function createDigest(secret, value) {
  return createHmac("sha256", secret)
    .update(value)
    .digest("hex");
}

function errorResponse(message, status, extra = {}) {
  return NextResponse.json(
    {
      verified: false,
      error: message,
      ...extra,
    },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}

export async function POST(request) {
  try {
    const sessionSecret = process.env.SESSION_SECRET;

    if (
      typeof sessionSecret !== "string" ||
      !/^[a-fA-F0-9]{64}$/.test(sessionSecret)
    ) {
      return errorResponse(
        "Verification service configuration error",
        500
      );
    }

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
      return errorResponse(
        "Request source unavailable",
        400
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

      return errorResponse(
        "Too many requests. Try again later.",
        429,
        { retryAfter }
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
        return errorResponse(
          "Request body too large",
          413
        );
      }
    }

    if (!request.body) {
      return errorResponse(
        "Missing request body",
        400
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

        return errorResponse(
          "Request body too large",
          413
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
      proof = JSON.parse(
        new TextDecoder().decode(bodyBytes)
      );
    } catch {
      return errorResponse(
        "Invalid JSON request",
        400
      );
    }

    if (
      !proof ||
      typeof proof !== "object" ||
      Array.isArray(proof) ||
      proof.action !== ACTION ||
      (proof.environment &&
        proof.environment !== "production")
    ) {
      return errorResponse(
        "Invalid verification request",
        400
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

    let verification;

    try {
      verification = await worldResponse.json();
    } catch {
      verification = null;
    }

    if (
      !worldResponse.ok ||
      verification?.success !== true ||
      (verification.environment &&
        verification.environment !== "production") ||
      (verification.action &&
        verification.action !== ACTION)
    ) {
      await incrementSafely(
        redis,
        COUNTER_KEYS.failedAttempts
      );

      return errorResponse(
        "World ID verification failed",
        400
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
      return errorResponse(
        "Verified nullifier unavailable",
        400
      );
    }

    const nullifierDigest = createDigest(
      sessionSecret,
      `nullifier:${ACTION}:${nullifier.toLowerCase()}`
    );

    const exchangeCode = randomBytes(32).toString("base64url");

    const exchangeCodeDigest = createDigest(
      sessionSecret,
      `access-code:${exchangeCode}`
    );

    const nullifierKey =
      `cs77:worldid:nullifier:${nullifierDigest}`;

    const accessCodeKey =
      `cs77:access-code:${exchangeCodeDigest}`;

    const accepted = await redis.eval(
      ACCEPT_PROOF_SCRIPT,
      [
        nullifierKey,
        COUNTER_KEYS.uniqueHumans,
        COUNTER_KEYS.successfulVerifications,
        accessCodeKey,
      ],
      [String(ACCESS_CODE_TTL)]
    );

    if (Number(accepted) !== 1) {
      if (Number(accepted) === 0) {
        await incrementSafely(
          redis,
          COUNTER_KEYS.failedAttempts
        );

        return errorResponse(
          "This proof has already been used",
          409
        );
      }

      return errorResponse(
        "Unable to create access code",
        500
      );
    }

    return NextResponse.json(
      {
        verified: true,
        exchangeCode,
        expiresIn: ACCESS_CODE_TTL,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );

  } catch {
    return errorResponse(
      "Verification service unavailable",
      500
    );
  }
}
