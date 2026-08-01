"use client";

/**
 * Shape-matched loading placeholders.
 *
 * Each skeleton mirrors the geometry of the content it stands in for - same row
 * height, same column count, same card footprint - so the page does not jump
 * when real data arrives. A generic spinner cannot do that, and a blank screen
 * makes every load feel broken.
 */

/** The one shimmering primitive every skeleton is built from. */
export function Shimmer({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={`animate-pulse rounded bg-neutral-soft dark:bg-white/10 ${className}`}
      style={style}
      aria-hidden="true"
    />
  );
}

/** Wraps a skeleton region and announces it politely to assistive tech. */
function SkeletonRegion({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className="w-full">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

export function TableSkeleton({
  rows = 8,
  columns = 5,
  showHeader = true,
}: {
  rows?: number;
  columns?: number;
  showHeader?: boolean;
}) {
  return (
    <SkeletonRegion label="Loading table data">
      <div className="table-container">
        <table className="min-w-full">
          {showHeader && (
            <thead>
              <tr className="bg-background">
                {Array.from({ length: columns }).map((_, i) => (
                  <th key={i} className="px-4 py-3 text-left">
                    <Shimmer className="h-3 w-20" />
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody className="divide-y divide-border">
            {Array.from({ length: rows }).map((_, r) => (
              <tr key={r}>
                {Array.from({ length: columns }).map((_, c) => (
                  <td key={c} className="px-4 py-3">
                    {/* Varying widths read as data rather than a grid of bars. */}
                    <Shimmer className={`h-4 ${c === 0 ? "w-32" : c === columns - 1 ? "w-16" : "w-24"}`} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SkeletonRegion>
  );
}

export function CardGridSkeleton({ count = 6, columns = 3 }: { count?: number; columns?: number }) {
  const gridCols =
    columns === 4
      ? "sm:grid-cols-2 lg:grid-cols-4"
      : columns === 2
        ? "sm:grid-cols-2"
        : "sm:grid-cols-2 lg:grid-cols-3";

  return (
    <SkeletonRegion label="Loading cards">
      <div className={`grid grid-cols-1 gap-4 ${gridCols}`}>
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="card space-y-3">
            <div className="flex items-center gap-3">
              <Shimmer className="h-10 w-10 rounded-card" />
              <div className="flex-1 space-y-2">
                <Shimmer className="h-4 w-2/3" />
                <Shimmer className="h-3 w-1/3" />
              </div>
            </div>
            <Shimmer className="h-3 w-full" />
            <Shimmer className="h-3 w-4/5" />
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}

export function StatCardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <SkeletonRegion label="Loading statistics">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="stat-card">
            <Shimmer className="h-12 w-12 rounded-card" />
            <div className="flex-1 space-y-2">
              <Shimmer className="h-3 w-24" />
              <Shimmer className="h-7 w-16" />
            </div>
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}

export function ChartSkeleton({ height = 280 }: { height?: number }) {
  return (
    <SkeletonRegion label="Loading chart">
      <div className="card">
        <Shimmer className="mb-6 h-4 w-40" />
        <div className="flex items-end gap-2" style={{ height }}>
          {/* Deterministic heights: random values would shift on every render. */}
          {[45, 70, 55, 85, 60, 95, 50, 75, 65, 90, 58, 80].map((h, i) => (
            <Shimmer key={i} className="flex-1 rounded-t" style={{ height: `${h}%` }} />
          ))}
        </div>
      </div>
    </SkeletonRegion>
  );
}

export function FormSkeleton({ fields = 5, columns = 1 }: { fields?: number; columns?: number }) {
  return (
    <SkeletonRegion label="Loading form">
      <div className={`grid gap-4 ${columns === 2 ? "sm:grid-cols-2" : "grid-cols-1"}`}>
        {Array.from({ length: fields }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Shimmer className="h-3 w-24" />
            <Shimmer className="h-10 w-full rounded-input" />
          </div>
        ))}
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Shimmer className="h-10 w-24 rounded-btn" />
        <Shimmer className="h-10 w-28 rounded-btn" />
      </div>
    </SkeletonRegion>
  );
}

/** Indented rows that match the field > professor > level > group nesting. */
export function HierarchySkeleton({ rows = 6 }: { rows?: number }) {
  const indents = [0, 1, 2, 1, 2, 3, 0, 1];
  return (
    <SkeletonRegion label="Loading hierarchy">
      <div className="space-y-2">
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-card bg-surface p-3 shadow-card"
            style={{ marginLeft: `${(indents[i % indents.length] ?? 0) * 24}px` }}
          >
            <Shimmer className="h-4 w-4 rounded" />
            <Shimmer className="h-8 w-8 rounded-card" />
            <Shimmer className="h-4 flex-1 max-w-[240px]" />
            <Shimmer className="h-5 w-16 rounded-full" />
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}

/** Header block plus detail rows, for a single-record page. */
export function DetailSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <SkeletonRegion label="Loading details">
      <div className="space-y-6">
        <div className="card flex items-center gap-4">
          <Shimmer className="h-16 w-16 rounded-full" />
          <div className="flex-1 space-y-2">
            <Shimmer className="h-6 w-56" />
            <Shimmer className="h-3 w-40" />
          </div>
          <Shimmer className="h-9 w-24 rounded-btn" />
        </div>
        <div className="card">
          <Shimmer className="mb-4 h-4 w-32" />
          <div className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: rows }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Shimmer className="h-3 w-20" />
                <Shimmer className="h-4 w-36" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </SkeletonRegion>
  );
}

/** Breadcrumb + title + toolbar, so headers don't pop in after the body. */
export function PageHeaderSkeleton() {
  return (
    <SkeletonRegion label="Loading page">
      <div className="space-y-4">
        <Shimmer className="h-3 w-48" />
        <div className="flex items-center gap-3">
          <Shimmer className="h-11 w-11 rounded-card" />
          <div className="space-y-2">
            <Shimmer className="h-5 w-44" />
            <Shimmer className="h-3 w-64" />
          </div>
        </div>
      </div>
    </SkeletonRegion>
  );
}
