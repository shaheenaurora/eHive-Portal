import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { trpc } from "@/providers/trpc";

type VerifyState = "working" | "ok" | "fail";

export default function VerifyEmail() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [state, setState] = useState<VerifyState>("working");
  const [message, setMessage] = useState("");
  const verify = trpc.auth.verifyEmail.useMutation({
    onSuccess: () => setState("ok"),
    onError: e => {
      setState("fail");
      setMessage(
        e.message || "This verification link is invalid or has expired."
      );
    },
  });
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // guard React 18 StrictMode double-invoke
    ran.current = true;
    if (token) verify.mutate({ token });
    else {
      setState("fail");
      setMessage("No verification token was found in the link.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const title =
    state === "ok"
      ? "Email confirmed"
      : state === "fail"
        ? "Link expired"
        : "Confirming…";
  const sub =
    state === "working"
      ? "Just a moment while we verify your email."
      : state === "ok"
        ? ""
        : message;

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "var(--eh-ink)",
        padding: "1rem",
      }}
    >
      <div style={{ textAlign: "center", maxWidth: 400, width: "100%" }}>
        <img
          src="/assets/ehive-wordmark.png"
          alt="eHive"
          style={{
            height: 44,
            width: "auto",
            margin: "0 auto 1rem",
            display: "block",
          }}
        />
        <h1
          className="eh-serif"
          style={{
            color: "#f5efe2",
            fontSize: "1.35rem",
            fontWeight: 600,
            margin: "0 0 .4rem",
          }}
        >
          {title}
        </h1>
        <p style={{ color: "#9aa7b6", fontSize: ".9rem", margin: "0 0 2rem" }}>
          {sub}
        </p>

        {state === "ok" && (
          <>
            <p
              style={{
                color: "#c4cdd8",
                fontSize: ".92rem",
                lineHeight: 1.6,
                textAlign: "center",
                margin: "0 0 1.2rem",
              }}
            >
              Thanks — your email address is verified. You're all set.
            </p>
            <a
              className="eh-btn gold"
              href="/portal"
              style={{ display: "inline-block", padding: ".7rem 1.4rem" }}
            >
              Go to the portal →
            </a>
          </>
        )}
        {state === "fail" && (
          <p
            style={{
              marginTop: ".4rem",
              fontSize: ".85rem",
              textAlign: "center",
            }}
          >
            <a href="/portal" style={{ color: "var(--eh-gold-2)" }}>
              Open the portal to request a new link →
            </a>
          </p>
        )}
      </div>
    </div>
  );
}
