"use client";

import { useState, useRef, useEffect } from "react";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils/format";

interface DropdownMenuProps {
  children: React.ReactNode;
  className?: string;
}

interface DropdownMenuItemProps {
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
  danger?: boolean;
}

export function DropdownMenu({ children, className }: DropdownMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className={cn("relative", className)} ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="p-1 rounded-btn hover:bg-background text-text-secondary hover:text-text-primary transition-colors"
        aria-label="Plus d'options"
      >
        <MoreHorizontal size={16} />
      </button>
      {isOpen && (
        <div className="absolute right-0 mt-1 w-48 bg-surface rounded-btn shadow-hover border border-border z-50 py-1">
          {children}
        </div>
      )}
    </div>
  );
}

export function DropdownMenuItem({ onClick, children, className, danger }: DropdownMenuItemProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-background transition-colors",
        danger ? "text-danger hover:text-danger" : "text-text-primary hover:text-primary",
        className
      )}
    >
      {children}
    </button>
  );
}