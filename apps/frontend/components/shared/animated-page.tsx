"use client";

import type { ReactNode } from "react";
import { stagger, fadeIn } from "@/lib/utils/animations";
import { motion } from "framer-motion";

interface AnimatedPageProps {
  children: ReactNode;
  className?: string;
}

export function AnimatedPage({ children, className = "" }: AnimatedPageProps) {
  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={stagger(0.07)}
      className={className}
    >
      {children}
    </motion.div>
  );
}
