"use client";

import { useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { emailConfig } from "@/lib/emails/config";
import { renderEmail } from "@/lib/emails/templates";
import type { EmailSettings, Lead } from "@/lib/leads/types";
import { Icon, Rows, Section } from "./ui";

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
    <>
      <Section label="Personalise">
        <form action={saveAction} className="grid max-w-[68ch] gap-6">
          <label className="field">
            <span className="mono-label">Case study</span>
            <select name="caseStudyId" value={settings.caseStudyId} onChange={set("caseStudyId")} className="input">
              {emailConfig.caseStudies.map((cs) => (
                <option key={cs.id} value={cs.id}>
                  {cs.client === "TODO" ? cs.id : `${cs.client}: ${cs.result}`}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="mono-label">Company line</span>
            <textarea name="companyLine" rows={2} value={settings.companyLine} onChange={set("companyLine")} className="input" />
            <span className="hint">
              One line linking them to the case study, based on a real fact (a raise, a launch, their YC batch, a
              booking form answer). Under 20 words, no praise, no guesses. E.g. “Feels close to where you are right
              now, fresh off your seed round.” Leave empty to skip the line.
            </span>
          </label>
          <label className="field">
            <span className="mono-label">Closing question</span>
            <textarea name="question" rows={4} value={settings.question} onChange={set("question")} className="input" />
            <span className="hint">{"{company}"} becomes their business name.</span>
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSettings((s) => ({ ...s, question: emailConfig.discoveryQuestions.competitor }))}
              className="action"
            >
              Use competitor question
            </button>
            <button
              type="button"
              onClick={() => setSettings((s) => ({ ...s, question: emailConfig.discoveryQuestions.buyer }))}
              className="action"
            >
              Use buyer question
            </button>
          </div>
          <div className="grid gap-px sm:grid-cols-2">
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
      </Section>

      <Section label="Preview">
        <Rows
          flush
          rows={[
            ["To", to],
            ["Subject", <span key="subject" className="font-medium text-text">{rendered.subject}</span>],
          ]}
        />
        {/* Emails render on white like most mail apps. */}
        <iframe title="Email 1 preview" srcDoc={rendered.html} sandbox="" className="mt-6 block h-[640px] w-full border-0 bg-white" />
      </Section>
    </>
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
      className={primary ? "btn-primary" : "btn"}
    >
      {mine ? pendingLabel : label}
      {primary && <Icon name="send" />}
    </button>
  );
}
