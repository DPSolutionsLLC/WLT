// The TanStack Query key for one organization's visit progress. Every panel that changes what the
// progress shows (a goal, a stewardship, a cadence, a logged visit) invalidates it, so it lives in
// a plain module rather than inside one of those client components.
export const VISIT_PROGRESS_QUERY_KEY = "visit-progress";
