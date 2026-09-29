import { act } from "react";
import { createRoot } from "react-dom/client";
import Playground from "./Playground";
import { parseTerms } from "../../libs/terms";
import { generateTermTestText } from "../../libs/termTestUtils";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const TERMS_KEY = "kt-playground-terms-draft";
const AI_TERMS_KEY = "kt-playground-aiterms-draft";
const SEED_KEY = "kt-playground-term-seed";
const mockMatchRule = jest.fn();
const mockAlert = { success: jest.fn(), error: jest.fn() };

// Keep both draft components and the computation pipeline real. Only unrelated
// tabs, configuration providers, and network or extension boundaries are mocked.
jest.mock("../Selection/TranForm", () => () => null);
jest.mock("./SubtitleSegmentationPlayground", () => () => null);
jest.mock("../../apis", () => ({ apiTranslate: jest.fn() }));
jest.mock("../../hooks/Alert", () => ({ useAlert: () => mockAlert }));
jest.mock("../../hooks/I18n", () => ({ useI18n: () => (key) => key }));
jest.mock("../../hooks/Rules", () => ({ useRules: () => ({ list: [] }) }));
jest.mock("../../hooks/Setting", () => ({
  useSetting: () => ({
    setting: {
      transApis: [],
      prompts: [],
      subtitleSetting: {},
      tranboxSetting: {},
      injectRules: false,
      subrulesList: [],
    },
  }),
}));
jest.mock("../../libs/rules", () => ({
  matchRule: (...args) => mockMatchRule(...args),
}));
jest.mock("../../libs/log", () => ({
  ...jest.requireActual("../../libs/log"),
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

let container;
let root;

const query = (testId) => container.querySelector(`[data-testid="${testId}"]`);
const termsInput = () =>
  query("terminology-terms-input").querySelector("textarea");
const aiTermsInput = () =>
  query("terminology-ai-terms-input").querySelector("textarea");
const exampleText = () => query("terminology-example-text")?.textContent || "";

const notifyStorage = (key, newValue = null) => {
  window.dispatchEvent(
    new StorageEvent("storage", {
      key,
      newValue,
      storageArea: window.localStorage,
    })
  );
};

const advanceTime = (milliseconds) => {
  act(() => jest.advanceTimersByTime(milliseconds));
};

const enterDraft = (input, value) => {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value"
  ).set;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

const click = (testId) => {
  act(() => {
    query(testId).dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

async function mountPlayground() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  // This is a React root, not a Testing Library render helper.
  // eslint-disable-next-line testing-library/no-unnecessary-act
  act(() => root.render(<Playground />));
  await act(async () => {
    container
      .querySelectorAll('[role="tab"]')[2]
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  window.localStorage.clear();
  mockMatchRule.mockReset().mockResolvedValue(null);
  mockAlert.success.mockClear();
  mockAlert.error.mockClear();
});

afterEach(() => {
  if (root) act(() => root.unmount());
  root = null;
  container?.remove();
  jest.useRealTimers();
  jest.restoreAllMocks();
  window.localStorage.clear();
});

test("remote terms replace pending computation and the test uses the current draft", async () => {
  window.localStorage.setItem(TERMS_KEY, "API,Interface");
  await mountPlayground();
  expect(exampleText()).toContain("API");

  enterDraft(termsInput(), "LOCAL,Pending");
  advanceTime(100);
  window.localStorage.setItem(TERMS_KEY, "DATABASE,Storage");
  act(() => notifyStorage(TERMS_KEY, "DATABASE,Storage"));
  expect(termsInput().value).toBe("DATABASE,Storage");

  // The test button must not report the previous example during the debounce.
  click("terminology-run-test");
  expect(JSON.stringify(mockAlert.success.mock.calls.at(-1)[0])).toContain(
    "DATABASE"
  );
  advanceTime(300);
  expect(exampleText()).toContain("DATABASE");
  expect(exampleText()).not.toContain("LOCAL");

  window.localStorage.setItem(TERMS_KEY, "bad[regex,Rejected");
  act(() => notifyStorage(TERMS_KEY, "bad[regex,Rejected"));
  click("terminology-run-test");
  expect(mockAlert.error).toHaveBeenLastCalledWith(
    "terminology_playground_alert_invalid_terms"
  );
});

test("remote terms and seed update the example without a local input handler", async () => {
  window.localStorage.setItem(TERMS_KEY, "API,Interface");
  await mountPlayground();
  enterDraft(termsInput(), "LOCAL,Pending");
  advanceTime(100);
  window.localStorage.setItem(TERMS_KEY, "DATABASE,Storage");
  act(() => notifyStorage(TERMS_KEY, "DATABASE,Storage"));
  advanceTime(300);
  expect(exampleText()).toContain("DATABASE");
  expect(exampleText()).not.toContain("LOCAL");

  const originalExample = exampleText();
  const parsed = parseTerms("DATABASE,Storage");
  const seed = Array.from({ length: 8 }, (_, index) => String(index + 1)).find(
    (value) => generateTermTestText(parsed, value)[0].text !== originalExample
  );
  expect(seed).toBeDefined();
  window.localStorage.setItem(SEED_KEY, seed);
  act(() => notifyStorage(SEED_KEY, seed));
  advanceTime(300);
  expect(exampleText()).toBe(generateTermTestText(parsed, seed)[0].text);

  window.localStorage.removeItem(TERMS_KEY);
  act(() => notifyStorage(TERMS_KEY));
  advanceTime(300);
  expect(termsInput().value).toBe("");
  expect(exampleText()).toBe("");
  act(() => window.dispatchEvent(new Event("pagehide")));
  expect(window.localStorage.getItem(TERMS_KEY)).toBeNull();
});

test.each(["draft", "delete", "clear"])(
  "pending rule initialization respects a remote %s in the same React batch",
  async (change) => {
    let resolveRule;
    mockMatchRule.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRule = resolve;
        })
    );
    await mountPlayground();
    expect(termsInput().value).toBe("");

    await act(async () => {
      if (change === "draft") {
        window.localStorage.setItem(TERMS_KEY, "DATABASE,Storage");
        notifyStorage(TERMS_KEY, "DATABASE,Storage");
      } else {
        // A missing draft can still receive a deletion notification while its
        // initial rule is pending; default content must not recreate that key.
        window.localStorage.setItem(TERMS_KEY, "TEMP,Temporary");
        if (change === "clear") window.localStorage.clear();
        else window.localStorage.removeItem(TERMS_KEY);
        notifyStorage(change === "clear" ? null : TERMS_KEY);
      }
      resolveRule({ pattern: "*", terms: "RULE,Existing" });
      await Promise.resolve();
    });
    advanceTime(300);
    expect(termsInput().value).toBe(
      change === "draft" ? "DATABASE,Storage" : ""
    );
    expect(window.localStorage.getItem(TERMS_KEY)).toBe(
      change === "draft" ? "DATABASE,Storage" : null
    );
  }
);

test.each(["update", "delete", "clear"])(
  "queued %s notifications preserve newer saved values and pending local edits",
  async (notification) => {
    window.localStorage.setItem(TERMS_KEY, "API,Interface");
    window.localStorage.setItem(AI_TERMS_KEY, "API,Interface");
    window.localStorage.setItem(SEED_KEY, "4");
    await mountPlayground();

    enterDraft(termsInput(), "DATABASE,Storage");
    enterDraft(aiTermsInput(), "DATABASE,Storage");
    click("terminology-rotate-seed");
    // External writes can be restored before the local guarded save succeeds.
    window.localStorage.setItem(TERMS_KEY, "TEMP,Temporary");
    window.localStorage.setItem(TERMS_KEY, "API,Interface");
    advanceTime(200);
    expect(window.localStorage.getItem(TERMS_KEY)).toBe("DATABASE,Storage");

    enterDraft(termsInput(), "CACHE,Engine");
    enterDraft(aiTermsInput(), "CACHE,Engine");
    click("terminology-rotate-seed");
    act(() => {
      if (notification === "clear") {
        notifyStorage(null);
      } else {
        notifyStorage(
          TERMS_KEY,
          notification === "delete" ? null : "API,Interface"
        );
        notifyStorage(
          AI_TERMS_KEY,
          notification === "delete" ? null : "API,Interface"
        );
        notifyStorage(SEED_KEY, notification === "delete" ? null : "4");
      }
    });
    expect(termsInput().value).toBe("CACHE,Engine");
    expect(aiTermsInput().value).toBe("CACHE,Engine");
    expect(query("terminology-seed").textContent).toBe("6");
    advanceTime(300);
    expect(window.localStorage.getItem(TERMS_KEY)).toBe("CACHE,Engine");
    expect(window.localStorage.getItem(AI_TERMS_KEY)).toBe("CACHE,Engine");
    expect(window.localStorage.getItem(SEED_KEY)).toBe("6");

    enterDraft(termsInput(), "FINAL,Result");
    act(() => window.dispatchEvent(new Event("pagehide")));
    expect(window.localStorage.getItem(TERMS_KEY)).toBe("FINAL,Result");
  }
);

test.each(["debounce", "pagehide"])(
  "a rejected %s save reconciles unseen storage and allows the next edit",
  async (flush) => {
    window.localStorage.setItem(TERMS_KEY, "API,Interface");
    await mountPlayground();
    enterDraft(termsInput(), "LOCAL,Pending");
    window.localStorage.setItem(TERMS_KEY, "REMOTE,Current");
    if (flush === "debounce") advanceTime(200);
    else act(() => window.dispatchEvent(new Event("pagehide")));
    expect(window.localStorage.getItem(TERMS_KEY)).toBe("REMOTE,Current");
    expect(termsInput().value).toBe("REMOTE,Current");

    enterDraft(termsInput(), "FINAL,Result");
    advanceTime(300);
    expect(window.localStorage.getItem(TERMS_KEY)).toBe("FINAL,Result");
  }
);
