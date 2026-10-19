import type { EmailSettings, Lead } from "@/lib/leads/types";
import { emailConfig } from "./config";
import { isDayBefore, type EmailStep } from "./schedule";
import { formatDayDate, formatTime, formatWeekday, formatZoneShort, safeTimeZone } from "./time";

/**
 * Email copy, from "PIXELUP LABS Pre-Call Sequences" (9 Oct 2026). Each template returns a subject
 * and a list of blocks; `renderEmail` turns those into matching HTML and plain-text bodies. Kept as
 * simple personal-looking emails (no images or heavy styling), which reads better and lands in the inbox.
 */

type Inline = string | { href: string; text?: string };
type Block = { p: Inline[] } | { ul: Inline[][] };

export interface EmailContext {
  /** When the email is being sent (Email 3 says "today" or "tomorrow" based on this). */
  sendAt: Date;
  /** Two open slots for the no-show email, if they could be looked up. */
  slots?: Date[];
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const link = (href: string, text?: string): Inline => ({ href, text });

function firstName(lead: Lead) {
  return lead.name.trim().split(/\s+/)[0] || "there";
}

/** Mail providers whose domain says nothing about the lead's company. */
const PERSONAL_DOMAINS = new Set([
  "gmail", "googlemail", "yahoo", "ymail", "hotmail", "outlook", "live", "msn", "icloud", "me", "mac",
  "aol", "proton", "protonmail", "pm", "gmx", "zoho", "yandex", "mail", "rediffmail", "fastmail", "hey",
]);

/** Business name from the booking form, else the name from their email domain ("acme.io" → "Acme"). */
function companyName(lead: Lead) {
  if (lead.businessName?.trim()) return lead.businessName.trim();
  const label = lead.email.split("@")[1]?.toLowerCase().split(".")[0];
  if (!label || PERSONAL_DOMAINS.has(label)) return "your company";
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Sign-off, with an optional closing line directly above the name ("Talk soon,"). */
function signature(closing?: string, { withCompany = false } = {}): Block {
  const name = withCompany ? `${emailConfig.senderName} @ ${emailConfig.company}` : emailConfig.senderName;
  return { p: [closing ? `${closing}\n${name}` : name] };
}

function callLink(lead: Lead): Inline {
  return lead.meetingUrl ? link(lead.meetingUrl) : "the link in your calendar invite";
}

function rescheduleLink(lead: Lead) {
  return `https://app.cal.com/reschedule/${encodeURIComponent(lead.id)}`;
}

function caseStudy(lead: Lead) {
  const { caseStudies } = emailConfig;
  return caseStudies.find((c) => c.id === lead.emailSettings.caseStudyId) ?? caseStudies[0];
}

/** What each email uses when the lead has no personalisation set. */
export function defaultEmailSettings(): Required<EmailSettings> {
  return {
    caseStudyId: emailConfig.caseStudies[0].id,
    companyLine: "",
    question: emailConfig.discoveryQuestions.competitor,
    team: emailConfig.team.map((m) => (m.role ? `${m.name} (${m.role})` : m.name)).join(", "),
  };
}

const teamLine = (lead: Lead) => lead.emailSettings.team || defaultEmailSettings().team;

function discoveryQuestion(lead: Lead) {
  const question = lead.emailSettings.question || defaultEmailSettings().question;
  return question.replaceAll("{company}", companyName(lead));
}

/** The LinkedIn connect note from the sequence (sent by hand, same day as booking). */
export function linkedInMessage(lead: Lead) {
  const day = formatWeekday(new Date(lead.startTime), safeTimeZone(lead.timeZone));
  return `Hey ${firstName(lead)}, excited for our chat on ${day}. Figured I'd connect here too.`;
}

const TEMPLATES: Record<EmailStep, (lead: Lead, ctx: EmailContext) => { subject: string; blocks: Block[] }> = {
  confirmation(lead) {
    const tz = safeTimeZone(lead.timeZone);
    const start = new Date(lead.startTime);
    const { name, link: href } = emailConfig.confirmationCaseStudy;
    return {
      subject: `see you ${formatWeekday(start, tz)} at ${formatTime(start, tz)}`,
      blocks: [
        { p: [`Hey ${firstName(lead)},`] },
        {
          p: [
            `Thanks for grabbing a slot. We're locked in for ${formatDayDate(start, tz)} at ${formatTime(start, tz)} (${formatZoneShort(start, tz)}).`,
          ],
        },
        { p: ["Call link: ", callLink(lead)] },
        { p: ["Got some free time before then? Here's one of our recent brand uplift breakdowns: ", link(href, name)] },
        signature("Talk soon,", { withCompany: true }),
      ],
    };
  },

  case_study(lead) {
    const cs = caseStudy(lead);
    const companyLine = lead.emailSettings.companyLine?.trim();
    return {
      subject: `how we helped ${cs.client} ${cs.result}`,
      blocks: [
        { p: [`Hey ${firstName(lead)},`] },
        { p: ["Thought you'd like this one. It's a brand uplift we nailed in your territory."] },
        { p: [`${cs.client} is ${cs.description}. They came to us because ${cs.problem}.`] },
        { p: [`We ${cs.whatWeDid}`] },
        ...(companyLine ? [{ p: [companyLine] }] : []),
        { p: ["Full case study: ", link(cs.link, cs.client)] },
        { p: ["What our clients say: ", link(emailConfig.reviews.link, emailConfig.reviews.name)] },
        { p: [discoveryQuestion(lead)] },
        signature(undefined, { withCompany: true }),
      ],
    };
  },

  how_we_work(lead) {
    const p = emailConfig.process;
    return {
      subject: "what working with us actually looks like",
      blocks: [
        { p: [`Hey ${firstName(lead)},`] },
        { p: [`Here's a TLDR of our process at ${emailConfig.company}:`] },
        {
          ul: [
            ["Call: we get to know your product and goals."],
            ["Proposal: scope, timeline, and price, all in writing."],
            ["Kickoff + brand workshop: we figure out your brand strategy and marketing goals together."],
            [`Exploration: you pick from ${p.directions} directions. We lock one before we go deep.`],
            ["Production: we design it, then build it. Or we hand your devs files ready to ship."],
            [`Launch: we ship it and stick around for ${p.supportPeriod}.`],
            [`Timeline: ${p.brandWeeks} weeks for brand, ${p.brandAndWebsiteWeeks} for brand + website. Locked in writing at kickoff.`],
            ["Scope changes: we price them before we start. No surprise invoices."],
          ],
        },
        signature(),
      ],
    };
  },

  what_to_expect(lead, ctx) {
    const tz = safeTimeZone(lead.timeZone);
    const start = new Date(lead.startTime);
    const tomorrow = isDayBefore(ctx.sendAt, lead);
    const when = tomorrow ? "tomorrow" : "today";
    return {
      subject: `what to expect on ${when}'s call`,
      blocks: [
        { p: [`Hey ${firstName(lead)},`] },
        { p: [`Quick rundown for ${when}:`] },
        { p: [`Who's joining: ${teamLine(lead)}`] },
        { p: ["Here's the run of show:"] },
        {
          ul: [
            ["The brand–product gap: why now, and where your brand undersells your product."],
            ["Buyer and competitor map: your buyers, competitors, and why you win."],
            ["Our playbook: our process, start to finish."],
            ["Scope and investment: timeline, ballpark price, start date."],
          ],
        },
        { p: ["Any doubts or questions before we chat? Hit reply."] },
        signature(`See you ${tomorrow ? "tomorrow " : ""}at ${formatTime(start, tz)},`),
      ],
    };
  },

  reminder_1h(lead) {
    const tz = safeTimeZone(lead.timeZone);
    const start = new Date(lead.startTime);
    return {
      subject: "see you in an hour",
      blocks: [
        { p: [`Hey ${firstName(lead)},`] },
        { p: [`We're on at ${formatTime(start, tz)} ${formatZoneShort(start, tz)}.`] },
        { p: ["Call link: ", callLink(lead)] },
        signature(),
      ],
    };
  },

  no_show(lead, ctx) {
    const tz = safeTimeZone(lead.timeZone);
    const [a, b] = ctx.slots ?? [];
    const alternatives: Inline[] =
      a && b
        ? [
            `If now's not great, does ${formatWeekday(a, tz)} at ${formatTime(a, tz)} or ${formatWeekday(b, tz)} at ${formatTime(b, tz)} work better?`,
          ]
        : ["If now's not great, pick a new time here: ", link(rescheduleLink(lead))];
    return {
      subject: "we're on the call",
      blocks: [
        { p: [`Hey ${firstName(lead)},`] },
        { p: ["We're in the call now: ", callLink(lead)] },
        { p: alternatives },
        signature(),
      ],
    };
  },
};

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function inlineHtml(parts: Inline[]) {
  return parts
    .map((part) =>
      typeof part === "string"
        ? escapeHtml(part).replaceAll("\n", "<br>")
        : `<a href="${escapeHtml(part.href)}" style="color:#2563eb">${escapeHtml(part.text ?? part.href)}</a>`,
    )
    .join("");
}

function inlineText(parts: Inline[]) {
  return parts
    .map((part) => (typeof part === "string" ? part : part.text ? `${part.text} (${part.href})` : part.href))
    .join("");
}

export function renderEmail(step: EmailStep, lead: Lead, ctx: EmailContext): RenderedEmail {
  const { subject, blocks } = TEMPLATES[step](lead, ctx);

  const html = blocks
    .map((block) =>
      "p" in block
        ? `<p style="margin:0 0 16px">${inlineHtml(block.p)}</p>`
        : `<ul style="margin:0 0 16px;padding-left:20px">${block.ul
            .map((item) => `<li style="margin:0 0 6px">${inlineHtml(item)}</li>`)
            .join("")}</ul>`,
    )
    .join("\n");

  const text = blocks
    .map((block) => ("p" in block ? inlineText(block.p) : block.ul.map((i) => `• ${inlineText(i)}`).join("\n")))
    .join("\n\n");

  return {
    subject,
    html: `<!doctype html><html><body style="margin:0;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#18181b"><div style="max-width:560px">${html}</div></body></html>`,
    text,
  };
}
