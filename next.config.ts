import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // THE DEPLOYED COMMIT, captured at BUILD time so the footer names exactly the code that was built
  // (components/layout/VersionStamp.tsx). Vercel sets VERCEL_GIT_COMMIT_SHA during every build;
  // reading it at runtime instead would depend on the project exposing system variables to
  // functions. A commit id is public, so inlining it into the bundle discloses nothing. Absent on a
  // local build, where the footer reads "local".
  env: {
    APP_VERSION: process.env.VERCEL_GIT_COMMIT_SHA ?? "",
  },
};

export default nextConfig;
