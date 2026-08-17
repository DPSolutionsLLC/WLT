import { PinSignInForm } from "@/app/(auth)/pin/PinSignInForm";

// Public, like every page under (auth). middleware.ts already lists /pin in PUBLIC_PATHS.
export default function PinPage() {
  return <PinSignInForm />;
}
