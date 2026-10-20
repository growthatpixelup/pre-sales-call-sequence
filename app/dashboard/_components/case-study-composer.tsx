"use client";

import { useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { emailConfig } from "@/lib/emails/config";
import { renderEmail } from "@/lib/emails/templates";
import type { EmailSettings, Lead } from "@/lib/leads/types";

const INPUT =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950";

type Action = (formData: FormData) => void | Promise<void>;

/** Email 1's personalisation form with a live preview. "Send Email 1" saves and sends it. */
export function CaseStudyComposer({
  lead,
  initial,
  saveAction,
  sendAction,
  to,
}: {
  lead: Lead;
  initial: Required<Pick<EmailSettings, "caseStudyId" | "companyLine" | "question">>;
  saveAction: Action;
  sendAction: Action;
  /** Who it goes to (shows test mode). */
  to: string;
}) {
  const [settings, setSettings] = useState(initial);
  const [pressed, setPressed] = useState<"save" | "send" | null>(null);
  const set = (key: keyof typeof initial) => (e: { target: { value: string } }) =>
    setSettings((s) => ({ ...s, [key]: e.target.value }));

  const rendered = useMemo(
    () =>
      renderEmail("case_study", { ...lead, emailSettings: { ...lead.emailSettings, ...settings } }, { sendAt: new Date() }),
    [lead, settings],
  );

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form action={saveAction} className="space-y-4 self-start rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <label className="block space-y-1">
          <span className="text-sm font-medium">Case study</span>
          <select name="caseStudyId" value={settings.caseStudyId} onChange={set("caseStudyId")} className={INPUT}>
            {emailConfig.caseStudies.map((cs) => (
              <option key={cs.id} value={cs.id}>
                {cs.client === "TODO" ? cs.id : `${cs.client}: ${cs.result}`}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">Company line</span>
          <textarea name="companyLine" rows={2} value={settings.companyLine} onChange={set("companyLine")} className={INPUT} />
          <span className="block text-xs text-zinc-500 dark:text-zinc-400">
            One line linking them to the case study, based on a real fact (a raise, a launch, their YC batch, a
            booking form answer). Under 20 words, no praise, no guesses. E.g. “Feels close to where you are right
            now, fresh off your seed round.” Leave empty to skip the line.
          </span>
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">Closing question</span>
          <textarea name="question" rows={4} value={settings.question} onChange={set("question")} className={INPUT} />
          <span className="block text-xs text-zinc-500 dark:text-zinc-400">
            {"{company}"} becomes their business name.{" "}
            <button
              type="button"
              onClick={() => setSettings((s) => ({ ...s, question: emailConfig.discoveryQuestions.competitor }))}
              className="underline hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              Use competitor question
            </button>{" "}
            ·{" "}
            <button
              type="button"
              onClick={() => setSettings((s) => ({ ...s, question: emailConfig.discoveryQuestions.buyer }))}
              className="underline hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              Use buyer question
            </button>
          </span>
        </label>
        <div className="flex flex-wrap items-center gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <SubmitButton
            label="Save draft"
            pendingLabel="Saving…"
            pressed={pressed === "save"}
            onPress={() => setPressed("save")}
          />
          <SubmitButton
            label="Send Email 1"
            pendingLabel="Sending…"
            primary
            formAction={sendAction}
            confirmText={`Send Email 1 to ${to} now?`}
            pressed={pressed === "send"}
            onPress={() => setPressed("send")}
          />
        </div>
      </form>

      <div className="self-start overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <dl className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
          <div className="flex gap-3 px-4 py-2">
            <dt className="w-16 text-zinc-500 dark:text-zinc-400">To</dt>
            <dd className="break-all">{to}</dd>
          </div>
          <div className="flex gap-3 px-4 py-2">
            <dt className="w-16 text-zinc-500 dark:text-zinc-400">Subject</dt>
            <dd className="font-medium">{rendered.subject}</dd>
          </div>
        </dl>
        {/* Emails render on white like most mail apps. */}
        <iframe
          title="Email 1 preview"
          srcDoc={rendered.html}
          sandbox=""
          className="h-[560px] w-full border-t border-zinc-200 bg-white dark:border-zinc-800"
        />
      </div>
    </div>
  );
}

function SubmitButton({
  label,
  pendingLabel,
  primary = false,
  formAction,
  confirmText,
  pressed,
  onPress,
}: {
  label: string;
  pendingLabel: string;
  primary?: boolean;
  formAction?: Action;
  confirmText?: string;
  /** Whether this was the button that submitted the form. */
  pressed: boolean;
  onPress: () => void;
}) {
  const { pending } = useFormStatus();
  const mine = pending && pressed;
  return (
    <button
      type="submit"
      formAction={formAction}
      disabled={pending}
      onClick={(e) => {
        if (confirmText && !window.confirm(confirmText)) e.preventDefault();
        else onPress();
      }}
      className={
        primary
          ? "rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          : "rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
      }
    >
      {mine ? pendingLabel : label}
    </button>
  );
}
