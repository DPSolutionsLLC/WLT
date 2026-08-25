// What every way of not existing looks like from outside.
//
// It says ONE thing, and it is deliberately vague: an unknown slug, a slug somebody deactivated,
// and a program that has not been distributed yet must be indistinguishable here. A page that
// said "this program has not been published yet" would confirm that the slug is real, and one
// that said "this ward has no page" would confirm the opposite.
//
// No search box, no list of other pages, no link into the app. There is nothing useful to offer
// somebody who has mistyped a slug, and every link would be a way to enumerate.

export default function PublicNotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
      <h1 className="text-lg font-semibold text-foreground">Page not found</h1>
      <p className="max-w-sm text-sm text-muted">
        This link is not active. Check the address, or ask your ward for a current one.
      </p>
    </main>
  );
}
