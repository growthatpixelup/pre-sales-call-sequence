// Sends a fake, signed Cal.com BOOKING_CREATED webhook to the local app.
// Usage: node scripts/send-test-webhook.mjs [url] [secret]
//   url defaults to http://localhost:3000/api/webhooks/cal
//   secret defaults to $CAL_WEBHOOK_SECRET (leave both unset to skip signing in dev)
import { createHmac, randomUUID } from "node:crypto";

const url = process.argv[2] ?? "http://localhost:3000/api/webhooks/cal";
const secret = process.argv[3] ?? process.env.CAL_WEBHOOK_SECRET ?? "";

const start = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
start.setMinutes(0, 0, 0);
const end = new Date(start.getTime() + 30 * 60 * 1000);

const body = JSON.stringify({
  triggerEvent: "BOOKING_CREATED",
  createdAt: new Date().toISOString(),
  payload: {
    uid: randomUUID(),
    title: "Discovery call between You and Test Lead",
    type: "discovery-call",
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    status: "ACCEPTED",
    location: "integrations:daily",
    metadata: { videoCallUrl: "https://app.cal.com/video/test" },
    organizer: { name: "You", email: "you@example.com", timeZone: "Asia/Kolkata" },
    attendees: [{ name: "Test Lead", email: "test.lead@example.com", timeZone: "Asia/Kolkata" }],
    responses: {
      name: { label: "Your name", value: "Test Lead" },
      email: { label: "Email address", value: "test.lead@example.com" },
      "Business-Name": { label: "Business Name", value: "Acme Labs" },
      "Business-Website": { label: "Business Website", value: "acmelabs.io" },
      "What-problem-are-you-looking-to-solve": {
        label: "What problem are you looking to solve?",
        value: "Our landing page doesn't convert paid traffic.",
      },
      "Why-did-you-book-this-call": { label: "Why did you book this call?", value: "Saw your case studies." },
      "How-much-capital-have-you-raised": { label: "How much capital have you raised?", value: "$1M seed" },
      "What-is-your-expected-investment-range-for-this-project": {
        label: "What is your expected investment range for this project?",
        value: "$5,000 - $10,000",
      },
      "How-did-you-find-us": { label: "How did you find us?", value: "X / Twitter" },
      guests: { label: "Add guests", value: [] },
    },
  },
});

const headers = { "Content-Type": "application/json" };
if (secret) headers["x-cal-signature-256"] = createHmac("sha256", secret).update(body).digest("hex");

const res = await fetch(url, { method: "POST", headers, body });
console.log(res.status, await res.text());
