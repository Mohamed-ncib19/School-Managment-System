"use client";

import { useEffect } from "react";
import { useRouter, useParams } from "next/navigation";

export default function StudentDetailRedirect() {
  const router = useRouter();
  const params = useParams();
  const studentId = params.studentId as string;

  useEffect(() => {
    if (studentId) {
      router.replace(`/students?studentId=${studentId}`);
    }
  }, [studentId, router]);

  return null;
}
