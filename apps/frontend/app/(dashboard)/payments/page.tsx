"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function LegacyPaymentsRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/financial/payments");
  }, [router]);

  return null;
}
