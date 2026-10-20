import { Resend } from "resend";
import { matchLead, parseAddress, saveReply } from "@/lib/emails/replies";
import { addLeadEvent } from "@/lib/leads/store";

/**
 * Replies to the sequence. Resend receives them (EMAIL_REPLY_TO is an address on a Resend
 * receiving domain) and sends an `email.received` event here. Each reply is saved against its
 * lead and, if REPLY_FORWARD_TO is set, forwarded there so it still lands in your inbox.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  const resend = new Resend(process.env.RESEND_API_KEY);

  let event: { type: string; data: Record<string, unknown> };
  if (secret) {
    try {
      event = resend.webhooks.verify({
        payload: rawBody,
        headers: {
          id: request.headers.get("svix-id") ?? "",
          timestamp: request.headers.get("svix-timestamp") ?? "",
          signature: request.headers.get("svix-signature") ?? "",
        },
        webhookSecret: secret,
      }) as unknown as typeof event;
    } catch {
      return Response.json({ error: "Invalid signature" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    return Response.json({ error: "RESEND_WEBHOOK_SECRET is not configured" }, { status: 500 });
  } else {
    try {
      event = JSON.parse(rawBody);
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }
  }

  if (event.type !== "email.received") return Response.json({ ok: true });

  const emailId = String(event.data.email_id ?? "");
  if (!emailId) return Response.json({ error: "Missing email_id" }, { status: 400 });

  // The event only has the headers; the body is fetched separately.
  const { data: email, error } = await resend.emails.receiving.get(emailId);
  if (error || !email) {
    // A 500 makes Resend retry later.
    return Response.json({ error: error?.message ?? "Could not load email" }, { status: 500 });
  }

  const from = parseAddress(email.from);
  const leadId = await matchLead(from.email, email.subject ?? "");
  const saved = await saveReply({
    resendEmailId: emailId,
    leadId,
    fromEmail: from.email,
    fromName: from.name,
    subject: email.subject ?? "",
    text: email.text,
    html: email.html,
    receivedAt: email.created_at,
  });
  if (!saved) return Response.json({ ok: true, duplicate: true });

  if (leadId) await addLeadEvent(leadId, "replied", email.subject || undefined);

  const forwardTo = process.env.REPLY_FORWARD_TO;
  if (forwardTo && process.env.EMAIL_FROM) {
    const forwarded = await resend.emails.receiving.forward(
      { emailId, to: forwardTo, from: process.env.EMAIL_FROM },
      { idempotencyKey: `forward-reply-${emailId}` },
    );
    // The reply is saved either way; a failed forward is only logged so it isn't saved twice.
    if (forwarded.error) console.error("[resend webhook] forwarding reply failed:", forwarded.error.message);
  }

  return Response.json({ ok: true });
}
