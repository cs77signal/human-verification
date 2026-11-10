
"use client";

import { useState } from "react";
import {
  IDKitRequestWidget,
  proofOfHuman,
} from "@worldcoin/idkit";

const APP_ID = "app_c5c2f54315be3096e7437cbbf634bf8d";
const RP_ID = "rp_6e6a7b45f63d731d";
const ACTION = "human-verification";

export default function Home() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rpContext, setRpContext] = useState(null);
  const [status, setStatus] = useState("");

  async function startVerification() {
    setLoading(true);
    setStatus("");

    try {
      const response = await fetch("/api/rp-signature", {
        method: "POST",
        cache: "no-store",
      });

      const signature = await response.json();

      if (
        !response.ok ||
        !signature.sig ||
        !signature.nonce ||
        !signature.created_at ||
        !signature.expires_at
      ) {
        throw new Error("Signature unavailable");
      }

      setRpContext({
        rp_id: RP_ID,
        nonce: signature.nonce,
        created_at: signature.created_at,
        expires_at: signature.expires_at,
        signature: signature.sig,
      });

      setOpen(true);
    } catch {
      setStatus(
        "Verification service unavailable. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify(result) {
    const response = await fetch("/api/verify-proof", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        rp_id: RP_ID,
        idkitResponse: result,
      }),
    });

    if (!response.ok) {
      throw new Error("Proof verification failed");
    }
  }

  return (
    <main className="container">
      <header className="header">
        <a href="/" className="brand">
          ⊕ cs77signal
        </a>
        <span className="label">HUMAN VERIFICATION</span>
      </header>

      <section className="hero">
        <p className="eyebrow">CS77 · WORLD ID</p>

        <h1>
          Prove you are human.
          <br />
          Keep your identity private.
        </h1>

        <p className="description">
          Verify that you are a unique human without
          revealing your identity.
        </p>

        <div className="verification">
          <p className="verification-title">
            HUMAN VERIFICATION
          </p>

          <p className="verification-description">
            Complete your World ID verification.
          </p>

          <button
            type="button"
            onClick={startVerification}
            disabled={loading}
          >
            {loading
              ? "Preparing verification..."
              : "Verify with World ID"}
          </button>

          {status && (
            <p className="description">{status}</p>
          )}
        </div>
      </section>

      <footer className="footer">
        <span>⊕ CS77</span>
        <span>AI THINKS • CS77 EXECUTES</span>
        <span>@cs77signal</span>
      </footer>

      {rpContext && (
        <IDKitRequestWidget
          open={open}
          onOpenChange={setOpen}
          app_id={APP_ID}
          action={ACTION}
          rp_context={rpContext}
          allow_legacy_proofs={false}
          preset={proofOfHuman({
            signal: "cs77-human-verification",
          })}
          handleVerify={handleVerify}
          onSuccess={() => {
            setStatus("Human verification successful.");
          }}
          onError={(errorCode) => {
            const code =
              typeof errorCode === "string"
                ? errorCode
                : "Unknown error";

            setStatus("Verification error: " + code);
          }}
        />
      )}
    </main>
  );
}
