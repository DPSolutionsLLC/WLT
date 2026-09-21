import { renderToBuffer } from "@react-pdf/renderer";
import { AgendaDocument, type AgendaDocumentProps } from "@/lib/pdf/AgendaDocument";

// The second and last file in this app that calls renderToBuffer.
//
// lib/pdf/renderProgram.tsx says one entry point keeps the cold-start cost of @react-pdf/renderer
// in one place, and that two would mean two places for a preview path to grow into. This is a
// SECOND entry point and the reason is that it renders a different document from different data
// with no shared inputs — a shared entry would be a function taking a discriminated union and
// forwarding to one of two components, which is indirection rather than reuse.
//
// What the two DO share is the dependency, and the cold-start cost is paid per serverless instance
// rather than per entry point, so this adds none.
//
// SERVER-ONLY, with the same `typeof window` guard renderProgram.tsx uses — this repo's
// established pattern rather than the `server-only` package, which is not a dependency here. A PDF
// renderer reaching a client bundle is a large regression that nothing else in the build catches.
if (typeof window !== "undefined") {
  throw new Error(
    "lib/pdf/renderAgenda.tsx was imported into browser code. @react-pdf/renderer is a " +
      "server-side renderer and must never reach a client bundle.",
  );
}

// NO WARNINGS ARRAY, where ProgramRenderResult has one.
//
// A programme render can go differently from what the ward configured — a cover image that would
// not fetch, one that was too large — and those are reported without failing the render. An agenda
// has no fetched assets, no images and no ward theme, so there is nothing that can partially
// succeed. A buffer or a thrown error is the whole of it.
export async function renderAgendaPdf(props: AgendaDocumentProps): Promise<Buffer> {
  return renderToBuffer(<AgendaDocument {...props} />);
}
