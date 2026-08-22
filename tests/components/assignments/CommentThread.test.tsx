import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommentThread } from "@/app/(app)/assignments/CommentThread";

// THE ONE-CHANNEL-PER-THREAD ASSERTION.
//
// A Sunday page renders one CommentThread per slot plus one for the month — four on a typical
// Sunday. They all share a realtime client, because createBrowserClient() memoises per browser.
// So if two threads ask for the same channel TOPIC, the client hands both the same channel: the
// first subscribes it, and the second's .on() call lands on an already-subscribed channel and
// realtime-js throws. That threw a runtime error that took the whole page down, and it was
// invisible for as long as the table was not in the supabase_realtime publication — the failure
// got attributed to the missing publication instead.
//
// The fake below reproduces exactly those two behaviours and nothing else: same topic returns the
// same channel, and .on() after .subscribe() throws. Without both, this test cannot fail.

type FakeChannel = {
  topic: string;
  subscribed: boolean;
  on: () => FakeChannel;
  subscribe: (callback?: (status: string) => void) => FakeChannel;
};

const channelsByTopic = new Map<string, FakeChannel>();

function makeChannel(topic: string): FakeChannel {
  const channel: FakeChannel = {
    topic,
    subscribed: false,
    on() {
      if (channel.subscribed) {
        throw new Error(
          `cannot add \`postgres_changes\` callbacks for realtime:${topic} after \`subscribe()\`.`,
        );
      }
      return channel;
    },
    subscribe(callback) {
      channel.subscribed = true;
      callback?.("SUBSCRIBED");
      return channel;
    },
  };

  return channel;
}

vi.mock("@/lib/supabase/browser", () => ({
  createBrowserSupabaseClient: () => ({
    // Memoised by topic, like the real shared client.
    channel(topic: string) {
      const existing = channelsByTopic.get(topic);
      if (existing) return existing;

      const created = makeChannel(topic);
      channelsByTopic.set(topic, created);
      return created;
    },
    removeChannel(channel: FakeChannel) {
      channelsByTopic.delete(channel.topic);
    },
  }),
}));

const WARD_ID = "11111111-1111-4111-8111-111111111111";

describe("CommentThread realtime channels", () => {
  beforeEach(() => {
    channelsByTopic.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("gives every thread on a Sunday its own channel", () => {
    render(
      <>
        <CommentThread
          wardId={WARD_ID}
          target={{ level: "assignment", assignmentId: "aaaaaaaa-0000-4000-8000-000000000001" }}
          initialComments={[]}
          currentUserName="Mark Andersen"
          canComment
        />
        <CommentThread
          wardId={WARD_ID}
          target={{ level: "assignment", assignmentId: "aaaaaaaa-0000-4000-8000-000000000002" }}
          initialComments={[]}
          currentUserName="Mark Andersen"
          canComment
        />
        <CommentThread
          wardId={WARD_ID}
          target={{ level: "month", sundayId: "bbbbbbbb-0000-4000-8000-000000000001" }}
          initialComments={[]}
          currentUserName="Mark Andersen"
          canComment
        />
      </>,
    );

    // Three threads, three distinct topics. One topic shared between any two of them is the bug.
    expect(channelsByTopic.size).toBe(3);

    const topics = [...channelsByTopic.keys()];
    expect(new Set(topics).size).toBe(topics.length);
    expect(topics.every((topic) => topic.includes(WARD_ID))).toBe(true);
  });

  // The same target twice is the month thread rendered in two places, or a remount mid-render.
  // It must not throw either — sharing a topic is only safe when nothing calls .on() afterwards,
  // and this asserts we never rely on that.
  it("does not throw when the same target is rendered twice", () => {
    expect(() =>
      render(
        <>
          <CommentThread
            wardId={WARD_ID}
            target={{ level: "month", sundayId: "bbbbbbbb-0000-4000-8000-000000000001" }}
            initialComments={[]}
            currentUserName="Mark Andersen"
            canComment
          />
          <CommentThread
            wardId={WARD_ID}
            target={{ level: "month", sundayId: "bbbbbbbb-0000-4000-8000-000000000001" }}
            initialComments={[]}
            currentUserName="Mark Andersen"
            canComment
          />
        </>,
      ),
    ).not.toThrow();
  });

  it("still renders the thread itself", () => {
    render(
      <CommentThread
        wardId={WARD_ID}
        target={{ level: "assignment", assignmentId: "aaaaaaaa-0000-4000-8000-000000000001" }}
        initialComments={[]}
        currentUserName="Mark Andersen"
        canComment
      />,
    );

    expect(screen.getByText("No comments yet.")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Add a comment")).toBeInTheDocument();
  });
});
