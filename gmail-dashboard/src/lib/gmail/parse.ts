import type { GmailMessage } from "./types";

/**
 * Pure functions that turn Gmail metadata into normalized, storable fields.
 * Defensive by design: malformed headers produce nulls, never exceptions.
 */

export interface NormalizedMessage {
  threadId: string;
  senderName: string | null;
  senderEmail: string | null;
  senderDomain: string | null;
  senderRootDomain: string | null;
  subject: string | null;
  receivedAt: Date | null;
  snippet: string | null;
  sizeEstimate: number | null;
  labelIds: string[];
  isUnread: boolean;
  isStarred: boolean;
  isImportant: boolean;
  isInInbox: boolean;
  isSent: boolean;
  isDraft: boolean;
  gmailCategory: string | null;
  listId: string | null;
  precedence: string | null;
  autoSubmitted: string | null;
  unsubscribeAvailable: boolean;
  unsubscribeUrl: string | null;
  unsubscribeEmail: string | null;
  unsubscribeMailto: string | null;
  unsubscribeOneClick: boolean;
  gmailHistoryId: string | null;
}

const MAX_SUBJECT = 998; // RFC 5322 line limit
const MAX_URL = 2048;

export function headerMap(message: GmailMessage): Map<string, string> {
  const map = new Map<string, string>();
  for (const h of message.payload?.headers ?? []) {
    const key = h.name?.toLowerCase();
    if (key && !map.has(key) && typeof h.value === "string") map.set(key, h.value);
  }
  return map;
}

/** Decodes RFC 2047 encoded-words (=?charset?B|Q?...?=). Safe on plain text. */
export function decodeMimeWords(input: string): string {
  if (!input.includes("=?")) return input;
  const joined = input.replace(/(\?=)\s+(=\?)/g, "$1$2");
  return joined.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (whole, charset: string, enc: string, text: string) => {
    try {
      let bytes: Uint8Array;
      if (enc.toUpperCase() === "B") {
        bytes = Uint8Array.from(Buffer.from(text, "base64"));
      } else {
        const out: number[] = [];
        const s = text.replace(/_/g, " ");
        for (let i = 0; i < s.length; i++) {
          if (s[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3))) {
            out.push(parseInt(s.slice(i + 1, i + 3), 16));
            i += 2;
          } else {
            out.push(s.charCodeAt(i) & 0xff);
          }
        }
        bytes = Uint8Array.from(out);
      }
      const label = charset.split("*")[0].trim().toLowerCase();
      try {
        return new TextDecoder(label).decode(bytes);
      } catch {
        return new TextDecoder("utf-8").decode(bytes);
      }
    } catch {
      return whole;
    }
  });
}

const EMAIL_RE = /[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*/;

export function parseAddress(raw: string | undefined | null): { name: string | null; email: string | null } {
  if (!raw) return { name: null, email: null };
  const value = decodeMimeWords(raw).replace(/\s+/g, " ").trim();

  // "Display Name" <user@example.com>
  const angle = value.match(/^(.*?)<\s*([^<>]+?)\s*>/);
  if (angle) {
    const email = angle[2].match(EMAIL_RE)?.[0]?.toLowerCase() ?? null;
    return { name: cleanName(angle[1], email), email };
  }

  // user@example.com (Display Name)
  const email = value.match(EMAIL_RE)?.[0]?.toLowerCase() ?? null;
  const comment = value.match(/\(([^)]*)\)/)?.[1];
  return { name: cleanName(comment ?? "", email), email };
}

function cleanName(name: string, email: string | null): string | null {
  const cleaned = name
    .trim()
    .replace(/^"(.*)"$/, "$1")
    .replace(/\\(.)/g, "$1")
    .replace(/^'(.*)'$/, "$1")
    .trim();
  if (!cleaned || cleaned.toLowerCase() === email) return null;
  return cleaned.slice(0, 200);
}

export function domainOf(email: string | null): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const domain = email.slice(at + 1).replace(/\.$/, "").toLowerCase();
  return domain || null;
}

// Common multi-label public suffixes. Good enough for grouping senders; a full
// Public Suffix List can replace this without changing callers.
const MULTI_PART_SUFFIXES = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk", "ltd.uk", "plc.uk",
  "com.au", "net.au", "org.au", "edu.au", "gov.au",
  "co.nz", "org.nz", "ac.nz",
  "co.jp", "ne.jp", "or.jp", "ac.jp",
  "co.kr", "or.kr",
  "com.br", "com.mx", "com.ar", "com.co", "com.tr", "com.cn", "com.hk", "com.sg", "com.tw", "com.my",
  "co.in", "co.za", "co.il", "co.id", "co.th", "ac.at", "co.at", "or.at",
]);

export function rootDomainOf(domain: string | null): string | null {
  if (!domain) return null;
  const parts = domain.split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");
  const lastTwo = parts.slice(-2).join(".");
  return MULTI_PART_SUFFIXES.has(lastTwo) ? parts.slice(-3).join(".") : lastTwo;
}

export interface UnsubscribeInfo {
  available: boolean;
  url: string | null;
  email: string | null;
  mailto: string | null;
  oneClick: boolean;
}

