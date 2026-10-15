import { z } from "zod";
import { RELEASED_MODULE_KEYS } from "@/lib/access/releasedModules";

// The super admin's released-modules list for one ward (ITER-041). NULL MEANS EVERYTHING — the row
// is removed and the ward has no list. An empty array is a real answer: nothing released.
export const releasedModulesSchema = z
  .object({
    modules: z
      .array(z.enum(RELEASED_MODULE_KEYS, "That is not a module this app has."))
      .max(50, "That list is longer than the number of modules.")
      .nullable(),
  })
  .strict();
export type ReleasedModulesInput = z.infer<typeof releasedModulesSchema>;
