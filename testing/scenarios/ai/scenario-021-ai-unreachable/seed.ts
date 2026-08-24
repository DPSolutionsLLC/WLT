export { seed } from "../scenario-020-preview-before-you-save/seed.ts";

// Deliberately the same seed as scenario 020, re-exported rather than copied.
//
// What this scenario manipulates is the ENVIRONMENT, not the database: an invalid
// ANTHROPIC_API_KEY, then an absent one. There is nothing to seed differently, and a second copy
// of the fixture would be one more thing to keep in step for no benefit.
//
// The saved versions matter here for one reason: the final check is that a failed preview wrote
// NOTHING, and "the history still has exactly two rows" is only a meaningful sentence if there
// were rows to begin with.
