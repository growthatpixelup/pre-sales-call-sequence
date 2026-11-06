import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";
import { plural } from "@/lib/content/format";
import { PHOTO_ORDERS, PHOTO_STATUSES, filterPhotos, tagCounts, type PhotoFilters, type PhotoOrder, type PhotoStatus } from "@/lib/content/photo-library";
import { loadPhotos } from "@/lib/content/sources";
import { EmptyNotice, SourceNotice, hrefBuilder, param } from "../_components/kit";
import { PhotoCard } from "./photo-card";
import { PhotoUploader } from "./uploader";

export const metadata: Metadata = { title: "Photos · Content OS" };

const TITLE = "Photos";
const DEFAULTS = { status: "all", tag: "all", order: "newest" };
const STATUS_LABELS: Record<PhotoStatus, string> = { all: "All", unused: "Not used yet", used: "Used" };
const ORDER_LABELS: Record<PhotoOrder, string> = { newest: "Newest upload", taken: "Date taken" };

export default function PhotosPage({ searchParams }: PageProps<"/dashboard/content/photos">) {
  return (
    <Suspense fallback={<Skeleton />}>
      <PhotosView searchParams={searchParams} />
    </Suspense>
  );
}

async function PhotosView({ searchParams }: { searchParams: PageProps<"/dashboard/content/photos">["searchParams"] }) {
  const sp = await searchParams;
  // Signed image URLs are minted per request.
  await connection();
  const result = await loadPhotos();

  if (result.status !== "ok") {
    return (
      <>
        <Header />
        <div className="px-4 py-8 sm:px-[30px]">
          <SourceNotice result={result} />
        </div>
      </>
    );
  }

  const photos = result.data;
  const tags = tagCounts(photos);
  const s = param(sp.status);
  const t = param(sp.tag);
  const o = param(sp.order);
  const filters: PhotoFilters = {
    status: PHOTO_STATUSES.includes(s as PhotoStatus) ? (s as PhotoStatus) : "all",
    tag: t && tags.some((x) => x.tag === t) ? t : "all",
    order: PHOTO_ORDERS.includes(o as PhotoOrder) ? (o as PhotoOrder) : "newest",
  };
  const shown = filterPhotos(photos, filters);
  const unused = photos.filter((p) => !p.usedAt).length;
  const href = hrefBuilder("/dashboard/content/photos", { ...filters }, DEFAULTS);

  return (
    <>
      <Header
        aside={
          <p className="m-0 text-[0.95rem] text-muted">
            {plural(photos.length, "photo")} · {unused} not used yet
          </p>
        }
      />

      <div className="px-4 pt-4 sm:px-[30px]">
        <PhotoUploader />
      </div>

      {photos.length > 0 && (
        <nav aria-label="Filters" className="mx-4 flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-line py-6 sm:mx-[30px]">
          <Group label="Status">
            {PHOTO_STATUSES.map((x) => (
              <Pill key={x} href={href({ status: x })} active={filters.status === x}>
                {STATUS_LABELS[x]}
              </Pill>
            ))}
          </Group>
          {tags.length > 0 && (
            <Group label="Tag">
              <Pill href={href({ tag: "all" })} active={filters.tag === "all"}>
                All
              </Pill>
              {tags.map((x) => (
                <Pill key={x.tag} href={href({ tag: x.tag })} active={filters.tag === x.tag}>
                  {x.tag} <span className="text-muted tabular-nums">{x.count}</span>
                </Pill>
              ))}
            </Group>
          )}
          <Group label="Order">
            {PHOTO_ORDERS.map((x) => (
              <Pill key={x} href={href({ order: x })} active={filters.order === x}>
                {ORDER_LABELS[x]}
              </Pill>
            ))}
          </Group>
          <span className="ml-auto text-[0.95rem] text-muted tabular-nums" aria-live="polite">
            {shown.length} shown
          </span>
        </nav>
      )}

      <div className="px-4 py-6 sm:px-[30px]">
        {!photos.length ? (
          <EmptyNotice title="No photos yet.">Add the shots of Daksh you want to use in LinkedIn posts; they stay private to this dashboard.</EmptyNotice>
        ) : !shown.length ? (
          <EmptyNotice title="Nothing matches these filters.">
            <Link href="/dashboard/content/photos" className="link">
              Clear the filters
            </Link>
          </EmptyNotice>
        ) : (
          <div className="columns-1 gap-4 sm:columns-2 xl:columns-3 2xl:columns-4">
            {shown.map((p) => (
              <PhotoCard key={p.id} photo={p} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function Header({ aside }: { aside?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-10 gap-y-3 px-4 pt-10 pb-2 sm:px-[30px]">
      <div>
        <h1 className="h1 m-0 whitespace-nowrap">{TITLE}</h1>
        <p className="m-0 mt-3 max-w-[62ch] text-muted">Photos of Daksh for LinkedIn posts. Tag them, and mark each one used once it&apos;s posted.</p>
      </div>
      {aside}
    </header>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-2">
      <span className="mono-label mr-2">{label}</span>
      {children}
    </div>
  );
}

function Pill({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className="pill" scroll={false}>
      {children}
    </Link>
  );
}

function Skeleton() {
  return (
    <div aria-busy="true" aria-label="Loading photos">
      <Header />
      <div className="columns-1 gap-4 px-4 py-6 sm:columns-2 sm:px-[30px] xl:columns-3 2xl:columns-4">
        {[72, 96, 56, 80].map((h, i) => (
          <div key={i} className="skeleton mb-4" style={{ height: `${h * 4}px` }} />
        ))}
      </div>
    </div>
  );
}
