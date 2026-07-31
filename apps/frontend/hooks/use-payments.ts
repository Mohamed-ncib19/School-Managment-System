"use client";

import { useQuery, useMutation, useQueryClient, type UseQueryOptions } from "@tanstack/react-query";
import { ApiClient } from "@/lib/api/client";
import type { PaymentStatus, StudentPayment } from "@/types";

export function usePayments(
  filters?: {
    status?: string;
    fieldId?: string;
    profId?: string;
    levelId?: string;
    groupId?: string;
  },
  options?: Omit<UseQueryOptions<StudentPayment[]>, "queryKey" | "queryFn">,
) {
  const queryKey = ["payments", filters];
  return useQuery({
    queryKey,
    queryFn: () => {
      const params: Record<string, string> = {};
      if (filters?.status) params.status = filters.status;
      if (filters?.fieldId) params.fieldId = filters.fieldId;
      if (filters?.profId) params.profId = filters.profId;
      if (filters?.levelId) params.levelId = filters.levelId;
      if (filters?.groupId) params.groupId = filters.groupId;
      return ApiClient.get<StudentPayment[]>("/payments", { params });
    },
    ...options,
  });
}

export function useStudentPayments(studentId: string) {
  return useQuery({
    queryKey: ["studentPayments", studentId],
    queryFn: () => ApiClient.get<StudentPayment[]>(`/students/${studentId}/payments`),
    enabled: !!studentId,
  });
}

export function useRecordPayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ paymentId, paidAmount }: { paymentId: string; paidAmount: string }) =>
      ApiClient.post(`/payments/${paymentId}/record-payment`, { paid_amount: paidAmount }),
    onSuccess: () => {
      queryClient.invalidateQueries();
    },
  });
}

export function useGenerateMonthlyPayments() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => ApiClient.post("/payments/generate"),
    onSuccess: () => {
      queryClient.invalidateQueries();
    },
  });
}

export function useGeneratePaymentForStudent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (studentId: string) => ApiClient.post(`/payments/generate-for-student/${studentId}`),
    onSuccess: () => {
      queryClient.invalidateQueries();
    },
  });
}

/**
 * `paid` is not settable here — the API rejects it. Marking a payment paid has
 * to record who collected it and when, which is what `useRecordPayment` does.
 */
export function useUpdatePaymentStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      paymentId,
      status,
    }: {
      paymentId: string;
      status: Exclude<PaymentStatus, "paid">;
    }) => ApiClient.patch(`/payments/${paymentId}/status`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries();
    },
  });
}
