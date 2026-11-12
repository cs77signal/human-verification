
import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

const MAX_BODY_SIZE = 2048;
const EVENT_TTL_SECONDS = 86400;

const COUNTER_KEYS = {
  blockedByWorldId: "cs77:human-counter:blocked-by-world-id",
  alreadyVerified: "cs77:human-counter:already-verified",
  nullifierReplayed: "cs77:human-counter:nullifier-replayed",
};

const ALLOWED_EVENTS = [
  "already_verified",
  "nullifier_replayed",
];

const RECORD_EVENT_SCRIPT = `
local stored = redis.call(
  "SET",
  KEYS[1],
  "1",
  "NX",
  "EX",
  ARGV[1]
)

if not stored then
  return 0
end

redis.call("INCR", KEYS[2])
redis.call("INCR", KEYS[3])

return 1
`;

export async function POST(request) {
  try {
    const contentLength = request.headers.get("content-length");

    if (contentLength !== null) {
      const declaredSize = Number(contentLength);

      if (
        !Number.isSafeInteger(declaredSize) ||
        declaredSize < 0 ||
        declaredSize > MAX_BODY_SIZE
      ) {
        return NextResponse.json(
          { success: false, error: "Request body too large" },
          { status: 413 }
        );
      }
    }

    const bodyText = await request.text();

    if (
      new TextEncoder().encode(bodyText).byteLength >
      MAX_BODY_SIZE
    ) {
      return NextResponse.json(
        { success: false, error: "Request body too large" },
        { status: 413 }
      );
    }

    let body;

    try {
      body = JSON.parse(bodyText);
    } catch {
      return NextResponse.json(
        { success: false, error: "Invalid JSON" },
        { status: 400 }
      );
    }

    if (
      !body ||
      typeof body !== "object" ||
      !ALLOWED_EVENTS.includes(body.event)
    ) {
      return NextResponse.json(
        { success: false, error: "Invalid event" },
        { status: 400 }
      );
    }

    if (
      typeof body.eventId !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(body.eventId)
    ) {
      return NextResponse.json(
        { success: false, error: "Invalid event ID" },
        { status: 400 }
      );
    }

    const ip = request.headers
      .get("x-forwarded-for")
      ?.split(",")[0]
      .trim();

    if (!ip) {
      return NextResponse.json(
        { success: false, error: "Request source unavailable" },
        { status: 400 }
      );
    }

    const redis = new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });

    const ratelimit = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(10, "1 m"),
      prefix: "cs77:widget-event:ratelimit",
    });

    const { success, reset } = await ratelimit.limit(ip);

    if (!success) {
      const retryAfter = Math.max(
        1,
        Math.ceil((reset - Date.now()) / 1000)
      );

      return NextResponse.json(
        { success: false, error: "Too many requests" },
        {
          status: 429,
          headers: {
            "Retry-After": String(retryAfter),
          },
        }
      );
    }

    const counterKey =
      body.event === "already_verified"
        ? COUNTER_KEYS.alreadyVerified
        : COUNTER_KEYS.nullifierReplayed;

    const deduplicationKey =
      `cs77:widget-event:reported:${body.eventId}`;

    const recorded = await redis.eval(
      RECORD_EVENT_SCRIPT,
      [
        deduplicationKey,
        COUNTER_KEYS.blockedByWorldId,
        counterKey,
      ],
      [String(EVENT_TTL_SECONDS)]
    );

    return NextResponse.json({
      success: true,
      recorded: Number(recorded) === 1,
    });
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: "Event reporting unavailable",
      },
      { status: 500 }
    );
  }
}
