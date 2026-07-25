import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { trpc } from "@/providers/trpc";
import { AuthShell } from "@/components/AuthShell";

export default function VerifyEmail() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [state, setState] = useState<"working" | "ok" | "fail">("working");
  const verify = trpc.auth.verifyEmail.useMutation({
    onSuccess: () => setState("ok"),
    onError: () => setState("fail"),
  });
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // guard React 18 StrictMode double-invoke
    ran.current = true;
    if (token) verify.mutate({ token }); else setState("fail");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AuthShell
      title={state === "ok" ? "Email confirmed" : state === "fail" ? "Link expired" : "Confirming…"}
      sub={
        state === "working" ? "Just a moment while we verify your email."
        : state === "ok" ? ""
        : "This verification link is invalid or has expired."
      }>
      {state === "ok" && (
        <>
          <p style={{ color: "#c4cdd8", fontSize: ".92rem", lineHeight: 1.6, textAlign: "center", margin: "0 0 1.2rem" }}>
            Thanks — your email address is verified. You're all set.
          </p>
          <a className="eh-btn gold" href="/portal" style={{ display: "inline-block", padding: ".7rem 1.4rem" }}>
            Go to the portal →
          </a>
        </>
      )}
      {state === "fail" && (
        <p style={{ marginTop: ".4rem", fontSize: ".85rem", textAlign: "center" }}>
          <a href="/portal" style={{ color: "var(--eh-gold-2)" }}>Open the portal to request a new link →</a>
        </p>
      )}
    </AuthShell>
  );
}
