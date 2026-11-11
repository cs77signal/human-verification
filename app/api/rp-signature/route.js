
import { NextResponse } from "next/server";
import { signRequest } from "@worldcoin/idkit/signing";

export async function POST() {
  const signingKeyHex = process.env.RP_SIGNING_KEY;

  if (!signingKeyHex) {
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500 }
    );
  }

  const signature = signRequest({
    action: "human-verification",
    signingKeyHex,
  });

  return NextResponse.json({
    sig: signature.sig,
    nonce: signature.nonce,
    created_at: signature.createdAt,
    expires_at: signature.expiresAt,
  });
}
