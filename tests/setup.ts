import "dotenv/config";
import "@testing-library/jest-dom/vitest";
import { config } from "dotenv";

config({ path: ".env.local", override: true, quiet: true });
