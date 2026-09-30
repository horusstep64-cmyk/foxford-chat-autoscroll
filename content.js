(() => {
  "use strict";

  const BUTTON_ID = "foxford-chat-autoscroll-toggle";
  const STORAGE_KEY = "foxfordChatAutoscrollEnabled";
  const TICK_MS = 300;

  let enabled = false;
  let tickTimer = null;
  let injectQueued = false;

  const storage = {
    get() {
      return new Promise((resolve) => {
        try {
          chrome.storage.local.get(STORAGE_KEY, (value) => {
            if (chrome.runtime.lastError) {
              resolve(false);
              return;
            }
            resolve(value?.[STORAGE_KEY] === true);
          });
        } catch {
          resolve(false);
        }
      });
    },
    set(value) {
      return new Promise((resolve) => {
        try {
          chrome.storage.local.set({ [STORAGE_KEY]: value }, () => resolve());
        } catch {
          // Autoscroll still works for the current page if storage is unavailable.
          resolve();
        }
      });
    }
  };

  function isUsableScrollArea(element) {
    if (!(element instanceof HTMLElement)) return false;

    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const scrollable = style.overflowY === "auto" || style.overflowY === "scroll";

    return scrollable
      && style.display !== "none"
      && style.visibility !== "hidden"
      && rect.width > 120
      && rect.height > 100
      && element.scrollHeight > element.clientHeight + 8;
  }

  function findChatScroller() {
    const chatTab = document.querySelector('[data-testid="chat-tab"]');
    if (!chatTab || !chatTab.classList.contains("active")) return null;

    const chatRoot = document.querySelector(".ulms-chat-react")
      || chatTab.closest('[class*="ChatWrapper"]');
    if (!chatRoot) return null;

    const preferredWrapper = chatRoot.querySelector('[class*="chat_messages-wrapper"]');
    if (preferredWrapper) {
      const preferred = [...preferredWrapper.querySelectorAll("div")]
        .filter(isUsableScrollArea)
        .sort((a, b) => b.clientHeight - a.clientHeight)[0];
      if (preferred) return preferred;
    }

    return [...chatRoot.querySelectorAll("div")]
      .filter(isUsableScrollArea)
      .sort((a, b) => {
        const aScore = a.clientWidth * a.clientHeight;
        const bScore = b.clientWidth * b.clientHeight;
        return bScore - aScore;
      })[0] || null;
  }

  function scrollToLatest() {
    if (!enabled) return;
    const scroller = findChatScroller();
    if (!scroller) return;

    scroller.scrollTop = scroller.scrollHeight;
  }

  function updateButton() {
    const button = document.getElementById(BUTTON_ID);
    if (!button) return;

    const label = enabled
      ? "Автопрокрутка включена"
      : "Автопрокрутка выключена";

    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
    button.setAttribute("aria-pressed", String(enabled));
    button.dataset.enabled = String(enabled);
  }

  function setEnabled(nextValue) {
    enabled = Boolean(nextValue);
    void storage.set(enabled);
    updateButton();

    if (tickTimer !== null) {
      clearInterval(tickTimer);
      tickTimer = null;
    }

    if (enabled) {
      scrollToLatest();
      requestAnimationFrame(scrollToLatest);
      setTimeout(scrollToLatest, 100);
      tickTimer = setInterval(scrollToLatest, TICK_MS);
    }
  }

  function makeIcon() {
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 20 20");
    icon.setAttribute("width", "20");
    icon.setAttribute("height", "20");
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = `
      <path d="M10 3v9m0 0 3.5-3.5M10 12 6.5 8.5M4 16h12"
        fill="none" stroke="currentColor" stroke-width="1.7"
        stroke-linecap="round" stroke-linejoin="round" />
      <circle cx="15.5" cy="4.5" r="2.25" class="foxford-autoscroll-dot" />
    `;
    return icon;
  }

  function ensureStyles() {
    if (document.getElementById(`${BUTTON_ID}-styles`)) return;

    const style = document.createElement("style");
    style.id = `${BUTTON_ID}-styles`;
    style.textContent = `
      #${BUTTON_ID} {
        align-items: center;
        border: 0;
        color: inherit;
        cursor: pointer;
        display: flex;
        justify-content: center;
        position: relative;
        transition: background-color 120ms ease, color 120ms ease,
          box-shadow 120ms ease, transform 120ms ease;
      }

      #${BUTTON_ID}:hover {
        transform: translateY(-1px);
      }

      #${BUTTON_ID}:focus-visible {
        box-shadow: 0 0 0 3px rgba(138, 81, 230, 0.28);
        outline: none;
      }

      #${BUTTON_ID}[data-enabled="true"] {
        background: #8a51e6 !important;
        color: #fff !important;
      }

      #${BUTTON_ID} .foxford-autoscroll-dot {
        fill: #a9adb8;
        stroke: #fff;
        stroke-width: 1;
      }

      #${BUTTON_ID}[data-enabled="true"] .foxford-autoscroll-dot {
        fill: #45d483;
      }
    `;
    document.head.append(style);
  }

  function createButton(settingsButton) {
    const button = document.createElement("button");
    button.className = settingsButton.className;
    button.type = "button";
    button.id = BUTTON_ID;
    button.append(makeIcon());

    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      setEnabled(!enabled);
    });

    button.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      setEnabled(!enabled);
    });

    return button;
  }

  function injectButton() {
    injectQueued = false;
    if (document.getElementById(BUTTON_ID)) return;

    const settingsButton = document.querySelector('[data-testid="chat-settings-button"]');
    const toolbar = settingsButton?.parentElement;
    if (!settingsButton || !toolbar) return;

    ensureStyles();
    const button = createButton(settingsButton);
    settingsButton.insertAdjacentElement("afterend", button);
    updateButton();

    if (enabled) scrollToLatest();
  }

  function queueInjection() {
    if (injectQueued) return;
    injectQueued = true;
    requestAnimationFrame(injectButton);
  }

  const pageObserver = new MutationObserver((mutations) => {
    queueInjection();
    if (!enabled) return;

    const hasAddedNodes = mutations.some((mutation) => mutation.addedNodes.length > 0);
    if (hasAddedNodes) requestAnimationFrame(scrollToLatest);
  });

  async function start() {
    enabled = await storage.get();
    queueInjection();
    pageObserver.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
    if (enabled) setEnabled(true);
  }

  void start();
})();
