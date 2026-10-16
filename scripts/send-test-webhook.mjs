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
      attendeePhoneNumber: { label: "Mobile number", value: "+91 98765 43210" },
      title: { label: "What is this meeting about?", value: "Website redesign and landing pages" },
      notes: { label: "Additional notes", value: "Looking to launch next month." },
      budget: { label: "Budget", value: "$2,000 - $5,000" },
      "x-twitter-link": { label: "X/Twitter link", value: "@testlead" },
      guests: { label: "Add guests", value: [] },
    },
  },
});

const headers = { "Content-Type": "application/json" };
if (secret) headers["x-cal-signature-256"] = createHmac("sha256", secret).update(body).digest("hex");

const res = await fetch(url, { method: "POST", headers, body });
console.log(res.status, await res.text());
