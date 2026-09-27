import { apiMicrosoftDict } from "../apis/index.js";
import { getWordsWithDefault, saveEdit } from "../libs/storage.js";
import { WordTooltipController, wrapWordsWithSpans } from "./wordHover";

jest.mock("../apis/index.js", () => ({ apiMicrosoftDict: jest.fn() }));
jest.mock("../libs/storage.js", () => ({
  getWordsWithDefault: jest.fn(),
  saveEdit: jest.fn(),
}));

const definition = { trs: [{ pos: "adj.", def: "Ready for use." }] };

function pointer(element, type) {
  element.dispatchEvent(new Event(type));
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("subtitle dictionary tooltip interaction", () => {
  let controller;
  let words;
  let favorites;
  let onVisibilityChange;

  beforeEach(() => {
    jest.useFakeTimers();
    favorites = {};
    apiMicrosoftDict.mockReset().mockResolvedValue(definition);
    getWordsWithDefault.mockImplementation(async () => favorites);
    saveEdit.mockReset().mockImplementation(async (_key, update) => {
      const next = update(favorites);
      const changed = next !== favorites;
      favorites = next;
      return { value: favorites, changed };
    });
    document.body.innerHTML = `<div id="captions">${wrapWordsWithSpans("ready steady")}</div><button id="outside">Outside</button>`;
    words = document.querySelectorAll(".kiss-subtitle-word");
    onVisibilityChange = jest.fn();
    controller = new WordTooltipController({
      getVideoContainer: () => document.body,
      getTimestamp: () => 1200,
      onVisibilityChange,
    });
    controller.attachSpanListeners(document.querySelector("#captions"));
  });

  afterEach(() => {
    controller.destroy();
    jest.clearAllTimers();
    jest.useRealTimers();
    document.body.innerHTML = "";
  });

  const tooltip = () => document.querySelector(".kiss-word-tooltip");

  async function hoverWord(index = 0) {
    pointer(words[index], "pointerenter");
    jest.advanceTimersByTime(300);
    await flushPromises();
    return tooltip();
  }

  test("allows crossing the player and favoriting while inside the tooltip", async () => {
    const card = await hoverWord();
    pointer(words[0], "pointerleave");
    jest.advanceTimersByTime(350);
    expect(tooltip()).toBe(card);

    pointer(card, "pointerenter");
    jest.advanceTimersByTime(1500);
    const favorite = card.querySelector(".kiss-favorite-word-button");
    expect(favorite.isConnected).toBe(true);
    favorite.click();
    await flushPromises();

    expect(favorites.ready.definition).toBe("adj. Ready for use.");
    expect(favorite.getAttribute("aria-pressed")).toBe("true");
    expect(onVisibilityChange.mock.calls).toEqual([[true]]);
  });

  test("closes after leaving both surfaces and cancels closing on reentry", async () => {
    const card = await hoverWord();
    pointer(words[0], "pointerleave");
    pointer(card, "pointerenter");
    pointer(card, "pointerleave");
    jest.advanceTimersByTime(400);
    pointer(card, "pointerenter");
    jest.advanceTimersByTime(600);
    expect(tooltip()).toBe(card);

    pointer(card, "pointerleave");
    jest.advanceTimersByTime(499);
    expect(tooltip()).toBe(card);
    jest.advanceTimersByTime(1);
    expect(tooltip()).toBeNull();
    expect(onVisibilityChange.mock.calls).toEqual([[true], [false]]);
  });

  test("keeps keyboard controls available until focus leaves the tooltip", async () => {
    const card = await hoverWord();
    pointer(words[0], "pointerleave");
    const favorite = card.querySelector(".kiss-favorite-word-button");
    favorite.focus();
    jest.advanceTimersByTime(1000);
    expect(tooltip()).toBe(card);
    card.querySelector(".kiss-word-tooltip-close").focus();
    jest.advanceTimersByTime(1000);
    expect(tooltip()).toBe(card);

    document.querySelector("#outside").focus();
    jest.advanceTimersByTime(500);
    expect(tooltip()).toBeNull();
  });

  test.each(["success", "empty", "failure"])(
    "closes a %s lookup through a real button listener",
    async (outcome) => {
      if (outcome === "empty") apiMicrosoftDict.mockResolvedValue(null);
      if (outcome === "failure")
        apiMicrosoftDict.mockRejectedValue(new Error("Unavailable"));
      const card = await hoverWord();
      const close = card.querySelector(".kiss-word-tooltip-close");
      expect(close.getAttribute("aria-label")).toBe("Close");
      expect(close.getAttribute("onclick")).toBeNull();
      close.click();

      expect(tooltip()).toBeNull();
      expect(controller.tooltipEl).toBeNull();
      expect(onVisibilityChange.mock.calls).toEqual([[true], [false]]);
    }
  );

  test("does not open a lookup after a brief word hover", () => {
    pointer(words[0], "pointerenter");
    jest.advanceTimersByTime(100);
    pointer(words[0], "pointerleave");
    jest.advanceTimersByTime(1000);
    expect(apiMicrosoftDict).not.toHaveBeenCalled();
    expect(tooltip()).toBeNull();
  });

  test.each(["resolve", "reject"])(
    "does not paint an older %s response over the next word",
    async (completion) => {
      const first = deferred();
      const second = deferred();
      apiMicrosoftDict
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise);
      await hoverWord();
      pointer(words[0], "pointerleave");
      const nextCard = await hoverWord(1);
      if (completion === "resolve") first.resolve(definition);
      else first.reject(new Error("Old lookup failed"));
      await flushPromises();
      expect(tooltip()).toBe(nextCard);
      expect(nextCard.textContent).toBe("Looking up...");
      second.resolve(definition);
      await flushPromises();
      expect(
        nextCard.querySelector(".kiss-word-tooltip-header span").textContent
      ).toBe("steady");
      expect(onVisibilityChange.mock.calls).toEqual([[true]]);
    }
  );

  test("clears a hovered tooltip and pending lookup when destroyed", async () => {
    const result = deferred();
    apiMicrosoftDict.mockReturnValue(result.promise);
    const card = await hoverWord();
    pointer(words[0], "pointerleave");
    pointer(card, "pointerenter");
    controller.destroy();
    result.resolve(definition);
    await flushPromises();
    pointer(words[0], "pointerenter");
    jest.advanceTimersByTime(1000);

    expect(tooltip()).toBeNull();
    expect(apiMicrosoftDict).toHaveBeenCalledTimes(1);
    expect(onVisibilityChange.mock.calls).toEqual([[true], [false]]);
    expect(saveEdit).not.toHaveBeenCalled();
  });
});
