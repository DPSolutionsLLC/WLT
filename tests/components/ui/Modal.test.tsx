// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { Modal } from "@/components/ui/Modal";

// ONE CASE, AND IT IS THE ONE THAT BROKE: a Modal opened inside another Modal. React propagates a
// dialog's `close` event through the component tree, so closing the inner window used to close
// the outer one as well (the References search window inside the References modal, p4-sacrament-c).

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
  };
});

describe("Modal", () => {
  it("closes only the dialog that closed, never the Modal it sits inside", () => {
    const onOuterClose = vi.fn();
    const onInnerClose = vi.fn();

    render(
      <Modal isOpen onClose={onOuterClose} title="Outer">
        <Modal isOpen onClose={onInnerClose} title="Inner">
          <p>Inner body</p>
        </Modal>
      </Modal>,
    );

    const [, inner] = document.querySelectorAll("dialog");
    inner.dispatchEvent(new Event("close"));

    expect(onInnerClose).toHaveBeenCalledTimes(1);
    expect(onOuterClose).not.toHaveBeenCalled();
  });

  it("still closes itself", () => {
    const onClose = vi.fn();

    render(
      <Modal isOpen onClose={onClose} title="Only">
        <p>Body</p>
      </Modal>,
    );

    document.querySelector("dialog")!.dispatchEvent(new Event("close"));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
