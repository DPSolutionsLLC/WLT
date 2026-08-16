import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { LoginForm } from "@/app/(auth)/login/LoginForm";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirectTo?: string; reset?: string }>;
}) {
  const user = await getSessionUser();
  if (user) redirect("/dashboard");

  const { redirectTo, reset } = await searchParams;

  return <LoginForm redirectTo={redirectTo} didResetPassword={reset === "1"} />;
}
