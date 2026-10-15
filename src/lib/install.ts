/* Deferred PWA install prompt. Chrome/Android fire beforeinstallprompt only
   once; whoever hears it first stashes it here so both the banner
   (InstallPrompt) and the sidebar "Install app" entry can call prompt().
   `appinstalled` clears the stash so both entries hide themselves. */

export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", e => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    notify();
  });
}

export function isInstallable(): boolean {
  return deferred !== null;
}

/** Subscribe to installability changes (prompt captured / app installed). */
export function onInstallChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Show the browser install prompt. Returns the user's choice, or null when
    the browser hasn't offered installation (e.g. iOS / already installed). */
export async function promptInstall(): Promise<"accepted" | "dismissed" | null> {
  if (!deferred) return null;
  const evt = deferred;
  await evt.prompt();
  const choice = await evt.userChoice;
  deferred = null;
  return choice.outcome;
}