/**
 * Parses List-Unsubscribe (RFC 2369) and List-Unsubscribe-Post (RFC 8058).
 * Only well-formed http(s) and mailto URIs are accepted. Nothing is fetched.
 */
export function parseListUnsubscribe(header?: string | null, postHeader?: string | null): UnsubscribeInfo {
  const none: UnsubscribeInfo = { available: false, url: null, email: null, mailto: null, oneClick: false };
  if (!header) return none;

  let httpsUrl: string | null = null;
  let httpUrl: string | null = null;
  let mailto: string | null = null;
  let email: string | null = null;

  for (const match of header.matchAll(/<([^>]+)>/g)) {
    const candidate = match[1].replace(/\s+/g, "").trim();
    if (!candidate || candidate.length > MAX_URL) continue;
    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      continue; // invalid URI — ignore
    }
    if (parsed.protocol === "mailto:" && !mailto) {
      const address = decodeURIComponent(parsed.pathname).match(EMAIL_RE)?.[0]?.toLowerCase();
      if (address) {
        mailto = candidate;
        email = address;
      }
    } else if (parsed.protocol === "https:" && !httpsUrl && parsed.hostname) {
      httpsUrl = parsed.toString();
    } else if (parsed.protocol === "http:" && !httpUrl && parsed.hostname) {
      httpUrl = parsed.toString();
    }
  }

  const url = httpsUrl ?? httpUrl;
  // RFC 8058 one-click requires an HTTPS URI plus the exact POST body key.
  const oneClick = Boolean(httpsUrl) && /List-Unsubscribe\s*=\s*One-Click/i.test(postHeader ?? "");
  return { available: Boolean(url || mailto), url, email, mailto, oneClick };
}

function parseListId(value?: string): string | null {
  if (!value) return null;
  const inner = value.match(/<([^>]+)>/)?.[1] ?? value;
  return inner.trim().toLowerCase().slice(0, 255) || null;
}

function parseReceivedAt(message: GmailMessage, dateHeader?: string): Date | null {
  const internal = Number(message.internalDate);
  if (Number.isFinite(internal) && internal > 0) return new Date(internal);
  if (dateHeader) {
    const d = new Date(dateHeader);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

export function normalizeMessage(message: GmailMessage): NormalizedMessage {
  const h = headerMap(message);
  const from = parseAddress(h.get("from") ?? h.get("sender"));
  const domain = domainOf(from.email);
  const labels = Array.from(new Set(message.labelIds ?? []));
  const has = (l: string) => labels.includes(l);
  const category = labels.find((l) => l.startsWith("CATEGORY_"));
  const unsub = parseListUnsubscribe(h.get("list-unsubscribe"), h.get("list-unsubscribe-post"));
  const subject = h.get("subject");

  return {
    threadId: message.threadId,
    senderName: from.name,
    senderEmail: from.email,
    senderDomain: domain,
    senderRootDomain: rootDomainOf(domain),
    subject: subject !== undefined ? decodeMimeWords(subject).trim().slice(0, MAX_SUBJECT) : null,
    receivedAt: parseReceivedAt(message, h.get("date")),
    snippet: message.snippet ? message.snippet.slice(0, 500) : null,
    sizeEstimate: typeof message.sizeEstimate === "number" ? message.sizeEstimate : null,
    labelIds: labels,
    isUnread: has("UNREAD"),
    isStarred: has("STARRED"),
    isImportant: has("IMPORTANT"),
    isInInbox: has("INBOX"),
    isSent: has("SENT"),
    isDraft: has("DRAFT"),
    gmailCategory: category ? category.slice("CATEGORY_".length).toLowerCase() : null,
    listId: parseListId(h.get("list-id")),
    precedence: h.get("precedence")?.trim().toLowerCase().slice(0, 50) ?? null,
    autoSubmitted: h.get("auto-submitted")?.trim().toLowerCase().slice(0, 50) ?? null,
    unsubscribeAvailable: unsub.available,
    unsubscribeUrl: unsub.url,
    unsubscribeEmail: unsub.email,
    unsubscribeMailto: unsub.mailto,
    unsubscribeOneClick: unsub.oneClick,
    gmailHistoryId: message.historyId ?? null,
  };
}

/** Derived boolean flags from a label set (used when applying history deltas). */
export function flagsFromLabels(labels: string[]) {
  const has = (l: string) => labels.includes(l);
  const category = labels.find((l) => l.startsWith("CATEGORY_"));
  return {
    isUnread: has("UNREAD"),
    isStarred: has("STARRED"),
    isImportant: has("IMPORTANT"),
    isInInbox: has("INBOX"),
    isSent: has("SENT"),
    isDraft: has("DRAFT"),
    gmailCategory: category ? category.slice("CATEGORY_".length).toLowerCase() : null,
  };
}

/** Messages in Trash/Spam are outside the synced scope (includeSpamTrash=false). */
export function outOfScopeReason(labels: string[]): "trash" | "spam" | null {
  if (labels.includes("TRASH")) return "trash";
  if (labels.includes("SPAM")) return "spam";
  return null;
}
