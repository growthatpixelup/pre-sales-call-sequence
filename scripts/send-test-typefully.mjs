// Sends a signed, fake Typefully "draft.published" webhook to the local app, twice: the first
// should report "sent" (with DRY_RUN=true the Slack message is printed in the `next dev` terminal),
// the second "duplicate".
// Usage: node --env-file=.env.local scripts/send-test-typefully.mjs [url]
//   url defaults to http://localhost:3000/api/webhooks/typefully
//   signs with $TYPEFULLY_WEBHOOK_SECRET (must match the dev server's)
// Writes a row with external_id "test-<id>:x" to published_post_alerts; delete it afterwards with:
//   delete from published_post_alerts where external_id like 'test-%';
import { createHmac, randomUUID } from "node:crypto";

const url = process.argv[2] ?? "http://localhost:3000/api/webhooks/typefully";
const secret = process.env.TYPEFULLY_WEBHOOK_SECRET;
if (!secret) {
  console.error("Set TYPEFULLY_WEBHOOK_SECRET (any value, same as the dev server's).");
  process.exit(1);
}

const draftId = `test-${randomUUID().slice(0, 8)}`;
const body = JSON.stringify({
  event: "draft.published",
  data: {
    id: draftId,
    status: "published",
    preview: "Testing the post-is-live alert: this is a fake X post sent by scripts/send-test-typefully.mjs",
    x_published_url: "https://x.com/pixeluplabs/status/1234567890123456789",
    linkedin_published_url: null,
  },
});

async function send(label) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = "sha256=" + createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Typefully-Event": "draft.published",
      "X-Typefully-Timestamp": timestamp,
      "X-Typefully-Signature": signature,
    },
    body,
  });
  console.log(`${label}:`, res.status, await res.text());
}

await send("first send ");
await send("second send");
