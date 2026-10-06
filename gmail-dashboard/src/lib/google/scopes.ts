/**
 * OAuth scopes. We start with read-only access and only request gmail.modify
 * when the user explicitly enables cleanup features.
 *
 * gmail.modify allows archive / label / mark read / move to Trash, but NOT
 * permanent deletion (that needs the full https://mail.google.com/ scope,
 * which this app never requests). Permanent deletion is therefore impossible
 * by construction.
 */
export const GMAIL_READONLY = "https://www.googleapis.com/auth/gmail.readonly";
export const GMAIL_MODIFY = "https://www.googleapis.com/auth/gmail.modify";

export type AccessMode = "readonly" | "modify";

export function scopesFor(mode: AccessMode): string[] {
  return mode === "modify" ? [GMAIL_READONLY, GMAIL_MODIFY] : [GMAIL_READONLY];
}

export function parseScopes(scopes: string | null | undefined): string[] {
  return (scopes ?? "").split(/\s+/).filter(Boolean);
}

export function canRead(scopes: string[]): boolean {
  return scopes.includes(GMAIL_READONLY) || scopes.includes(GMAIL_MODIFY);
}

export function canModify(scopes: string[]): boolean {
  return scopes.includes(GMAIL_MODIFY);
}

export const SCOPE_LABELS: Record<string, string> = {
  [GMAIL_READONLY]: "Read Gmail (gmail.readonly)",
  [GMAIL_MODIFY]: "Modify Gmail — archive, label, trash (gmail.modify)",
};
