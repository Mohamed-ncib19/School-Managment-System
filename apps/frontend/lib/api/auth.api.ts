import { ApiClient } from "@/lib/api/client";
import type { LoginRequest, LoginResponse as LoginResponseType } from "@/types";

// ApiClient already peels the `{ data, error }` envelope.
export const authApi = {
  login: (data: LoginRequest): Promise<LoginResponseType> =>
    ApiClient.post<LoginResponseType>("/auth/login", data),
  me: (): Promise<any> => ApiClient.get<any>("/auth/me"),
  logout: (): Promise<{ message: string }> =>
    ApiClient.post<{ message: string }>("/auth/logout", undefined, {
      skipAuthHandling: true,
    } as any),
  changePassword: (currentPassword: string, newPassword: string): Promise<{ message: string }> =>
    ApiClient.post("/auth/change-password", { current_password: currentPassword, new_password: newPassword }),
};
