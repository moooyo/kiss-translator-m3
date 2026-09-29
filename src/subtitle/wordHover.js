import { apiMicrosoftDict } from "../apis/index.js";
import { logger } from "../libs/log.js";
import { trustedTypesHelper } from "../libs/trustedTypes.js";
import {
  createFavoriteButton,
  saveFavoriteWordIfMissing,
} from "./favoriteWords.js";

/**
 * 动态向网页 document.head 中注入生词 hover 及详情气泡弹窗所需的 CSS 样式
 */
export const addWordHoverStyles = () => {
  // 如果已经注入过该样式表，直接返回，避免重复创建
  if (document.getElementById("kiss-word-hover-styles")) return;

  const style = document.createElement("style");
  style.id = "kiss-word-hover-styles";
  style.textContent = `
    /* 鼠标 hover 的单词样式：呈现下划线，指示可点击查词 */
    .kiss-word-hover {
      cursor: pointer;
      text-decoration: underline;
      text-decoration-color: #4fc3f7;
      text-decoration-thickness: 2px;
    }

    /* 查词气泡弹窗主体样式 */
    .kiss-word-tooltip {
      position: fixed;
      background: rgba(0, 0, 0, 0.9);
      color: white;
      border-radius: 6px;
      padding: 12px;
      font-size: 14px;
      z-index: 2147483647;
      max-width: 300px;
      word-wrap: break-word;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
      backdrop-filter: blur(4px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      font-family: Arial, sans-serif;
    }

    /* 气泡弹窗头部（包含单词名和关闭按钮） */
    .kiss-word-tooltip-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
      font-weight: bold;
      font-size: 16px;
      color: #4fc3f7;
    }

    /* 关闭气泡弹窗的 X 按钮 */
    .kiss-word-tooltip-close {
      background: none;
      border: none;
      color: #aaa;
      cursor: pointer;
      font-size: 18px;
      padding: 0;
      margin-left: 10px;
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .kiss-word-tooltip-close:hover {
      color: white;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 50%;
    }

    /* 释义加载中状态文案 */
    .kiss-word-loading {
      color: #bbb;
      font-style: italic;
    }

    /* 单词词性释义行 */
    .kiss-word-definition {
      margin: 4px 0;
    }

    /* 词性前缀标记（如 n. / v. 等） */
    .kiss-word-pos {
      color: #4fc3f7;
      font-weight: bold;
    }

    /* 音标字符样式 */
    .kiss-word-phonetic {
      color: #bbb;
      font-style: italic;
      margin-right: 10px;
    }

    /* 例句包裹区 */
    .kiss-word-example {
      margin-top: 10px;
      padding-top: 8px;
      border-top: 1px solid #444;
    }

    .kiss-word-example-title {
      font-weight: bold;
      margin-bottom: 5px;
    }

    /* 例句英文正文 */
    .kiss-word-example-sentence {
      margin-bottom: 3px;
    }

    /* 例句中文翻译 */
    .kiss-word-example-translation {
      color: #bbb;
      font-style: italic;
    }
  `;
  document.head.appendChild(style);
};

/**
 * 使用正则表达式，将英文字幕文本中的每一个独立英文单词（包括带单引号/撇号的如 it's）使用 span 标签包裹。
 *
 * @param {string} text - 原文字幕字符串
 * @returns {string} 替换为带 span 标签的 HTML 字符串
 */
