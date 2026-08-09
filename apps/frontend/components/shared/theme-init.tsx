"use client";

import { useEffect } from "react";
import { initAppearance } from "@/hooks/use-appearance";

export default function ThemeInit() {
  useEffect(() => {
    initAppearance();
  }, []);
  return null;
}