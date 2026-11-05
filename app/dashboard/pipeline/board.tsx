"use client";

import Link from "next/link";
import { useOptimistic, useRef, useState, useTransition, type DragEvent } from "react";
import { EXIT_STAGES, STAGE_LABELS, type Stage } from "@/lib/leads/types";
import { moveStage } from "@/app/dashboard/leads/actions";

export interface BoardCard {
  id: string;
  name: string;
  company: string | null;
  stage: Stage;
  /** "$12,000" or "$12,000 est.", or null. */
  value: string | null;
  owner: string | null;
  origin: string;
  audit: boolean;
  nextAction: string | null;
  /** Formatted due date, and whether it's past. */
  due: { label: string; overdue: boolean } | null;
  daysInStage: number | null;
}

export interface BoardColumn {
  stage: Stage;
  /** "est $40k · closed $12k". */
  totals: string;
  /** Leads in this stage not shown as cards (the column shows the most recent ones). */
  more?: number;
}

type Move = { id: string; stage: Stage };

/**
 * Kanban by stage. Drag a card to another column to move it; Lost and Nurture ask for a reason
 * first. Moves show at once and roll back if the server refuses them.
 */
export function PipelineBoard({ columns, cards, showExits }: { columns: BoardColumn[]; cards: BoardCard[]; showExits: boolean }) {
  const [optimistic, applyMove] = useOptimistic(cards, (state, move: Move) =>
    state.map((c) => (c.id === move.id ? { ...c, stage: move.stage } : c)),
  );
  const [pending, startTransition] = useTransition();
  const [movingId, setMovingId] = useState<string | null>(null);
  const [over, setOver] = useState<Stage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exitMove, setExitMove] = useState<Move | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  function move(next: Move, reason?: string) {
    setError(null);
    setMovingId(next.id);
    startTransition(async () => {
      applyMove(next);
      const result = await moveStage(next.id, next.stage, reason);
      if (!result.ok) setError(result.error);
      setMovingId(null);
    });
  }

  function onDrop(e: DragEvent, stage: Stage) {
    e.preventDefault();
    setOver(null);
    const id = e.dataTransfer.getData("text/lead-id");
    const card = optimistic.find((c) => c.id === id);
    if (!card || card.stage === stage) return;
    if (EXIT_STAGES.includes(stage)) {
      setExitMove({ id, stage });
      dialog.current?.showModal();
      return;
    }
    move({ id, stage });
  }

  const exitCard = exitMove ? optimistic.find((c) => c.id === exitMove.id) : null;

  return (
    <>
      {error && (
        <div className="callout mx-[30px] my-4" role="alert">
          <strong>Couldn&apos;t move that lead.</strong> {error}
        </div>
      )}
      <div className="board" aria-busy={pending}>
        {columns.map((col) => {
          const inCol = optimistic.filter((c) => c.stage === col.stage);
          const exit = EXIT_STAGES.includes(col.stage);
          return (
            <section
              key={col.stage}
              className="board-col"
              data-exit={exit}
              data-over={over === col.stage}
              aria-label={STAGE_LABELS[col.stage]}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (over !== col.stage) setOver(col.stage);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null);
              }}
              onDrop={(e) => onDrop(e, col.stage)}
            >
              <header className="board-col-head">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="mono-label m-0 text-text">{STAGE_LABELS[col.stage]}</h2>
                  <span className="font-mono text-[0.78rem] tabular-nums text-muted">{inCol.length + (col.more ?? 0)}</span>
                </div>
                {col.totals && <p className="hint m-0 mt-1 tabular-nums">{col.totals}</p>}
              </header>
              <div className="board-cards">
                {exit && !showExits ? (
                  <p className="hint m-0 p-1">Drop here{inCol.length ? `. ${inCol.length} hidden` : ""}.</p>
                ) : (
                  <>
                    {inCol.map((card) => (
                      <Card key={card.id} card={card} pending={movingId === card.id} />
                    ))}
                    {col.more ? <p className="hint m-0 p-1">+{col.more} older. Narrow the period or search to see them.</p> : null}
                  </>
                )}
              </div>
            </section>
          );
        })}
      </div>

      <dialog
        ref={dialog}
        className="dialog m-auto"
        aria-labelledby="exit-title"
        onClose={() => setExitMove(null)}
      >
        {exitMove && (
          <form
            method="dialog"
            onSubmit={(e) => {
              const reason = String(new FormData(e.currentTarget).get("reason") ?? "").trim();
              if (!reason) {
                e.preventDefault();
                return;
              }
              move(exitMove, reason);
            }}
            className="grid gap-5"
          >
            <h2 id="exit-title" className="h3">
              Move {exitCard?.name ?? "lead"} to {STAGE_LABELS[exitMove.stage]}
            </h2>
            <label className="field">
              <span className="mono-label">Reason</span>
              <input
                name="reason"
                required
                autoFocus
                placeholder={exitMove.stage === "lost" ? "e.g. Went with another agency" : "e.g. Revisit after their raise"}
                className="input"
              />
            </label>
            <div className="flex gap-2">
              <button type="submit" className="btn-primary">
                Move
              </button>
              <button type="button" className="btn" onClick={() => dialog.current?.close()}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}

function Card({ card, pending }: { card: BoardCard; pending: boolean }) {
  return (
    <Link
      href={`/dashboard/leads/${card.id}`}
      className="board-card"
      data-pending={pending}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/lead-id", card.id);
        e.dataTransfer.effectAllowed = "move";
      }}
    >
      <span className="block font-medium leading-snug">{card.name}</span>
      {card.company && card.company !== card.name && (
        <span className="block truncate text-[0.85rem] text-muted">{card.company}</span>
      )}
      <span className="mt-2 flex flex-wrap gap-x-2 text-[0.8rem] text-muted">
        {card.value && <span className="tabular-nums text-body">{card.value}</span>}
        <span>{card.origin}</span>
        {card.audit && <span>Audit</span>}
        {card.owner && <span>{card.owner}</span>}
      </span>
      {card.nextAction && (
        <span className={`mt-2 block text-[0.8rem] ${card.due?.overdue ? "text-text" : "text-hint"}`}>
          {card.due?.overdue && <span className="text-blue-hover">● </span>}
          {card.nextAction}
          {card.due && ` · ${card.due.label}`}
        </span>
      )}
      {card.daysInStage != null && card.daysInStage > 0 && (
        <span className="mt-1 block font-mono text-[0.7rem] text-hint">{card.daysInStage}d in stage</span>
      )}
    </Link>
  );
}
