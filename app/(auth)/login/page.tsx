import { redirect } from "next/navigation";
import { getSessionUserForPage } from "@/lib/auth/session";
import { LoginForm } from "@/app/(auth)/login/LoginForm";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirectTo?: string; reset?: string; registered?: string }>;
}) {
  const user = await getSessionUserForPage();
  if (user) redirect("/dashboard");

  const { redirectTo, reset, registered } = await searchParams;

  return (
    <LoginForm
      redirectTo={redirectTo}
      didResetPassword={reset === "1"}
      didRegister={registered === "1"}
    />
  );
}
