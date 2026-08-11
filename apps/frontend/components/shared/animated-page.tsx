"use client";

import type { ReactNode } from "react";
import { fadeIn } from "@/lib/utils/animations";
import { motion, useReducedMotion } from "framer-motion";

interface AnimatedPageProps {
  children: ReactNode;
  className?: string;
}

/**
 * Fades the page in without any transform.
 *
 * A transform (even `translateY(0)`) or `will-change: transform` on this
 * wrapper becomes the containing block of every `position: fixed` descendant,
 * which re-anchors modal backdrops to the <main> box instead of the viewport —
 * they stop at the fold and the dialog centers in the content area. Opacity
 * alone never does that, so every `fixed inset-0` overlay keeps covering the
 * whole screen.
 */
export function AnimatedPage({ children, className = "" }: AnimatedPageProps) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={fadeIn}
      transition={reduceMotion ? { duration: 0 } : undefined}
      className={className}
    >
      {children}
    </motion.div>
  );
}
