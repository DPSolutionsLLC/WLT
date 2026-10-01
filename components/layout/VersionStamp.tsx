// WHICH DEPLOY YOU ARE LOOKING AT — at the foot of every page in the app shell, so a leader can
// confirm an update reached them. It is the short commit id: the same seven characters a push
// reports, which is what makes it checkable. package.json's version never changes and would tell
// nobody anything.
//
// The id is captured at build time (next.config.ts). Empty on a local build, so "local".

const SHORT_LENGTH = 7;

export function formatAppVersion(commitSha: string | undefined): string {
  const trimmed = commitSha?.trim() ?? "";
  return trimmed === "" ? "local" : trimmed.slice(0, SHORT_LENGTH);
}

export function VersionStamp({ commitSha }: { commitSha: string | undefined }) {
  return (
    <footer className="px-4 pb-4 text-center text-xs text-muted">
      Version {formatAppVersion(commitSha)}
    </footer>
  );
}
