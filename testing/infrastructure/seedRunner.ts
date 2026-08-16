import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describeTarget } from "./adminClient.ts";
import { cleanUpTestData } from "./cleanUp.ts";
import { TESTING_ROOT } from "./envLoader.ts";
import { TEST_EMAIL_DOMAIN, TEST_WARD_ID, testPassword } from "./seedUtils.ts";
import type { SeedModule } from "./types.ts";

type Options = {
  scenarioPath: string;
  shouldClean: boolean;
};

function parseArguments(argv: string[]): Options {
  const args = argv.filter((argument) => argument !== "--");
  const flags = args.filter((argument) => argument.startsWith("--"));
  const positional = args.filter((argument) => !argument.startsWith("--"));

  if (positional.length === 0) {
    throw new Error(
      "No scenario given.\n\n" +
        "  npm run seed -- <scope>/<scenario-folder>\n" +
        "  npm run seed -- ITER-001/scenario-001-youth-pin-login\n\n" +
        "Add --no-clean to seed on top of what is already there.",
    );
  }

  const unknown = flags.filter((flag) => flag !== "--no-clean");
  if (unknown.length > 0) {
    throw new Error(`Unknown flag(s): ${unknown.join(", ")}. Only --no-clean is supported.`);
  }

  return {
    scenarioPath: positional[0].replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""),
    shouldClean: !flags.includes("--no-clean"),
  };
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));

  const seedFile = path.join(TESTING_ROOT, "scenarios", options.scenarioPath, "seed.ts");

  if (!existsSync(seedFile)) {
    throw new Error(
      `No seed script at testing/scenarios/${options.scenarioPath}/seed.ts.\n` +
        "Run `npm run manifest` to list what exists, or create one with /new-scenario.",
    );
  }

  // Fail before touching the database if the password is missing, rather than cleaning first
  // and erroring afterwards.
  testPassword();

  console.log(`Scenario: ${options.scenarioPath}`);
  console.log(`Target:   ${describeTarget()}`);
  console.log(`Ward:     ${TEST_WARD_ID}`);

  if (options.shouldClean) {
    console.log("\nClearing previous harness data...");
    const result = await cleanUpTestData();
    console.log(`  test ward removed, ${result.authUsersDeleted} auth user(s) deleted`);
  } else {
    console.log("\nSkipping cleanup (--no-clean).");
  }

  console.log("\nSeeding...");
  const module_ = (await import(pathToFileURL(seedFile).href)) as SeedModule;

  if (typeof module_.seed !== "function") {
    throw new Error(
      `testing/scenarios/${options.scenarioPath}/seed.ts must export an async function named "seed".`,
    );
  }

  await module_.seed();

  console.log("\nSeeded.");
  console.log(`  Sign in with any @${TEST_EMAIL_DOMAIN} account created by this scenario.`);
  console.log("  Password: the value of HARNESS_TEST_PASSWORD in your env file.");
  console.log(`\nWalk the checklist in testing/scenarios/${options.scenarioPath}/scenario.md`);
  console.log("Clean up afterwards with: npm run seed:clean");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(`\n${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  });
}
