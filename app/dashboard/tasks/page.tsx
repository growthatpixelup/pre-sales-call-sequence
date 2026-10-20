import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { loadTasks, type Task, type TaskKind } from "@/lib/tasks";
import { TaskList } from "../_components/task-list";
import { Empty, Icon, Page, PageSkeleton, RailActions, RailIntro, Rows, Section } from "../_components/ui";

export const metadata: Metadata = { title: "Tasks · Dashboard" };

const TITLE = "Tasks";
const SUB = "What to do before each call: emails to personalise, LinkedIn notes to send, and anything stuck.";

export default function TasksPage() {
  return (
    <Suspense fallback={<PageSkeleton title={TITLE} sub={SUB} label="Loading tasks" />}>
      <Tasks />
    </Suspense>
  );
}

async function Tasks() {
  // Which calls are upcoming depends on the current time.
  await connection();
  const { tasks } = await loadTasks(new Date());
  const of = (...kinds: TaskKind[]) => tasks.filter((t) => kinds.includes(t.kind));
  const emails = of("email");
  const linkedin = of("linkedin");
  const problems = of("failed", "overdue", "unscheduled");
  const urgent = tasks.filter((t) => t.urgent);
  const next = urgent[0] ?? tasks[0];

  return (
    <Page
      rail={
        <>
          <RailIntro title={TITLE} sub={SUB} />
          <Rows
            rows={[
              ["Urgent", <Count key="urgent" n={urgent.length} />],
              ["Emails", <Count key="emails" n={emails.length} />],
              ["LinkedIn", <Count key="linkedin" n={linkedin.length} />],
              ["Stuck", <Count key="stuck" n={problems.length} />],
            ]}
          />
          {next && (
            <RailActions>
              <Link href={nextHref(next)} className="btn-primary">
                {next.kind === "email" ? "Personalise next email" : `Open ${next.lead.name.split(" ")[0]}`}
                <Icon name="next" />
              </Link>
            </RailActions>
          )}
        </>
      }
    >
      <Section label={`Emails to personalise · ${emails.length}`}>
        {emails.length ? <TaskList tasks={emails} /> : <Empty>No emails waiting on you.</Empty>}
      </Section>
      <Section label={`LinkedIn notes to send · ${linkedin.length}`}>
        {linkedin.length ? (
          <TaskList tasks={linkedin} />
        ) : (
          <Empty>Every upcoming call has had its LinkedIn note.</Empty>
        )}
      </Section>
      {problems.length > 0 && (
        <Section label={`Stuck emails · ${problems.length}`}>
          <TaskList tasks={problems} />
        </Section>
      )}
    </Page>
  );
}

function nextHref(task: Task) {
  return task.kind === "email" && task.email
    ? `/dashboard/leads/${task.lead.id}/emails/${task.email.step}`
    : `/dashboard/leads/${task.lead.id}`;
}

function Count({ n }: { n: number }) {
  return <span className={`tabular-nums ${n ? "" : "text-hint"}`}>{n}</span>;
}
