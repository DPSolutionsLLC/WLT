import { DocumentList } from "@/app/(app)/knowledge/DocumentList";
import { FilterResolver } from "@/app/(app)/knowledge/FilterResolver";
import { RetrievalTester } from "@/app/(app)/knowledge/RetrievalTester";
import { ScopePanel } from "@/app/(app)/knowledge/ScopePanel";
import { UploadForm } from "@/app/(app)/knowledge/UploadForm";
import { NotPermitted } from "@/components/ui/NotPermitted";
import { getActiveAiSettings } from "@/lib/ai/queries";
import { can, resolveRoleAccess } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";
import { todayDateOnly } from "@/lib/knowledge/conferenceMetadata";
import { listSavedFilters, listSpeakers } from "@/lib/knowledge/filterQueries";
import { listDocuments } from "@/lib/knowledge/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// NAVIGATION_ITEMS has always carried a "Knowledge Base" link at this path. Until now it 404ed;
// this page is what makes it resolve.
//
// `knowledge.view` and `knowledge.manage` are bishopric-only in lib/auth/permissions.ts. Note
// that migration 019 puts `knowledge_documents` in the WARD-scoped RLS loop rather than the
// bishopric-only one, so the two do not agree the way they do for `topics` and `ai_settings` —
// the rows are ward-readable, the page is not. The uploaded FILES are bishopric-only at the
// storage layer (migration 032). The permission check here is the boundary that matters for
// this page, and a non-bishopric role gets "Not permitted" rather than an empty library.

export default async function KnowledgePage() {
  const user = await requireSessionUser();
  const supabase = await createServerSupabaseClient();
  const roleAccess = await resolveRoleAccess(supabase, user.wardId);

  // can(), not assertCan(): a ForbiddenError escaping a Server Component becomes a 500 whose
  // message Next.js strips in production (plans/retros/auth-b-invites-admin.md).
  if (!can(user, "knowledge.view", roleAccess)) {
    return <NotPermitted detail="The knowledge base is limited to the bishopric." />;
  }

  const canManage = can(user, "knowledge.manage", roleAccess);

  const [documents, savedFilters, settings, speakers] = await Promise.all([
    listDocuments(user.wardId, supabase),
    listSavedFilters(user.wardId, supabase),
    getActiveAiSettings(user.wardId, supabase),
    listSpeakers(user.wardId, supabase),
  ]);

  // Resolved on the SERVER and passed down, so the panel's relative recency ("last 2 years")
  // lands on the same date the server will compute at retrieval time. A browser clock in another
  // timezone would otherwise show a count for a slightly different window than the one that
  // actually applies.
  const today = todayDateOnly();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Knowledge base</h1>
        <p className="mt-1 text-sm text-muted">
          Talks, letters and scripture the AI can draw on. Only short excerpts are ever used —
          no whole document is sent anywhere.
        </p>
      </div>

      {canManage && <UploadForm knownSpeakers={speakers} />}

      <ScopePanel
        documents={documents}
        savedFilters={savedFilters}
        settings={settings}
        today={today}
        canManage={canManage}
      />

      <FilterResolver canManage={canManage} />

      <DocumentList initialDocuments={documents} canManage={canManage} />

      <RetrievalTester hasDocuments={documents.some((document) => document.chunkCount > 0)} />
    </div>
  );
}
