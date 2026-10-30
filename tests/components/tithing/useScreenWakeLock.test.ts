// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useScreenWakeLock } from "@/app/(tithing)/tithing/useScreenWakeLock";

// jsdom has no Screen Wake Lock API, so a small fake stands in for it. These tests prove WHEN the
// hook asks for and gives up the lock. Only a real phone can show the screen actually staying on.

class FakeSentinel extends EventTarget {
  released = false;
  readonly type = "screen" as const;
  onrelease = null;

  release = vi.fn(async (): Promise<void> => {
    if (this.released) return;
    this.released = true;
    this.dispatchEvent(new Event("release"));
  });
}

type RequestMock = ReturnType<typeof vi.fn<(type: "screen") => Promise<WakeLockSentinel>>>;

function asSentinel(fake: FakeSentinel): WakeLockSentinel {
  return fake as unknown as WakeLockSentinel;
}

function installWakeLock(request: RequestMock): void {
  Object.defineProperty(navigator, "wakeLock", { value: { request }, configurable: true });
}

function removeWakeLock(): void {
  Reflect.deleteProperty(navigator, "wakeLock");
}

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

async function flushPromises(): Promise<void> {
  await act(async () => {});
}

function grantingRequest(sentinels: FakeSentinel[] = []): RequestMock {
  return vi.fn(async () => {
    const sentinel = new FakeSentinel();
    sentinels.push(sentinel);
    return asSentinel(sentinel);
  });
}

beforeEach(() => {
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
});

afterEach(() => {
  removeWakeLock();
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  vi.restoreAllMocks();
});

describe("useScreenWakeLock", () => {
  it("asks for a screen lock once on mount when the page is visible", async () => {
    const request = grantingRequest();
    installWakeLock(request);

    renderHook(() => useScreenWakeLock());
    await flushPromises();

    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith("screen");
  });

  it("waits for the page to become visible when it mounts hidden", async () => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    const request = grantingRequest();
    installWakeLock(request);

    renderHook(() => useScreenWakeLock());
    await flushPromises();
    expect(request).not.toHaveBeenCalled();

    act(() => setVisibility("visible"));
    await flushPromises();
    expect(request).toHaveBeenCalledOnce();
  });

  it("asks again after the browser drops the lock and the page comes back", async () => {
    const sentinels: FakeSentinel[] = [];
    const request = grantingRequest(sentinels);
    installWakeLock(request);

    renderHook(() => useScreenWakeLock());
    await flushPromises();

    await act(async () => {
      await sentinels[0]?.release();
      setVisibility("hidden");
    });
    act(() => setVisibility("visible"));
    await flushPromises();

    expect(request).toHaveBeenCalledTimes(2);
  });

  it("does not ask again while the current lock is still held", async () => {
    const request = grantingRequest();
    installWakeLock(request);

    renderHook(() => useScreenWakeLock());
    await flushPromises();

    act(() => setVisibility("visible"));
    await flushPromises();

    expect(request).toHaveBeenCalledOnce();
  });

  it("does not start a second request while one is still pending", async () => {
    let resolveRequest: (sentinel: WakeLockSentinel) => void = () => {};
    const request: RequestMock = vi.fn(
      () =>
        new Promise<WakeLockSentinel>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    installWakeLock(request);

    renderHook(() => useScreenWakeLock());
    act(() => setVisibility("visible"));
    act(() => setVisibility("visible"));

    await act(async () => resolveRequest(asSentinel(new FakeSentinel())));

    expect(request).toHaveBeenCalledOnce();
  });

  it("releases the held lock on unmount", async () => {
    const sentinels: FakeSentinel[] = [];
    installWakeLock(grantingRequest(sentinels));

    const { unmount } = renderHook(() => useScreenWakeLock());
    await flushPromises();
    unmount();

    expect(sentinels[0]?.release).toHaveBeenCalledOnce();
    expect(sentinels[0]?.released).toBe(true);
  });

  it("releases a lock that arrives after the component has unmounted", async () => {
    const lateSentinel = new FakeSentinel();
    let resolveRequest: (sentinel: WakeLockSentinel) => void = () => {};
    const request: RequestMock = vi.fn(
      () =>
        new Promise<WakeLockSentinel>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    installWakeLock(request);

    const { unmount } = renderHook(() => useScreenWakeLock());
    unmount();
    await act(async () => resolveRequest(asSentinel(lateSentinel)));

    expect(request).toHaveBeenCalledOnce();
    expect(lateSentinel.release).toHaveBeenCalledOnce();
    expect(lateSentinel.released).toBe(true);
  });

  it("does nothing and warns nothing in a browser without the API", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect("wakeLock" in navigator).toBe(false);

    const { unmount } = renderHook(() => useScreenWakeLock());
    await flushPromises();
    act(() => setVisibility("visible"));
    unmount();

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("warns once and throws nothing when the browser refuses the request", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const request: RequestMock = vi.fn(async () => {
      throw new DOMException("Battery saver is on", "NotAllowedError");
    });
    installWakeLock(request);

    const { unmount } = renderHook(() => useScreenWakeLock());
    await flushPromises();

    expect(request).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0]?.[0]).toContain("could not be kept on");
    expect(() => unmount()).not.toThrow();
  });

  it("stops listening for the page coming back once unmounted", async () => {
    const sentinels: FakeSentinel[] = [];
    const request = grantingRequest(sentinels);
    installWakeLock(request);

    const { unmount } = renderHook(() => useScreenWakeLock());
    await flushPromises();
    unmount();

    act(() => {
      setVisibility("hidden");
      setVisibility("visible");
    });
    await flushPromises();

    expect(request).toHaveBeenCalledOnce();
  });
});
