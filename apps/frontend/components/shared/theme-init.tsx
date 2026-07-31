"use client";

import { useEffect } from "react";
import { initTheme } from "@/hooks/use-theme";

export default function ThemeInit() {
  useEffect(() => {
    initTheme();
  }, []);
  return null;
}
