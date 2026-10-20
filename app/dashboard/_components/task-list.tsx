import Link from "next/link";
import { STEP_LABELS } from "@/lib/emails/schedule";
import { linkedInMessage } from "@/lib/emails/templates";
import { formatDateTime } from "@/lib/format";
import type { Lead } from "@/lib/leads/types";
import type { Task, TaskKind } from "@/lib/tasks";
import { markLinkedInSent, scheduleEmails, sendEmailNow, skipLinkedIn } from "../actions";
import { CopyButton } from "./copy-button";
import { Icon, Tag } from "./ui";

const KIND_LABELS: Record<TaskKind, string> = {
  email: "Personalise email",
  linkedin: "LinkedIn note",
  failed: "Email failed",
  overdue: "Email overdue",
  unscheduled: "No emails planned",
};

/** A to-do list of tasks; urgent ones are flagged and highlighted. */
export function TaskList({ tasks }: { tasks: Task[] }) {
  return (
    <ul className="list">
      {tasks.map((task) => (
        <li key={task.key} className={task.urgent ? "item-picked" : undefined}>
          <div className="item">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                {task.urgent && <Tag>{urgentLabel(task)}</Tag>}
                <Tag tone="neutral">{KIND_LABELS[task.kind]}</Tag>
              </div>
              <Link href={`/dashboard/leads/${task.lead.id}`} className="item-title mt-3 inline-block">
                {task.lead.name}
              </Link>
              <p className="m-0 mt-1 text-[0.92rem] text-muted">
                {task.lead.businessName ? `${task.lead.businessName} · ` : ""}call {formatDateTime(task.lead.startTime)}
              </p>
              <Detail task={task} />
            </div>
            <div className="item-actions">
              <Actions task={task} />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function urgentLabel(task: Task) {
  if (task.kind === "failed" || task.kind === "overdue") return "Fix now";
  if (task.kind === "email" && task.email?.dueAt && Date.parse(task.email.dueAt) <= Date.now()) return "Past send time";
  return "Call within 24h";
}

function Detail({ task }: { task: Task }) {
  const { email } = task;
  switch (task.kind) {
    case "email":
      return (
        <p className="hint m-0 mt-2">
          {email && STEP_LABELS[email.step]}
          {email?.dueAt ? ` · best sent around ${formatDateTime(email.dueAt)}` : ""}
        </p>
      );
    case "linkedin":
      return <p className="preview m-0 mt-4 max-w-[60ch] !p-4 !text-base">{linkedInMessage(task.lead)}</p>;
    case "failed":
      return (
        <p className="hint m-0 mt-2">
          {email && STEP_LABELS[email.step]} · {email?.note ?? "Resend rejected it"}
        </p>
      );
    case "overdue":
      return (
        <p className="hint m-0 mt-2">
          {email && STEP_LABELS[email.step]} was due {email?.dueAt && formatDateTime(email.dueAt)}. If several are
          overdue, the email cron isn&apos;t running.
        </p>
      );
    case "unscheduled":
      return <p className="hint m-0 mt-2">Booked before the sequence existed, or scheduling failed.</p>;
  }
}

function Actions({ task }: { task: Task }) {
  const { lead, email } = task;
  switch (task.kind) {
    case "email":
      return (
        <Link href={`/dashboard/leads/${lead.id}/emails/${email!.step}`} className="action">
          Personalise &amp; send
        </Link>
      );
    case "linkedin":
      return (
        <>
          <CopyButton text={linkedInMessage(lead)} />
          <a href={linkedInSearch(lead)} target="_blank" rel="noopener noreferrer" className="action">
            Find
            <Icon name="external" />
          </a>
          <form action={markLinkedInSent.bind(null, lead.id)}>
            <button type="submit" className="action">
              Mark sent
            </button>
          </form>
          <form action={skipLinkedIn.bind(null, lead.id)}>
            <button type="submit" className="action" title="Not on LinkedIn, or not worth a note">
              Skip
            </button>
          </form>
        </>
      );
    case "failed":
      return (
        <form action={sendEmailNow.bind(null, lead.id, email!.step)}>
          <button type="submit" className="action">
            Retry
          </button>
        </form>
      );
    case "overdue":
      return (
        <Link href={`/dashboard/leads/${lead.id}`} className="action">
          Open lead
        </Link>
      );
    case "unscheduled":
      return (
        <form action={scheduleEmails.bind(null, lead.id)}>
          <button type="submit" className="action">
            Schedule sequence
          </button>
        </form>
      );
  }
}

function linkedInSearch(lead: Lead) {
  const keywords = [lead.name, lead.businessName].filter(Boolean).join(" ");
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(keywords)}`;
}
