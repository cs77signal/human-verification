
"use client";

import { useEffect, useState } from "react";
import {
  IDKitRequestWidget,
  proofOfHuman,
} from "@worldcoin/idkit";

const APP_ID = "app_c5c2f54315be3096e7437cbbf634bf8d";
const RP_ID = "rp_6e6a7b45f63d731d";
const ACTION = "human-verification";

const initialStats = {
  uniqueHumans: 0,
  verificationRequests: 0,
  successfulVerifications: 0,
  failedAttempts: 0,
  blockedByWorldId: 0,
  alreadyVerified: 0,
  nullifierReplayed: 0,
};

export default function Embed() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rpContext, setRpContext] = useState(null);
  const [status, setStatus] = useState("");

  const [stats, setStats] = useState(initialStats);
  const [statsStatus, setStatsStatus] = useState("CONNECTING");

  useEffect(() => {
    let active = true;

    async function loadStats() {
      try {
        const response = await fetch("/api/embed-stats", {
          cache: "no-store",
        });

        const data = await response.json();

        if (!response.ok || data.success !== true) {
          throw new Error("Statistics unavailable");
        }

        if (active) {
          setStats({
            ...initialStats,
            ...data.stats,
          });
          setStatsStatus("LIVE");
        }
      } catch {
        if (active) {
          setStatsStatus("UNAVAILABLE");
        }
      }
    }

    loadStats();

    const interval = setInterval(loadStats, 10000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

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
      body: JSON.stringify(result),
    });

    if (!response.ok) {
      throw new Error("Proof verification failed");
    }
  }

  async function reportWidgetEvent(event) {
    try {
      await fetch("/api/report-widget-event", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          event,
          eventId: crypto.randomUUID(),
        }),
      });
    } catch (error) {
      console.error(
        "CS77 widget event reporting failed:",
        error
      );
    }
  }

  const metrics = [
    ["UNIQUE HUMANS", stats.uniqueHumans],
    ["ALREADY VERIFIED", stats.alreadyVerified],
  ];

  return (
    <main className="container compact">
      <section className="hero">
        <p
          className="eyebrow"
          style={{
            fontFamily: '"World Pro", Inter, sans-serif',
          }}
        >
          ⊕{"\u00A0\u00A0"}CS77{"\u00A0\u00A0"}•{"\u00A0\u00A0"}World ID
        </p>

        <h1
          style={{
            fontFamily: '"World Pro", Inter, sans-serif',
          }}
        >
          Prove you are human. Keep your identity private.
        </h1>

        <div className="verification">
          <p
            className="verification-title"
            style={{
              fontFamily: '"World Pro", Inter, sans-serif',
            }}
          >
            HUMAN VERIFICATION
          </p>

          <button
            type="button"
            onClick={startVerification}
            disabled={loading}
          >
            {loading ? "Preparing..." : "Verify"}
          </button>

          {status && (
            <p
              className="status"
              style={{
                fontFamily: '"World Pro", Inter, sans-serif',
              }}
            >
              {status}
            </p>
          )}
        </div>
      </section>

      <section
        style={{
          width: "100%",
          marginTop: "10px",
          padding: "12px",
          border: "1px solid #292929",
          borderRadius: "8px",
          background: "#080a0a",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "9px",
            marginBottom: "10px",
            color: "#00a6a6",
            fontFamily: "monospace",
            fontSize: "12px",
            fontWeight: "bold",
            letterSpacing: "1.2px",
          }}
        >
          <span
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              background:
                statsStatus === "LIVE" ? "#00c995" : "#777",
              flexShrink: 0,
            }}
          />
          <span>SYSTEM {statsStatus}</span>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: "8px",
          }}
        >
          {metrics.map(([label, value]) => (
            <div
              key={label}
              style={{
                minWidth: 0,
                padding: "10px",
                border: "1px solid #292929",
                borderRadius: "4px",
                background: "#0b0b0b",
              }}
            >
              <p
                style={{
                  margin: "0 0 6px",
                  color: "#00a6a6",
                  fontFamily: "monospace",
                  fontSize: "11px",
                  fontWeight: "bold",
                  lineHeight: 1.4,
                  letterSpacing: "0.6px",
                }}
              >
                {label}
              </p>

              <strong
                style={{
                  display: "block",
                  color: "#f5f5f5",
                  fontFamily: "monospace",
                  fontSize: "24px",
                  fontWeight: 600,
                  lineHeight: 1.2,
                  overflowWrap: "anywhere",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {Number(value).toLocaleString("en-US")}
              </strong>
            </div>
          ))}
        </div>
      </section>

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
            console.error("CS77 IDKit error:", errorCode);

            if (errorCode === "nullifier_replayed") {
              void reportWidgetEvent("nullifier_replayed");
            }

            setStatus(
              "World ID ERROR: " + String(errorCode)
            );
          }}
        />
      )}
    </main>
  );
}
