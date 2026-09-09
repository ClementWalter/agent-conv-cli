/** The workspace exposes actual service state and keeps credentials out of browser storage. */
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Button, Dialog, Modal, ModalOverlay } from "react-aria-components";
import {
  ArrowUpRight,
  ArrowRight,
  Plus,
  Search,
  Link2,
  MessageSquare,
  ShieldCheck,
  Settings2,
  Check,
  Copy,
  RefreshCw,
  X,
  ChevronRight,
  LogOut,
  CircleHelp,
  LoaderCircle,
  Monitor,
  ExternalLink,
  Sparkles,
} from "lucide-react";
import "./style.css";

type Config = {
  mode: string;
  loginReady: boolean;
  browserReady: boolean;
  mcpUrl: string;
};
type Connection = {
  id: string;
  provider: string;
  label: string;
  status: string;
  detail: string;
  last_sync: number | null;
};
async function api(path: string, method = "GET", data?: unknown) {
  const response = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || "Request failed. Please try again.");
  return result;
}
const time = (value: number | null) =>
  value
    ? new Date(Number(value)).toLocaleString([], {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Not synced yet";
function Mark({ small = false }: { small?: boolean }) {
  return (
    <span className={`mark ${small ? "small" : ""}`} aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}
function Provider({ name }: { name: string }) {
  return (
    <span className={`provider-icon ${name}`} aria-hidden="true">
      {name === "claude" ? (
        "✳"
      ) : name === "openai" ? (
        "✺"
      ) : (
        <Monitor size={20} />
      )}
    </span>
  );
}
function App() {
  const [config, setConfig] = useState<Config>();
  const [me, setMe] = useState<any>(null),
    [booting, setBooting] = useState(true);
  const [tab, setTab] = useState("Connections"),
    [connections, setConnections] = useState<Connection[]>([]);
  const [chats, setChats] = useState<any[]>([]),
    [grants, setGrants] = useState<any[]>([]);
  const [query, setQuery] = useState(""),
    [detail, setDetail] = useState<any>(null);
  const queryRef = useRef(query);
  queryRef.current = query;
  const [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [connect, setConnect] = useState(false),
    [login, setLogin] = useState<{ id: string; url: string } | null>(null);
  const [secret, setSecret] = useState(""),
    [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  async function refresh() {
    const requestedQuery = queryRef.current;
    const [sources, history, access] = await Promise.all([
      api("/api/connections"),
      api(`/api/conversations?q=${encodeURIComponent(requestedQuery)}`),
      api("/api/grants"),
    ]);
    setConnections(sources);
    if (requestedQuery === queryRef.current) setChats(history);
    setGrants(access);
  }
  useEffect(() => {
    void (async () => {
      try {
        setConfig(await api("/api/config"));
        try {
          setMe(await api("/api/me"));
          await refresh();
        } catch {
          /* Signed-out state is an expected first visit. */
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBooting(false);
      }
    })();
  }, []);
  useEffect(() => {
    if (!me) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible")
        void refresh().catch(() => {});
    }, 8000);
    return () => clearInterval(timer);
  }, [me]);
  useEffect(() => {
    if (!me || tab !== "Conversations") return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void fetch(`/api/conversations?q=${encodeURIComponent(query)}`, {
        signal: controller.signal,
      })
        .then((r) => r.json())
        .then(setChats)
        .catch(() => {});
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, tab, me]);
  async function act(name: string, task: () => Promise<void>) {
    setBusy(name);
    setError("");
    setNotice("");
    try {
      await task();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function copy(value: string) {
    await navigator.clipboard.writeText(value);
    setNotice("Copied to clipboard.");
  }
  const connected = connections.filter(
    (c) => c.provider !== "import" && ["ready", "partial"].includes(c.status),
  ).length;
  const waiting = connections.some((c) =>
    ["syncing", "pending"].includes(c.status),
  );
  if (booting)
    return (
      <div className="boot">
        <Mark />
        <LoaderCircle className="spin" />
        <p>Opening your workspace…</p>
      </div>
    );
  return (
    <>
      {!me ? (
        <main className="welcome">
          <header>
            <Mark small />
            <strong>oneconv</strong>
            <span className="eyebrow">A little continuity.</span>
          </header>
          <div className="welcome-body">
            <div className="intro">
              <span className="overline">YOUR THINKING, CONNECTED</span>
              <h1>
                Great conversations
                <br />
                deserve a <em>next chapter.</em>
              </h1>
              <p>
                Bring your AI conversations together. Pick up the thread in the
                assistant you choose.
              </p>
              <Button
                className="primary large"
                isDisabled={
                  !!busy || (!config?.loginReady && config?.mode !== "local")
                }
                onPress={() =>
                  void act("signin", async () => {
                    if (config?.mode === "local") {
                      await api("/api/local-login", "POST");
                      setMe(await api("/api/me"));
                      await refresh();
                    } else window.location.href = "/auth/login";
                  })
                }
              >
                {busy ? <LoaderCircle className="spin" size={18} /> : null}
                {config?.mode === "local"
                  ? "Open local workspace"
                  : "Get started"}
                <ArrowRight size={18} />
              </Button>
              <span className="fine">
                {config?.mode === "local"
                  ? "Runs on this Mac. Your saved history stays here."
                  : config?.loginReady
                    ? "Your accounts. Your conversations. Your choice."
                    : "Account sign-in needs deployment configuration."}
              </span>
            </div>
            <div className="welcome-art" aria-hidden="true">
              <div className="orbit o1" />
              <div className="orbit o2" />
              <div className="art-center">
                <Mark />
              </div>
              <span className="art-chip chip-a">✳ Claude</span>
              <span className="art-chip chip-b">✺ OpenAI</span>
              <span className="art-note">
                Context, carried forward.
                <span>One connection. More possibilities.</span>
              </span>
            </div>
          </div>
          <footer>
            <span>PRIVATE BY DEFAULT</span>
            <span>Built for continuity, wherever you think.</span>
          </footer>
        </main>
      ) : (
        <div className="shell">
          <aside className="sidebar">
            <a className="brand" href="/" aria-label="OneConv home">
              <Mark small />
              <strong>oneconv</strong>
            </a>
            <div className="workspace-label">
              YOUR WORKSPACE<span>Personal</span>
            </div>
            <nav aria-label="Workspace">
              {[
                [Link2, "Connections"],
                [MessageSquare, "Conversations"],
                [ShieldCheck, "Assistant access"],
                [Settings2, "Settings"],
              ].map(([Icon, name]: any) => (
                <Button
                  key={name}
                  className={`nav-item ${tab === name ? "active" : ""}`}
                  onPress={() => {
                    setTab(name);
                    setDetail(null);
                  }}
                >
                  <Icon size={18} />
                  {name}
                  {name === "Conversations" && chats.length > 0 && (
                    <span className="nav-count">{chats.length}</span>
                  )}
                </Button>
              ))}
            </nav>
            <div className="sidebar-bottom">
              <div className="private-note">
                <ShieldCheck size={17} />
                <span>
                  Your history is private.
                  <small>Training & licensing are off.</small>
                </span>
              </div>
              <div className="profile">
                <span className="avatar">{me.name[0].toUpperCase()}</span>
                <span>
                  {me.name}
                  <small>
                    {config?.mode === "local" ? "Local workspace" : "Free plan"}
                  </small>
                </span>
                <Button
                  className="icon-button"
                  aria-label="Sign out"
                  onPress={() =>
                    void act("logout", async () => {
                      await api("/api/logout", "POST");
                      setMe(null);
                    })
                  }
                >
                  <LogOut size={16} />
                </Button>
              </div>
            </div>
          </aside>
          <main className="main">
            <header className="topbar">
              <span>
                Workspace <ChevronRight size={13} /> {tab}
              </span>
              <span className="environment">
                <span className="dot" />
                {config?.mode === "local"
                  ? "On this Mac"
                  : "Your cloud workspace"}
              </span>
            </header>
            <div className="page">
              <div className="page-heading">
                <div>
                  <span className="overline">
                    {tab === "Connections"
                      ? "A HOME FOR YOUR CONTEXT"
                      : "YOUR WORKSPACE"}
                  </span>
                  <h1>{tab}</h1>
                  <p>
                    {
                      (
                        {
                          Connections:
                            "Connect once. Keep your thinking with you.",
                          Conversations:
                            "Find the thought you want to carry forward.",
                          "Assistant access":
                            "Your history, in the assistant you choose.",
                          Settings: "A little control goes a long way.",
                        } as any
                      )[tab]
                    }
                  </p>
                </div>
                {tab === "Connections" && (
                  <Button className="primary" onPress={() => setConnect(true)}>
                    <Plus size={17} />
                    Connect an account
                  </Button>
                )}
              </div>
              {tab === "Connections" && (
                <>
                  <div className="summary-strip">
                    <div>
                      <span className="summary-number">
                        {connected.toString().padStart(2, "0")}
                      </span>
                      <span>Connected sources</span>
                    </div>
                    <div>
                      <span className="summary-number">
                        {chats.length.toString().padStart(2, "0")}
                      </span>
                      <span>Conversations shown</span>
                    </div>
                    <div className="summary-status">
                      <ShieldCheck size={24} />
                      <span>
                        Private by default
                        <small>Only shared with assistants you authorize</small>
                      </span>
                    </div>
                  </div>
                  <div className="section-heading">
                    <h2>Your AI accounts</h2>
                    <span>
                      {waiting
                        ? "Syncing in the background…"
                        : "You’re in control"}
                    </span>
                  </div>
                  <section className="source-list" aria-label="AI accounts">
                    {["openai", "claude"].map((provider) => (
                      <div className="source-group" key={provider}>
                        <div className="source-row">
                          <Provider name={provider} />
                          <div className="source-name">
                            <h3>
                              {provider === "openai" ? "OpenAI" : "Claude"}
                            </h3>
                            <p>
                              {provider === "openai"
                                ? "ChatGPT · Codex"
                                : "Claude Chat · Cowork"}
                            </p>
                          </div>
                          <span className="source-count">
                            {connections.filter((c) => c.provider === provider)
                              .length
                              ? `${connections.filter((c) => c.provider === provider).length} account(s)`
                              : "Not connected"}
                          </span>
                          <Button
                            className="secondary"
                            onPress={() =>
                              void act(provider, async () => {
                                const result = await api(
                                  "/api/connections",
                                  "POST",
                                  { provider },
                                );
                                setLogin(result);
                                setConnect(false);
                                await refresh();
                              })
                            }
                            isDisabled={!!busy}
                          >
                            {busy === provider ? (
                              <LoaderCircle size={16} className="spin" />
                            ) : (
                              <Plus size={16} />
                            )}
                            Connect
                          </Button>
                        </div>
                        {connections
                          .filter((c) => c.provider === provider)
                          .map((c) => (
                            <div className="account-row" key={c.id}>
                              <div>
                                <strong>{c.label}</strong>
                                <p>
                                  {c.detail || "Waiting for sign-in"} ·{" "}
                                  {time(c.last_sync)}
                                </p>
                              </div>
                              <span className={`status ${c.status}`}>
                                {c.status === "ready" ? (
                                  <Check size={14} />
                                ) : ["syncing", "pending"].includes(
                                    c.status,
                                  ) ? (
                                  <LoaderCircle size={14} className="spin" />
                                ) : null}
                                {c.status}
                              </span>
                              <Button
                                className="icon-button"
                                isDisabled={!!busy}
                                aria-label={`${["authorizing", "reconnect"].includes(c.status) ? "Reconnect" : "Refresh"} ${c.label}`}
                                onPress={() =>
                                  void act(c.id, async () => {
                                    if (
                                      ["authorizing", "reconnect"].includes(
                                        c.status,
                                      )
                                    ) {
                                      setLogin(
                                        await api(
                                          `/api/connections/${c.id}/login`,
                                          "POST",
                                        ),
                                      );
                                      await refresh();
                                      return;
                                    }
                                    await api(
                                      `/api/connections/${c.id}/sync`,
                                      "POST",
                                    );
                                    setNotice(
                                      "Sync queued. You can keep browsing.",
                                    );
                                    await refresh();
                                  })
                                }
                              >
                                <RefreshCw size={15} />
                              </Button>
                              <Button
                                className="icon-button"
                                aria-label={`Remove ${c.label}`}
                                onPress={() => {
                                  if (
                                    window.confirm(
                                      "Disconnect this account and delete its imported history?",
                                    )
                                  )
                                    void act(c.id, async () => {
                                      await api(
                                        `/api/connections/${c.id}`,
                                        "DELETE",
                                      );
                                      await refresh();
                                    });
                                }}
                              >
                                <X size={15} />
                              </Button>
                            </div>
                          ))}
                      </div>
                    ))}
                  </section>
                  {config?.mode === "local" && (
                    <section className="local-import">
                      <Monitor size={22} />
                      <div>
                        <h3>Already using OneConv on this Mac?</h3>
                        <p>
                          {connections.some((c) => c.provider === "import")
                            ? "Saved history imported. This snapshot updates when you import again; it is not a live connection."
                            : "Bring your saved cloud conversations into this workspace. No new login needed."}
                        </p>
                      </div>
                      <Button
                        className="text-button"
                        isDisabled={!!busy}
                        onPress={() =>
                          void act("import", async () => {
                            const result = await api(
                              "/api/import-local",
                              "POST",
                            );
                            setNotice(
                              `Imported ${result.count} saved conversations.`,
                            );
                            await refresh();
                          })
                        }
                      >
                        {busy === "import"
                          ? "Importing…"
                          : "Import saved history"}
                        <ArrowUpRight size={16} />
                      </Button>
                    </section>
                  )}
                  <section className="next-step">
                    <span className="step-label">NEXT, MAKE IT USEFUL</span>
                    <h2>
                      Let your next conversation
                      <br />
                      start where you left off.
                    </h2>
                    <p>
                      Add OneConv to Claude or Cowork and bring the right
                      context into the room.
                    </p>
                    <Button
                      className="text-button"
                      onPress={() => setTab("Assistant access")}
                    >
                      Connect your assistant
                      <ArrowRight size={17} />
                    </Button>
                    <span className="next-symbol" aria-hidden="true">
                      ↗
                    </span>
                  </section>
                  <div className="footnote">
                    <ShieldCheck size={15} />
                    Your provider passwords are entered in the provider’s own
                    login page.
                  </div>
                </>
              )}
              {tab === "Conversations" && (
                <>
                  <label className="search">
                    <Search size={19} />
                    <input
                      placeholder="Search your conversations…"
                      aria-label="Search your conversations"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                    <kbd>Search</kbd>
                  </label>
                  <div
                    className={`conversation-layout ${detail ? "with-detail" : ""}`}
                  >
                    <section className="chat-list">
                      {!chats.length && (
                        <div className="empty">
                          <MessageSquare />
                          <h2>A fresh start, with a little history.</h2>
                          <p>
                            Connect an account or import saved history to see
                            your conversations here.
                          </p>
                          <Button
                            className="secondary"
                            onPress={() => setTab("Connections")}
                          >
                            Go to connections
                          </Button>
                        </div>
                      )}
                      {chats.map((chat) => (
                        <Button
                          key={chat.id}
                          className={`chat-row ${detail?.id === chat.id ? "selected" : ""}`}
                          onPress={() =>
                            void act("read", async () =>
                              setDetail(
                                await api(`/api/conversations/${chat.id}`),
                              ),
                            )
                          }
                        >
                          <span className="chat-provider">
                            {chat.product.includes("claude") ||
                            chat.product.includes("cowork")
                              ? "✳"
                              : "✺"}
                          </span>
                          <span>
                            <strong>{chat.title}</strong>
                            <small>
                              {chat.product} · {chat.account}
                            </small>
                          </span>
                          <ChevronRight size={15} />
                        </Button>
                      ))}
                    </section>
                    {detail && (
                      <article className="transcript">
                        <header>
                          <div>
                            <span className="overline">{detail.product}</span>
                            <h2>{detail.title}</h2>
                          </div>
                          <Button
                            className="icon-button"
                            aria-label="Close conversation"
                            onPress={() => setDetail(null)}
                          >
                            <X size={18} />
                          </Button>
                        </header>
                        {detail.document.turns.map((turn: any, i: number) => (
                          <div className={`turn ${turn.role}`} key={i}>
                            <span>
                              {turn.role === "user" ? "You" : "Assistant"}
                            </span>
                            <p>{turn.text}</p>
                          </div>
                        ))}
                      </article>
                    )}
                  </div>
                </>
              )}
              {tab === "Assistant access" && (
                <>
                  <section className="mcp-card">
                    <span className="pill">
                      <Link2 size={14} />
                      One connection for your context
                    </span>
                    <h2>
                      Meet your assistant
                      <br />
                      with a little more history.
                    </h2>
                    <p>
                      In Claude or Cowork, add a custom connector with this URL.
                      <br />
                      {config?.mode === "local"
                        ? "This address is local. Cloud apps need a hosted HTTPS deployment."
                        : "Sign in to OneConv when prompted to authorize access."}
                    </p>
                    <div className="copy-field">
                      <code>{config?.mcpUrl}</code>
                      <Button
                        className="primary"
                        onPress={() =>
                          void act("copy", () => copy(config!.mcpUrl))
                        }
                      >
                        <Copy size={16} />
                        Copy URL
                      </Button>
                    </div>
                  </section>
                  <section className="section-heading">
                    <h2>Authorized assistants</h2>
                    <span>Revoke access at any time</span>
                  </section>
                  {!grants.length && (
                    <div className="quiet-empty">
                      No assistant has access yet. Your first authorized
                      connection will appear here.
                    </div>
                  )}
                  {grants.map((g) => (
                    <div className="grant-row" key={g.id}>
                      <ShieldCheck size={20} />
                      <span>
                        <strong>{g.label}</strong>
                        <small>
                          {g.active
                            ? g.last_used
                              ? `Last request ${time(g.last_used)}`
                              : "Waiting for first request"
                            : "Access revoked"}
                        </small>
                      </span>
                      {g.active && (
                        <Button
                          className="secondary"
                          onPress={() =>
                            void act(g.id, async () => {
                              await api(`/api/grants/${g.id}`, "DELETE");
                              await refresh();
                            })
                          }
                        >
                          Revoke
                        </Button>
                      )}
                    </div>
                  ))}
                  <details className="advanced">
                    <summary>
                      Access key for a local or developer client
                    </summary>
                    <p>
                      Select which accounts this key may read. The key is shown
                      once.
                    </p>
                    {connections.map((c) => (
                      <label key={c.id}>
                        <input
                          type="checkbox"
                          checked={selectedAccounts.includes(c.id)}
                          onChange={(e) =>
                            setSelectedAccounts(
                              e.target.checked
                                ? [...selectedAccounts, c.id]
                                : selectedAccounts.filter((id) => id !== c.id),
                            )
                          }
                        />
                        {c.label}
                      </label>
                    ))}
                    <Button
                      className="secondary"
                      isDisabled={!selectedAccounts.length || !!busy}
                      onPress={() =>
                        void act("key", async () => {
                          const value = await api("/api/grants", "POST", {
                            label: "Personal client",
                            accounts: selectedAccounts,
                          });
                          setSecret(value.token);
                          await refresh();
                        })
                      }
                    >
                      Create access key
                    </Button>
                    {secret && (
                      <div className="copy-field">
                        <code>{secret}</code>
                        <Button
                          className="secondary"
                          onPress={() => void act("copy", () => copy(secret))}
                        >
                          Copy
                        </Button>
                      </div>
                    )}
                  </details>
                </>
              )}
              {tab === "Settings" && (
                <>
                  <section className="settings-card">
                    <ShieldCheck size={26} />
                    <h2>Your history is private.</h2>
                    <p>
                      Connecting an account does not authorize training or data
                      licensing.
                    </p>
                    <div className="setting-row">
                      <span>
                        <strong>OneConv model training</strong>
                        <small>No conversations are contributed.</small>
                      </span>
                      <span className="status neutral">Off</span>
                    </div>
                    <div className="setting-row">
                      <span>
                        <strong>Third-party data licensing</strong>
                        <small>No conversations are sold or licensed.</small>
                      </span>
                      <span className="status neutral">Off</span>
                    </div>
                    <p className="fine">
                      Contribution controls will become available when the full
                      consent and processing system is ready. They will be
                      optional.
                    </p>
                  </section>
                  <section className="settings-card">
                    <h2>Installation</h2>
                    <div className="setting-row">
                      <span>Account sign-in</span>
                      <span>
                        {config?.loginReady
                          ? "Configured"
                          : "Local workspace only"}
                      </span>
                    </div>
                    <div className="setting-row">
                      <span>Hosted provider login</span>
                      <span>
                        {config?.browserReady
                          ? "Configured · verification required"
                          : "Browser service not configured"}
                      </span>
                    </div>
                  </section>
                </>
              )}
            </div>
          </main>
        </div>
      )}
      {(error || notice) && (
        <div
          className={`toast ${error ? "error" : ""}`}
          role={error ? "alert" : "status"}
        >
          {error || notice}
          <Button
            aria-label="Dismiss notification"
            className="icon-button"
            onPress={() => {
              setError("");
              setNotice("");
            }}
          >
            <X size={16} />
          </Button>
        </div>
      )}
      <ModalOverlay
        isOpen={connect || !!login}
        onOpenChange={(open) => {
          if (!open) {
            setConnect(false);
            setLogin(null);
          }
        }}
        isDismissable
        className="overlay"
      >
        <Modal className="modal">
          <Dialog aria-label="Connect an AI account">
            {({ close }) => (
              <>
                <Button
                  className="icon-button modal-close"
                  aria-label="Close"
                  onPress={close}
                >
                  <X size={20} />
                </Button>
                <Mark small />
                <h2>
                  {login
                    ? "Your account, securely connected."
                    : "Where do you think?"}
                </h2>
                <p>
                  {login
                    ? "Open the provider’s login window, finish signing in, then come back here to verify access."
                    : "Connect your existing AI subscription. You’ll sign in directly with your provider."}
                </p>
                {login ? (
                  <>
                    <a
                      className="primary"
                      href={login.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open login window
                      <ExternalLink size={16} />
                    </a>
                    <Button
                      className="secondary"
                      isDisabled={!!busy}
                      onPress={() =>
                        void act("verify", async () => {
                          await api(
                            `/api/connections/${login.id}/verify`,
                            "POST",
                          );
                          await refresh();
                          setLogin(null);
                          setNotice("Connected. Your first import is queued.");
                        })
                      }
                    >
                      {busy === "verify" ? (
                        <LoaderCircle className="spin" size={17} />
                      ) : (
                        <Check size={17} />
                      )}
                      I’ve signed in · Verify connection
                    </Button>
                  </>
                ) : (
                  <>
                    {!config?.browserReady && (
                      <div className="inline-note">
                        Hosted login is not configured on this installation yet.
                        You can import this Mac’s saved history from
                        Connections.
                      </div>
                    )}
                    {["openai", "claude"].map((provider) => (
                      <Button
                        className="provider-choice"
                        key={provider}
                        isDisabled={!!busy || !config?.browserReady}
                        onPress={() =>
                          void act(provider, async () => {
                            setLogin(
                              await api("/api/connections", "POST", {
                                provider,
                              }),
                            );
                            setConnect(false);
                            await refresh();
                          })
                        }
                      >
                        <Provider name={provider} />
                        <span>
                          <strong>
                            {provider === "openai" ? "OpenAI" : "Claude"}
                          </strong>
                          <small>
                            {provider === "openai"
                              ? "ChatGPT and Codex"
                              : "Claude Chat and Cowork"}
                          </small>
                        </span>
                        <ArrowUpRight size={20} />
                      </Button>
                    ))}
                  </>
                )}
              </>
            )}
          </Dialog>
        </Modal>
      </ModalOverlay>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
