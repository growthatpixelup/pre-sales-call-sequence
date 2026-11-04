import type { Metadata } from "next";
import { DEAL_TYPES, DEAL_TYPE_LABELS, ORIGINS, ORIGIN_LABELS } from "@/lib/leads/types";
import { Page, RailIntro, Section } from "@/app/dashboard/_components/ui";
import { addLead } from "../actions";

export const metadata: Metadata = { title: "Add a lead · GTM OS" };

/**
 * Quick add for a two-way conversation that no feed brings in yet: a DM reply, an email, a
 * directory inquiry. If they're already in the pipeline, that lead opens instead.
 */
export default function NewLeadPage() {
  return (
    <Page
      rail={
        <RailIntro
          title="Add a lead"
          sub="For a reply, DM or email that no feed brings in yet. If they match an open lead on email, LinkedIn or company domain, that lead opens instead."
          back={{ href: "/dashboard/pipeline", label: "Pipeline" }}
        />
      }
    >
      <Section label="Lead">
        <form action={addLead} className="form-grid">
          <label className="field">
            <span className="mono-label">Contact</span>
            <input name="contactName" className="input" autoFocus />
          </label>
          <label className="field">
            <span className="mono-label">Company</span>
            <input name="company" className="input" />
          </label>
          <label className="field">
            <span className="mono-label">Email</span>
            <input name="email" type="email" className="input" />
          </label>
          <label className="field">
            <span className="mono-label">LinkedIn URL</span>
            <input name="linkedinUrl" className="input" />
          </label>
          <label className="field">
            <span className="mono-label">Website</span>
            <input name="website" className="input" placeholder="For matching on domain" />
          </label>
          <label className="field">
            <span className="mono-label">Role</span>
            <input name="role" className="input" />
          </label>
          <label className="field">
            <span className="mono-label">Source</span>
            <select name="origin" required defaultValue="" className="input">
              <option value="" disabled>
                Where did they come from?
              </option>
              {ORIGINS.map((o) => (
                <option key={o} value={o}>
                  {ORIGIN_LABELS[o]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="mono-label">Sub-source</span>
            <input name="originDetail" className="input" placeholder="Account, campaign, referrer, job" />
          </label>
          <label className="field">
            <span className="mono-label">Deal type</span>
            <select name="dealType" defaultValue="project" className="input">
              {DEAL_TYPES.map((d) => (
                <option key={d} value={d}>
                  {DEAL_TYPE_LABELS[d]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="mono-label">Owner</span>
            <input name="owner" className="input" placeholder="e.g. Daksh" />
          </label>
          <label className="field form-wide">
            <span className="mono-label">First touch</span>
            <textarea
              name="firstTouch"
              rows={3}
              className="input"
              placeholder="e.g. Replied to our LinkedIn DM asking about pricing"
            />
          </label>
          <div className="form-wide">
            <button type="submit" className="btn-primary">
              Add to pipeline
            </button>
          </div>
        </form>
      </Section>
    </Page>
  );
}