export function wrapWordsWithSpans(text) {
  return String(text || "").replace(
    /\b([a-zA-Z]+(?:'[a-zA-Z]+)?)\b/g,
    '<span class="kiss-subtitle-word" data-word="$1">$1</span>'
  );
}

const TOOLTIP_OPEN_DELAY = 300;
const TOOLTIP_HIDE_DELAY = 500;

export class WordTooltipController {
  constructor({
    getVideoContainer,
    getTimestamp,
    autoFavWord = false,
    i18n = (key, defaultText = key) => defaultText,
    onVisibilityChange,
  }) {
    this.getVideoContainer = getVideoContainer;
    this.getTimestamp = getTimestamp;
    this.autoFavWord = autoFavWord;
    this.i18n = i18n;
    this.onVisibilityChange = onVisibilityChange;
    this.tooltipEl = null;
    this.openTimeout = null;
    this.hideTimeout = null;
    this.activeWordEl = null;
    this.tooltipHovered = false;
    this.destroyed = false;
  }

  attachSpanListeners(root, getTimestamp = this.getTimestamp) {
    if (!root) return;
    this.reconcileActiveWord();

    const spans = root.querySelectorAll(".kiss-subtitle-word");
    spans.forEach((span) => {
      if (span.dataset.kissListenerAttached) return;
      const enterHandler = (event) =>
        this.#handleWordHover(event, getTimestamp);
      const leaveHandler = (event) => this.#handleWordHoverOut(event);
      span.addEventListener("pointerenter", enterHandler);
      span.addEventListener("pointerleave", leaveHandler);
      span.dataset.kissListenerAttached = "1";
    });
  }

  destroy() {
    this.destroyed = true;
    this.clearHoverState();
  }

  #cancelOpenTimer() {
    if (this.openTimeout !== null) {
      clearTimeout(this.openTimeout);
      this.openTimeout = null;
    }
  }

  #cancelHideTimer() {
    if (this.hideTimeout !== null) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }
  }

  #hasTooltipFocus() {
    return Boolean(
      this.tooltipEl?.contains(this.tooltipEl.ownerDocument.activeElement)
    );
  }

  #scheduleHideTooltip() {
    this.#cancelHideTimer();
    if (this.destroyed || this.tooltipHovered || this.#hasTooltipFocus())
      return;
    // Allow travel from the subtitles to the tooltip across the player.
    this.hideTimeout = setTimeout(() => {
      this.hideTimeout = null;
      if (
        !this.activeWordEl?.isConnected &&
        !this.tooltipHovered &&
        !this.#hasTooltipFocus()
      ) {
        this.hideWordTooltip();
      }
    }, TOOLTIP_HIDE_DELAY);
  }

  clearHoverState() {
    this.#cancelOpenTimer();
    this.activeWordEl?.classList.remove("kiss-word-hover");
    this.activeWordEl = null;
    this.hideWordTooltip();
  }

  releaseActiveWord() {
    this.#cancelOpenTimer();
    this.activeWordEl?.classList.remove("kiss-word-hover");
    this.activeWordEl = null;
    this.#scheduleHideTooltip();
  }

  reconcileActiveWord() {
    // Replacing captions does not reliably dispatch pointerleave on old spans.
    if (this.activeWordEl && !this.activeWordEl.isConnected) {
      this.releaseActiveWord();
    }
  }

  #handleWordHover(event, getTimestamp) {
    const target = event.target;
    if (this.destroyed || !target.classList.contains("kiss-subtitle-word"))
      return;

    this.#cancelOpenTimer();
    this.#cancelHideTimer();

    this.activeWordEl?.classList.remove("kiss-word-hover");
    target.classList.add("kiss-word-hover");
    this.activeWordEl = target;

    this.openTimeout = setTimeout(() => {
      this.openTimeout = null;
      if (!target.isConnected || this.activeWordEl !== target) return;
      this.showWordTooltip(target.dataset.word, {
        timestamp: getTimestamp?.() ?? 0,
      });
    }, TOOLTIP_OPEN_DELAY);
  }

  #handleWordHoverOut(event) {
    const target = event.target;
    if (this.destroyed || !target.classList.contains("kiss-subtitle-word"))
      return;

    target.classList.remove("kiss-word-hover");
    if (this.activeWordEl === target) {
      this.releaseActiveWord();
    }
  }

  async showWordTooltip(word, { timestamp = 0 } = {}) {
    if (this.destroyed) return;
    this.#cancelOpenTimer();
    this.#cancelHideTimer();
    const wasVisible = Boolean(this.tooltipEl);
    if (this.tooltipEl) {
      this.tooltipEl.remove();
    }

    const tooltipEl = document.createElement("div");
    this.tooltipEl = tooltipEl;
    this.tooltipHovered = false;
    tooltipEl.className = "kiss-word-tooltip";
    tooltipEl.innerHTML = trustedTypesHelper.createHTML(
      '<div class="kiss-word-loading">Looking up...</div>'
    );
    tooltipEl.addEventListener("pointerenter", () => {
      this.tooltipHovered = true;
      this.#cancelHideTimer();
    });
    tooltipEl.addEventListener("pointerleave", () => {
      this.tooltipHovered = false;
      this.#scheduleHideTooltip();
    });
    tooltipEl.addEventListener("focusin", () => this.#cancelHideTimer());
    tooltipEl.addEventListener("focusout", (event) => {
      if (!tooltipEl.contains(event.relatedTarget)) this.#scheduleHideTooltip();
    });
    // Register on the stable container; dictionary rendering replaces its children.
    tooltipEl.addEventListener("click", (event) => {
      if (event.target.closest?.(".kiss-word-tooltip-close")) {
        event.preventDefault();
        event.stopPropagation();
        this.hideWordTooltip();
      }
    });

    const videoContainer = this.getVideoContainer?.();
    if (videoContainer) {
      const containerRect = videoContainer.getBoundingClientRect();
      const tooltipWidth = 300;
      const tooltipHeight = 400;

      const left = containerRect.right - tooltipWidth - 45;
      const top = containerRect.top + 20;

      const maxLeft = window.innerWidth - tooltipWidth - 10;
      this.tooltipEl.style.left = Math.min(maxLeft, Math.max(10, left)) + "px";
      this.tooltipEl.style.top = Math.max(10, top) + "px";
      this.tooltipEl.style.maxWidth = tooltipWidth + "px";
      this.tooltipEl.style.maxHeight = tooltipHeight + "px";
      this.tooltipEl.style.overflow = "auto";
    }

    document.body.appendChild(this.tooltipEl);
    if (!wasVisible) this.onVisibilityChange?.(true);

    try {
      const dictResult = await apiMicrosoftDict(word);
      if (this.destroyed) return;
      const { phonetic, definition, examples } =
        this.#extractDictionaryData(dictResult);

      this.#dispatchAddWord({
        word,
        phonetic,
        definition,
        examples,
        timestamp,
      });
      const wordData = { timestamp, phonetic, definition, examples };
      const hasDictionaryResult = Boolean(
        dictResult && (dictResult.trs || dictResult.aus || dictResult.sentences)
      );
      if (this.autoFavWord && hasDictionaryResult) {
        await saveFavoriteWordIfMissing(word, wordData);
      }
      if (this.tooltipEl === tooltipEl && !this.destroyed) {
        this.#renderDictionaryResult(word, dictResult, wordData);
      }
    } catch (error) {
      if (this.destroyed) return;
      logger.info("Dictionary lookup failed for word:", word, error);
      this.#dispatchAddWord({
        word,
        phonetic: "",
        definition: "",
        examples: [],
        timestamp,
      });

      if (this.tooltipEl === tooltipEl) {
        this.tooltipEl.innerHTML =
          trustedTypesHelper.createHTML(`<div class="kiss-word-tooltip-header">
        <span>${word}</span>
        <button type="button" class="kiss-word-tooltip-close">×</button>
      </div>
      <div class="kiss-word-definition">Failed to load definition</div>`);
        this.#addFavoriteButton(word, { timestamp });
      }
    }
  }

  hideWordTooltip() {
    this.#cancelHideTimer();
    this.tooltipHovered = false;
    if (this.tooltipEl) {
      this.tooltipEl.remove();
      this.tooltipEl = null;
      this.onVisibilityChange?.(false);
    }
  }

  #extractDictionaryData(dictResult) {
    let phonetic = "";
    if (dictResult && dictResult.aus) {
      const usPhonetic = dictResult.aus.find((au) => au.key === "美");
      if (usPhonetic && usPhonetic.phonetic) {
        phonetic = usPhonetic.phonetic;
      } else if (dictResult.aus.length > 0 && dictResult.aus[0].phonetic) {
        phonetic = dictResult.aus[0].phonetic;
      }
    }

    let definition = "";
    if (dictResult && dictResult.trs) {
      definition = dictResult.trs
        .slice(0, 3)
        .map((tr) => `${tr.pos ? tr.pos + " " : ""}${tr.def}`)
        .join("; ");
    }

    let examples = [];
    if (dictResult && dictResult.sentences) {
      examples = dictResult.sentences.slice(0, 2).map((sentence) => ({
        eng: sentence.eng,
        chs: sentence.chs,
      }));
    }

    return { phonetic, definition, examples };
  }

  #dispatchAddWord(detail) {
    document.dispatchEvent(new CustomEvent("kiss-add-word", { detail }));
  }

  #addFavoriteButton(word, data) {
    const header = this.tooltipEl?.querySelector(".kiss-word-tooltip-header");
    const closeButton = header?.querySelector(".kiss-word-tooltip-close");
    if (!header || !closeButton) return;
    closeButton.setAttribute("aria-label", this.i18n("close", "Close"));

    header.insertBefore(
      createFavoriteButton({ word, data, i18n: this.i18n }),
      closeButton
    );
  }

  #renderDictionaryResult(word, dictResult, wordData) {
    if (
      dictResult &&
      (dictResult.trs || dictResult.aus || dictResult.sentences)
    ) {
      let content = `<div class="kiss-word-tooltip-header">
          <span>${word}</span>
          <button type="button" class="kiss-word-tooltip-close">×</button>
        </div>`;

      if (dictResult.aus && dictResult.aus.length > 0) {
        content += "<div>";
        dictResult.aus.forEach((au) => {
          if (au.phonetic) {
            content += `<span class="kiss-word-phonetic">${au.phonetic}</span>`;
          }
        });
        content += "</div>";
      }

      if (dictResult.trs) {
        dictResult.trs.slice(0, 3).forEach((tr) => {
          content += `<div class="kiss-word-definition">${tr.pos ? '<span class="kiss-word-pos">' + tr.pos + "</span> " : ""}${tr.def}</div>`;
        });
      }

      if (dictResult.sentences && dictResult.sentences.length > 0) {
        content += `<div class="kiss-word-example">
            <div class="kiss-word-example-title">例句</div>`;
        dictResult.sentences.slice(0, 2).forEach((sentence) => {
          content += `<div class="kiss-word-example-sentence">${sentence.eng}</div>
              <div class="kiss-word-example-translation">${sentence.chs}</div>`;
        });
        content += "</div>";
      }

      if (this.tooltipEl) {
        this.tooltipEl.innerHTML = trustedTypesHelper.createHTML(content);
        this.#addFavoriteButton(word, wordData);
      }
      return;
    }

    if (this.tooltipEl) {
      this.tooltipEl.innerHTML =
        trustedTypesHelper.createHTML(`<div class="kiss-word-tooltip-header">
          <span>${word}</span>
          <button type="button" class="kiss-word-tooltip-close">×</button>
        </div>
        <div class="kiss-word-definition">No definition found</div>`);
      this.#addFavoriteButton(word, wordData);
    }
  }
}
