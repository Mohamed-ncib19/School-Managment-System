"use client";

interface LoadingSkeletonProps {
  className?: string;
  type?: "card" | "table-row" | "text";
  lines?: number;
}

export function LoadingSkeleton({ className = "", type = "text", lines = 3 }: LoadingSkeletonProps) {
  if (type === "card") {
    return (
      <div className={`card ${className}`}>
        <div className="h-4 bg-neutral-soft dark:bg-white/10 rounded w-32 mb-4 animate-pulse" />
        <div className="h-8 bg-neutral-soft dark:bg-white/10 rounded w-20 animate-pulse" />
      </div>
    );
  }
  if (type === "table-row") {
    return (
      <tr className={className}>
        <td className="px-4 py-3"><div className="h-4 bg-neutral-soft dark:bg-white/10 rounded w-24 animate-pulse" /></td>
        <td className="px-4 py-3"><div className="h-4 bg-neutral-soft dark:bg-white/10 rounded w-32 animate-pulse" /></td>
        <td className="px-4 py-3"><div className="h-4 bg-neutral-soft dark:bg-white/10 rounded w-20 animate-pulse" /></td>
        <td className="px-4 py-3"><div className="h-4 bg-neutral-soft dark:bg-white/10 rounded w-16 animate-pulse" /></td>
      </tr>
    );
  }
  return (
    <div className={className}>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-4 bg-neutral-soft dark:bg-white/10 rounded mb-2 animate-pulse" style={{ width: `${100 - i * 10}%` }} />
      ))}
    </div>
  );
}
