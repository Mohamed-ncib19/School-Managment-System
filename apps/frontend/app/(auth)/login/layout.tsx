import AuthGuard from "@/components/shared/auth-guard";

export default function AuthGroupLayout({ children }: { children: React.ReactNode }) {
  return <AuthGuard>{children}</AuthGuard>;
}
