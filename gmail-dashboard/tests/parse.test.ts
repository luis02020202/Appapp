// Run with: npm test  (Node >= 22.18 strips TypeScript types natively)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decodeMimeWords,
  normalizeMessage,
  parseAddress,
  parseListUnsubscribe,
  rootDomainOf,
} from "../src/lib/gmail/parse.ts";

test("parseAddress handles common From formats", () => {
  assert.deepEqual(parseAddress('"Doe, John" <John.Doe@Example.com>'), { name: "Doe, John", email: "john.doe@example.com" });
  assert.deepEqual(parseAddress("Shop <news@mail.shop.co.uk>"), { name: "Shop", email: "news@mail.shop.co.uk" });
  assert.deepEqual(parseAddress("plain@example.org"), { name: null, email: "plain@example.org" });
  assert.deepEqual(parseAddress("plain@example.org (Plain Person)"), { name: "Plain Person", email: "plain@example.org" });
  assert.deepEqual(parseAddress("<only@example.org>"), { name: null, email: "only@example.org" });
  assert.deepEqual(parseAddress("Undisclosed recipients:;"), { name: null, email: null });
  assert.deepEqual(parseAddress(undefined), { name: null, email: null });
});

test("decodeMimeWords decodes RFC 2047 B and Q encodings", () => {
  assert.equal(decodeMimeWords("=?UTF-8?B?w4RyZ2VyIMO8YmVy?="), "Ärger über");
  assert.equal(decodeMimeWords("=?iso-8859-1?Q?Gr=FC=DFe_aus_K=F6ln?="), "Grüße aus Köln");
  assert.equal(decodeMimeWords("=?UTF-8?Q?a?= =?UTF-8?Q?b?="), "ab");
  assert.equal(decodeMimeWords("No encoding here"), "No encoding here");
  assert.deepEqual(parseAddress("=?UTF-8?Q?J=C3=BCrgen?= <j@example.de>"), { name: "Jürgen", email: "j@example.de" });
});

test("rootDomainOf groups subdomains", () => {
  assert.equal(rootDomainOf("mail.amazon.de"), "amazon.de");
  assert.equal(rootDomainOf("email.news.bbc.co.uk"), "bbc.co.uk");
  assert.equal(rootDomainOf("example.com"), "example.com");
  assert.equal(rootDomainOf(null), null);
});

test("parseListUnsubscribe extracts https, mailto and one-click", () => {
  const r = parseListUnsubscribe(
    "<mailto:unsub@list.example.com?subject=unsubscribe>, <https://example.com/u?id=1>",
    "List-Unsubscribe=One-Click",
  );
  assert.equal(r.available, true);
  assert.equal(r.url, "https://example.com/u?id=1");
  assert.equal(r.email, "unsub@list.example.com");
  assert.equal(r.mailto, "mailto:unsub@list.example.com?subject=unsubscribe");
  assert.equal(r.oneClick, true);
});

test("parseListUnsubscribe rejects invalid / unsafe URIs and http one-click", () => {
  assert.equal(parseListUnsubscribe("<javascript:alert(1)>").available, false);
  assert.equal(parseListUnsubscribe("<not a url>").available, false);
  assert.equal(parseListUnsubscribe(null).available, false);
  const http = parseListUnsubscribe("<http://example.com/u>", "List-Unsubscribe=One-Click");
  assert.equal(http.url, "http://example.com/u");
  assert.equal(http.oneClick, false); // RFC 8058 requires HTTPS
});

test("normalizeMessage maps Gmail metadata", () => {
  const n = normalizeMessage({
    id: "m1",
    threadId: "t1",
    labelIds: ["INBOX", "UNREAD", "CATEGORY_PROMOTIONS"],
    snippet: "Big sale",
    internalDate: "1700000000000",
    sizeEstimate: 12345,
    historyId: "999",
    payload: {
      headers: [
        { name: "From", value: "Deals <deals@news.shop.com>" },
        { name: "Subject", value: "=?UTF-8?B?U2FsZSDwn46J?=" },
        { name: "List-Id", value: "Shop Deals <deals.shop.com>" },
        { name: "List-Unsubscribe", value: "<https://shop.com/unsub>" },
        { name: "Precedence", value: "Bulk" },
      ],
    },
  });
  assert.equal(n.senderEmail, "deals@news.shop.com");
  assert.equal(n.senderDomain, "news.shop.com");
  assert.equal(n.senderRootDomain, "shop.com");
  assert.equal(n.subject, "Sale 🎉");
  assert.equal(n.receivedAt?.toISOString(), "2023-11-14T22:13:20.000Z");
  assert.equal(n.isUnread, true);
  assert.equal(n.isInInbox, true);
  assert.equal(n.gmailCategory, "promotions");
  assert.equal(n.listId, "deals.shop.com");
  assert.equal(n.precedence, "bulk");
  assert.equal(n.unsubscribeAvailable, true);
  assert.equal(n.unsubscribeOneClick, false);
});

test("normalizeMessage tolerates malformed messages", () => {
  const n = normalizeMessage({ id: "x", threadId: "x" });
  assert.equal(n.senderEmail, null);
  assert.equal(n.subject, null);
  assert.equal(n.receivedAt, null);
  assert.deepEqual(n.labelIds, []);
});
