// Domain types are imported from the app rather than copied, so they cannot drift. The
// harness only defines types that do not exist in the app: the manifest shape and the seed
// module contract.

export type {
  ActivityType,
  AgendaStatus,
  AssignmentType,
  GoalStatus,
  HymnType,
  MeetingType,
  MemberCategory,
  MemberGender,
  MemberStatus,
  OrganizationType,
  PipelineStage,
  PrayerType,
  ProgramStatus,
  PublicPageType,
  Role,
  SacramentAssignmentType,
  SundayType,
  TopicCategory,
  VisitCadence,
  VisitTargetType,
} from "../../types/domain.ts";

export type ScenarioManifestEntry = {
  id: string;
  path: string;
  name: string;
  scope: string;
  part: number | null;
  tags: string[];
  prerequisites: string;
  purpose: string;
  checklist: string[];
  seedCommand: string;
};

export type ScenarioManifest = {
  generatedFrom: string;
  scenarioCount: number;
  scenarios: ScenarioManifestEntry[];
};

// Every scenario's seed.ts exports this.
export type SeedModule = {
  seed: () => Promise<void>;
};
