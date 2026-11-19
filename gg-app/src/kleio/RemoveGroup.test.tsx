// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { RemoveGroup, RemoveItem } from "./RemoveGroup";

afterEach(cleanup);

function renderItem(onRemove: () => Promise<void> = vi.fn(async () => {})): typeof onRemove {
  render(
    <RemoveGroup>
      <RemoveItem
        what="OpenAI key, saved on your host"
        ask="Remove OpenAI key"
        confirm="Remove OpenAI key"
        busyText="Removing…"
        hint="Talk now stops until a key is added again."
        onRemove={onRemove}
        describeError={(e) => `Couldn't remove it: ${e instanceof Error ? e.message : String(e)}`}
      />
    </RemoveGroup>,
  );
  return onRemove;
}

const ask = (): HTMLElement => screen.getByRole("button", { name: "Remove OpenAI key…" });
const confirm = (): HTMLElement => screen.getByRole("button", { name: "Remove OpenAI key" });

describe("RemoveGroup", () => {
  it("is a region named Remove that says what would go", () => {
    renderItem();
    const group = screen.getByRole("region", { name: "Remove" });
    expect(within(group).getByText("OpenAI key, saved on your host")).toBeTruthy();
    expect(within(group).getAllByRole("button")).toHaveLength(1);
  });

  it("asks first: nothing is removed by the first click, and focus moves to Keep", () => {
    const onRemove = renderItem();
    // Opening the page doesn't take focus.
    expect(document.activeElement).toBe(document.body);

    fireEvent.click(ask());

    expect(onRemove).not.toHaveBeenCalled();
    expect(screen.getByText("Talk now stops until a key is added again.")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Keep" }));
    expect(confirm()).toBeTruthy();
  });

  it("goes back with Keep, removing nothing, and returns focus to the first button", () => {
    const onRemove = renderItem();
    fireEvent.click(ask());

    fireEvent.click(screen.getByRole("button", { name: "Keep" }));

    expect(onRemove).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Keep" })).toBeNull();
    expect(screen.queryByText("Talk now stops until a key is added again.")).toBeNull();
    expect(document.activeElement).toBe(ask());
  });

  it("removes on the confirm click, once", async () => {
    const onRemove = renderItem();
    fireEvent.click(ask());

    await act(async () => {
      fireEvent.click(confirm());
    });

    expect(onRemove).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Keep" })).toBeNull();
  });

  it("says it's removing, and takes no second answer, until the host replies", async () => {
    let done: () => void = () => {};
    const onRemove = renderItem(
      vi.fn(
        () =>
          new Promise<void>((resolve) => {
            done = resolve;
          }),
      ),
    );
    fireEvent.click(ask());
    fireEvent.click(confirm());

    const busy = screen.getByRole("button", { name: "Removing…" });
    expect(busy.hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Keep" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(busy);
    expect(onRemove).toHaveBeenCalledOnce();

    await act(async () => {
      done();
    });
    expect(ask()).toBeTruthy();
  });

  it("says why it couldn't, as an alert, and stays on the confirm step", async () => {
    renderItem(
      vi.fn(async () => {
        throw new Error("forbidden");
      }),
    );
    fireEvent.click(ask());

    await act(async () => {
      fireEvent.click(confirm());
    });

    expect(screen.getByRole("alert").textContent).toBe("Couldn't remove it: forbidden");
    expect(screen.getByRole("button", { name: "Keep" })).toBeTruthy();
    expect(confirm().hasAttribute("disabled")).toBe(false);

    // Keep clears what went wrong.
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
