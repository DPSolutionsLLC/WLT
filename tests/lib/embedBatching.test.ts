// @vitest-environment node
//
// Batching, partial failure, and the dimension check — with OpenAI mocked.
//
// The claim worth proving here is the one that decides whether a 20-minute corpus load survives
// a hiccup: A FAILED BATCH MARKS ITS INDEXES AND THE RUN CONTINUES. A single 429 partway through
// the Book of Mormon must not discard the 20,000 passages that already embedded.
//
// Only the OpenAI constructor is mocked. Everything else — the batching arithmetic, the
// index alignment, the dimension assertion — is the real module.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();

vi.mock("openai", () => ({
  default: class {
    embeddings = { create };
  },
}));

const ORIGINAL_KEY = process.env.OPENAI_API_KEY;

function vector(seed: number, dimensions = 1536): number[] {
  return Array.from({ length: dimensions }, (_, index) => (index === 0 ? seed : 0));
}

// The SDK returns entries carrying their own `index`. Returned deliberately out of order in one
// test below, because the module sorts by it rather than trusting arrival order.
function response(count: number, offset = 0, dimensions = 1536) {
  return {
    data: Array.from({ length: count }, (_, index) => ({
      index,
      embedding: vector(offset + index, dimensions),
    })),
  };
}

// Imported fresh in each test: the module caches its OpenAI client in a module-level variable,
// so a suite that mutates OPENAI_API_KEY between tests would otherwise reuse the first client.
async function loadModule() {
  vi.resetModules();
  return import("@/lib/ai/embed");
}

