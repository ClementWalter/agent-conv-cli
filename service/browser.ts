/** Hosted browser sessions isolate provider login from OneConv identity and MCP grants. */
import { chromium } from "playwright";

/** OAuth popups are separate live views; following the newest tab preserves the opener. */
export function selectLoginPage(debug: any) {
  const pages = debug.pages || [];
  const page = pages.at(-1);
  return {
    pageId: page?.id || "session",
    url: page?.debuggerFullscreenUrl || debug.debuggerFullscreenUrl,
    title: page?.title || "Provider sign-in",
    tabs: pages.length,
  };
}

export async function loginView(sessionId: string) {
  const session = await browserbase(`/sessions/${sessionId}`);
  if (session.status !== "RUNNING") return { expired: true };
  return {
    expired: false,
    ...selectLoginPage(await browserbase(`/sessions/${sessionId}/debug`)),
  };
}

async function browserbase(path: string, body?: unknown) {
  const response = await fetch(`https://api.browserbase.com/v1${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      "x-bb-api-key": process.env.BROWSERBASE_API_KEY || "",
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok)
    throw new Error(
      `Hosted browser unavailable (${response.status}). Please retry.`,
    );
  return response.json() as Promise<any>;
}
export async function startLogin(provider: string, contextId?: string) {
  const context = contextId
    ? { id: contextId }
    : await browserbase("/contexts", {});
  const session = await browserbase("/sessions", {
    browserSettings: {
      context: { id: context.id, persist: true },
      recordSession: false,
      logSession: false,
      solveCaptchas: false,
    },
    timeout: 900,
    keepAlive: true,
  });
  const browser = await chromium.connectOverCDP(session.connectUrl);
  try {
    const page =
      browser.contexts()[0].pages()[0] ||
      (await browser.contexts()[0].newPage());
    await page.goto(
      provider === "openai"
        ? "https://chatgpt.com/auth/login"
        : "https://claude.ai/login",
      { waitUntil: "domcontentloaded" },
    );
  } finally {
    await browser.close();
  }
  const debug = await browserbase(`/sessions/${session.id}/debug`);
  return {
    context: context.id as string,
    id: session.id as string,
    url: debug.debuggerFullscreenUrl as string,
  };
}
export async function finishLogin(provider: string, sessionId: string) {
  const session = await browserbase(`/sessions/${sessionId}`);
  if (session.status !== "RUNNING")
    throw new Error("This login window has expired. Start a new connection.");
  const browser = await chromium.connectOverCDP(session.connectUrl);
  try {
    const context = browser.contexts()[0];
    const origin =
      provider === "openai" ? "https://chatgpt.com" : "https://claude.ai";
    const page = context.pages().find((p) => p.url().startsWith(origin));
    if (!page) throw new Error("Finish signing in in the login window first.");
    const identity = await page.evaluate(
      async (path) => {
        const response = await fetch(path, { credentials: "include" });
        return response.ok ? response.json() : null;
      },
      provider === "openai" ? "/api/auth/session" : "/api/organizations",
    );
    if (
      provider === "openai" &&
      (!identity?.accessToken || !identity?.account?.id)
    )
      throw new Error("OpenAI login is not complete yet.");
    if (
      provider === "claude" &&
      (!Array.isArray(identity) || !identity.some((org: any) => org.uuid))
    )
      throw new Error("Claude login is not complete yet.");
    const cookies = (await context.cookies(origin)).map((c) => ({
      name: c.name,
      value: c.value,
    }));
    return { cookies, identity, provider };
  } finally {
    await browser.close();
  }
}

export async function releaseLogin(sessionId: string) {
  await browserbase(`/sessions/${sessionId}`, {
    status: "REQUEST_RELEASE",
  });
}

export async function deleteContext(contextId: string) {
  const response = await fetch(
    `https://api.browserbase.com/v1/contexts/${encodeURIComponent(contextId)}`,
    {
      method: "DELETE",
      headers: { "x-bb-api-key": process.env.BROWSERBASE_API_KEY || "" },
      signal: AbortSignal.timeout(20000),
    },
  );
  if (!response.ok && response.status !== 404)
    throw new Error(
      "The stored browser session could not be deleted. Retry disconnecting.",
    );
}
