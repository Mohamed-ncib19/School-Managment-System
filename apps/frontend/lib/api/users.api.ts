import { ApiClient } from "@/lib/api/client";

export const usersApi = {
  me: () => ApiClient.get<any>("/users/me"),
  updateProfile: (data: { full_name?: string; email?: string }) =>
    ApiClient.patch<any>("/users/me", data),
};