describe("embedTexts", () => {
  beforeEach(() => {
    create.mockReset();
    process.env.OPENAI_API_KEY = "test-key";
  });

  afterEach(() => {
    process.env.OPENAI_API_KEY = ORIGINAL_KEY;
  });

  it("returns [] work for no input without calling the API", async () => {
    const { embedTexts } = await loadModule();

    const result = await embedTexts([]);

    expect(result.embeddings).toEqual([]);
    expect(result.failedIndexes).toEqual([]);
    expect(create).not.toHaveBeenCalled();
  });

  it("sends one request for a batch that fits", async () => {
    const { embedTexts } = await loadModule();
    create.mockResolvedValue(response(3));

    const result = await embedTexts(["a", "b", "c"]);

    expect(create).toHaveBeenCalledTimes(1);
    expect(result.embeddings).toHaveLength(3);
    expect(result.failedIndexes).toEqual([]);
  });

  it("splits into batches of EMBEDDING_BATCH_SIZE", async () => {
    const { embedTexts, EMBEDDING_BATCH_SIZE } = await loadModule();

    const total = EMBEDDING_BATCH_SIZE * 2 + 5;
    create.mockImplementation(({ input }: { input: string[] }) =>
      Promise.resolve(response(input.length)),
    );

    const result = await embedTexts(Array.from({ length: total }, (_, i) => `text ${i}`));

    expect(create).toHaveBeenCalledTimes(3);
    expect(result.embeddings).toHaveLength(total);
    expect(result.embeddings.every((entry) => entry !== null)).toBe(true);
  });

  it("keeps embeddings index-aligned with the input across batches", async () => {
    const { embedTexts, EMBEDDING_BATCH_SIZE } = await loadModule();

    let callIndex = 0;
    create.mockImplementation(({ input }: { input: string[] }) => {
      const offset = callIndex * EMBEDDING_BATCH_SIZE;
      callIndex += 1;
      return Promise.resolve(response(input.length, offset));
    });

    const total = EMBEDDING_BATCH_SIZE + 3;
    const result = await embedTexts(Array.from({ length: total }, (_, i) => `text ${i}`));

    // The seed lives in position 0 of each vector, so this proves batch two's vectors did not
    // land on batch one's indexes.
    expect(result.embeddings[0]?.[0]).toBe(0);
    expect(result.embeddings[EMBEDDING_BATCH_SIZE]?.[0]).toBe(EMBEDDING_BATCH_SIZE);
  });

  it("sorts by the returned index rather than trusting arrival order", async () => {
    const { embedTexts } = await loadModule();

    create.mockResolvedValue({
      data: [
        { index: 2, embedding: vector(2) },
        { index: 0, embedding: vector(0) },
        { index: 1, embedding: vector(1) },
      ],
    });

    const result = await embedTexts(["a", "b", "c"]);

    expect(result.embeddings.map((entry) => entry?.[0])).toEqual([0, 1, 2]);
  });

  it("RECORDS A FAILED BATCH AND CONTINUES with the rest", async () => {
    const { embedTexts, EMBEDDING_BATCH_SIZE } = await loadModule();

    let callIndex = 0;
    create.mockImplementation(({ input }: { input: string[] }) => {
      callIndex += 1;
      // The middle batch fails, exactly as a transient 429 would.
      if (callIndex === 2) return Promise.reject(new Error("429 rate limit"));
      return Promise.resolve(response(input.length));
    });

    const total = EMBEDDING_BATCH_SIZE * 3;
    const result = await embedTexts(Array.from({ length: total }, (_, i) => `text ${i}`));

    // All three batches were attempted — the run did not stop at the failure.
    expect(create).toHaveBeenCalledTimes(3);

    expect(result.failedIndexes).toHaveLength(EMBEDDING_BATCH_SIZE);
    expect(result.failedIndexes[0]).toBe(EMBEDDING_BATCH_SIZE);

    // The failed batch's slots are null; everything else survived.
    expect(result.embeddings[EMBEDDING_BATCH_SIZE]).toBeNull();
    expect(result.embeddings[0]).not.toBeNull();
    expect(result.embeddings[total - 1]).not.toBeNull();
  });

  it("reports progress as batches complete", async () => {
    const { embedTexts, EMBEDDING_BATCH_SIZE } = await loadModule();

    create.mockImplementation(({ input }: { input: string[] }) =>
      Promise.resolve(response(input.length)),
    );

    const seen: number[] = [];
    const total = EMBEDDING_BATCH_SIZE * 2;
    await embedTexts(
      Array.from({ length: total }, (_, i) => `text ${i}`),
      (done) => seen.push(done),
    );

    // Progress PRINTS rather than going silent for twenty minutes — the script relies on this.
    expect(seen).toEqual([EMBEDDING_BATCH_SIZE, total]);
  });

  it("refuses a vector of the wrong dimension rather than letting Postgres find it", async () => {
    const { embedTexts } = await loadModule();

    // A 512-dimension vector against a vector(1536) column is otherwise an insert error
    // thousands of rows in, by which point "which model produced this" is unanswerable.
    create.mockResolvedValue(response(1, 0, 512));

    const result = await embedTexts(["a"]);

    // Caught per batch, so it is recorded as a failure rather than taking the whole run down.
    expect(result.failedIndexes).toEqual([0]);
    expect(result.embeddings[0]).toBeNull();
  });

  it("throws immediately when the key is missing, naming OPENAI", async () => {
    delete process.env.OPENAI_API_KEY;
    const { embedTexts } = await loadModule();

    // A bishopric told to add the ANTHROPIC key when the OpenAI one is missing will do the
    // wrong thing and still be stuck. The two keys fail independently.
    await expect(embedTexts(["a"])).rejects.toThrow(/OpenAI/);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("embedQuery", () => {
  beforeEach(() => {
    create.mockReset();
    process.env.OPENAI_API_KEY = "test-key";
  });

  afterEach(() => {
    process.env.OPENAI_API_KEY = ORIGINAL_KEY;
  });

  it("returns the single vector", async () => {
    const { embedQuery } = await loadModule();
    create.mockResolvedValue(response(1, 7));

    expect(await embedQuery("faith")).toHaveLength(1536);
  });

  it("THROWS rather than returning nothing when the query cannot be embedded", async () => {
    const { embedQuery } = await loadModule();
    create.mockRejectedValue(new Error("network down"));

    // A query with no vector cannot degrade gracefully into anything useful — an empty result
    // set here would read to the user as "nothing matched", which is a different claim.
    await expect(embedQuery("faith")).rejects.toThrow(/Could not reach/);
  });
});

describe("the embedding model", () => {
  it("is declared once and matches the vector(1536) column", async () => {
    const { EMBEDDING_MODEL, EMBEDDING_DIMENSIONS } = await loadModule();

    // Query and documents must use the SAME model; mixing two returns confident nonsense with
    // no error anywhere. Neither function takes a model parameter, which is what stops them
    // drifting — this asserts the constants they share.
    expect(EMBEDDING_MODEL).toBe("text-embedding-3-small");
    expect(EMBEDDING_DIMENSIONS).toBe(1536);
  });
});
