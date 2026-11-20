import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

const MAX_BODY_SIZE = 4096;
const TIMESTAMP_TOLERANCE_SECONDS = 300;
const NONCE_TTL_SECONDS = 300;

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const CONSUME_CODE_SCRIPT = `
  local value = redis.call("GET", KEYS[1])

  if not value then
    return 0
  end

  redis.call("DEL", KEYS[1])
  return 1
`;

function errorResponse(message, status) {
  return NextResponse.json(
    { valid: false, error: message },
    { status }
  );
}

function createDigest(secret, value) {
  return createHmac("sha256", Buffer.from(secret, "hex"))
    .update(value)
    .digest("hex");
}

function safeCompareHex(a, b) {
  if (
    typeof a !== "string" ||
    typeof b !== "string" ||
    !/^[a-f0-9]{64}$/i.test(a) ||
    !/^[a-f0-9]{64}$/i.test(b)
  ) {
    return false;
  }

  return timingSafeEqual(
    Buffer.from(a, "hex"),
    Buffer.from(b, "hex")
  );
}

export async function POST(request) {
  try {
    const serviceSecret = process.env.CS77_SERVICE_SECRET;
    const sessionSecret = process.env.SESSION_SECRET;

    if (
      !serviceSecret ||
      !/^[a-f0-9]{64}$/i.test(serviceSecret) ||
      !sessionSecret ||
      !/^[a-f0-9]{64}$/i.test(sessionSecret)
    ) {
      return errorResponse("Server configuration error", 500);
    }

    const contentLength = Number(
      request.headers.get("content-length") || 0
    );

    if (contentLength > MAX_BODY_SIZE) {
      return errorResponse("Request body too large", 413);
    }

    const rawBody = await request.text();

    if (
      !rawBody ||
      Buffer.byteLength(rawBody, "utf8") > MAX_BODY_SIZE
    ) {
      return errorResponse("Invalid request body", 400);
    }

    let body;

    try {
      body = JSON.parse(rawBody);
    } catch {
      return errorResponse("Invalid JSON", 400);
    }

    const exchangeCode = body?.exchangeCode;

    if (
      typeof exchangeCode !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(exchangeCode)
    ) {
      return errorResponse("Invalid access code", 400);
    }

    const ip = request.headers
      .get("x-forwarded-for")
      ?.split(",")[0]
      .trim();

    if (!ip) {
      return errorResponse("Request source unavailable", 400);
    }

    const ratelimit = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(10, "1 m"),
      prefix: "cs77:consume-access-code:ratelimit",
    });

    const { success, reset } = await ratelimit.limit(ip);

    if (!success) {
      return NextResponse.json(
        {
          valid: false,
          error: "Too many requests",
          retryAfter: Math.max(
            1,
            Math.ceil((reset - Date.now()) / 1000)
          ),
        },
        { status: 429 }
      );
    }

    const timestamp = request.headers.get("x-cs77-timestamp");
    const nonce = request.headers.get("x-cs77-nonce");
    const signature = request.headers.get("x-cs77-signature");

    if (
      !timestamp ||
      !/^\d{10}$/.test(timestamp) ||
      !nonce ||
      !/^[A-Za-z0-9_-]{16,128}$/.test(nonce) ||
      !signature
    ) {
      return errorResponse("Missing authentication headers", 401);
    }

    const requestTimestamp = Number(timestamp);
    const currentTimestamp = Math.floor(Date.now() / 1000);

    if (
      Math.abs(currentTimestamp - requestTimestamp) >
      TIMESTAMP_TOLERANCE_SECONDS
    ) {
      return errorResponse("Request timestamp expired", 401);
    }

    const expectedSignature = createDigest(
      serviceSecret,
      `${timestamp}.${nonce}.${rawBody}`
    );

    if (!safeCompareHex(signature, expectedSignature)) {
      return errorResponse("Invalid request signature", 401);
    }

    const nonceKey = `cs77:service:nonce:${nonce}`;

    const nonceResult = await redis.set(
      nonceKey,
      "1",
      {
        nx: true,
        ex: NONCE_TTL_SECONDS,
      }
    );

    if (nonceResult !== "OK") {
      return errorResponse("Request already used", 409);
    }

    const codeDigest = createDigest(
      sessionSecret,
      `access-code:${exchangeCode}`
    );

    const accessCodeKey = `cs77:access-code:${codeDigest}`;

    const consumed = await redis.eval(
      CONSUME_CODE_SCRIPT,
      [accessCodeKey],
      []
    );

    if (Number(consumed) !== 1) {
      return errorResponse("Access code invalid or already used", 401);
    }

    return NextResponse.json({
      valid: true,
    });
  } catch {
    return errorResponse("Internal server error", 500);
  }
}