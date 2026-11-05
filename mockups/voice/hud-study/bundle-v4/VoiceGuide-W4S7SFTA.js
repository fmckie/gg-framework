import {
  a,
  a2,
  e,
  e10 as e4,
  e3 as e2,
  e4 as e3,
  n,
  o2 as o,
  o4 as o2,
  r2 as r,
  r3 as r2,
  require_react_dom,
  useDialogFocus
} from "./chunk-OSWQ6Q4Z.js";
import {
  __toESM,
  require_jsx_runtime,
  require_react
} from "./chunk-7HJLIOEM.js";

// mockups/voice/before/source/Modal.tsx
var import_react2 = __toESM(require_react(), 1);
var import_react_dom2 = __toESM(require_react_dom(), 1);

// mockups/voice/before/source/theme.ts
var theme = {
  // Surfaces: near-black, separated by lightness alone.
  background: "var(--bg)",
  surface1: "var(--surface-1)",
  surface2: "var(--surface-2)",
  border: "var(--border)",
  borderStrong: "var(--border-strong)",
  // Text: one ink at four levels.
  text: "var(--text)",
  textSecondary: "var(--text-secondary)",
  textMuted: "var(--text-muted)",
  textDim: "var(--text-dim)",
  // Accent: periwinkle, luminous enough to carry near-black text on a fill.
  primary: "var(--primary)",
  // The ink that fill carries. Anything placed ON a primary surface (a badge
  // inside a selected pill, for one) has to switch to this or it is unreadable.
  onPrimary: "var(--on-primary)",
  secondary: "var(--secondary)",
  success: "var(--success)",
  warning: "var(--warning)",
  error: "var(--error)",
  info: "var(--info)",
  // Aliases mapped onto the accent family for existing consumers.
  accent: "var(--primary)",
  code: "var(--text)",
  language: "var(--info)",
  footerText: "var(--text-muted)",
  commandColor: "var(--primary)",
  inputBackground: "var(--surface-1)",
  // User text + chip: shared by the user bubble and the chat input so the
  // "this is you" color reads identically in both places.
  userText: "var(--user-text)",
  userBackground: "var(--user-bg)",
  // Ken Kai (mentor agent): soft cyan. Used as the FULL text color of Ken's
  // replies (and the @Ken active chip in the input), so it must read well as
  // body text on the dark canvas. Distinct from the GG Coder blue dot and the
  // greener `info` teal: the color IS the only signal that a reply is Ken's.
  ken: "var(--ken)"
};

// mockups/voice/before/source/view-transition.ts
var import_react_dom = __toESM(require_react_dom(), 1);
function withViewTransition(update) {
  const reduceMotion = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion || typeof document.startViewTransition !== "function") {
    update();
    return;
  }
  const transition = document.startViewTransition(() => (0, import_react_dom.flushSync)(update));
  transition.ready.catch(ignoreSkipped);
  transition.finished.catch(ignoreSkipped);
}
function ignoreSkipped() {
}

// mockups/voice/before/source/modal-embed.tsx
var import_react = __toESM(require_react(), 1);
var import_jsx_runtime = __toESM(require_jsx_runtime(), 1);
var ModalEmbedContext = (0, import_react.createContext)("none");
function ModalEmbedProvider({
  state,
  children
}) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ModalEmbedContext.Provider, { value: state, children });
}
function useModalEmbedState() {
  return (0, import_react.useContext)(ModalEmbedContext);
}

// mockups/voice/before/source/Modal.tsx
var import_jsx_runtime2 = __toESM(require_jsx_runtime(), 1);
function Modal(props) {
  return useModalEmbedState() === "embed" ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(ModalSection, { ...props }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(ModalDialog, { ...props });
}
function ModalSection({ title, children, className }) {
  const titleId = (0, import_react2.useId)();
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
    "section",
    {
      className: className ? `settings-panel ${className}` : "settings-panel",
      "aria-labelledby": titleId,
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h2", { id: titleId, className: "sr-only", children: title }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(ModalEmbedProvider, { state: "panel", children })
      ]
    }
  );
}
function ModalDialog({ title, children, onClose, className }) {
  const dialogRef = (0, import_react2.useRef)(null);
  const titleId = (0, import_react2.useId)();
  const dismiss = () => withViewTransition(onClose);
  useDialogFocus(dialogRef, dismiss);
  return (0, import_react_dom2.createPortal)(
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
      "div",
      {
        className: "modal-backdrop",
        onMouseDown: (event) => {
          if (event.target === event.currentTarget) dismiss();
        },
        children: /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
          "div",
          {
            ref: dialogRef,
            className: className ? `modal ${className}` : "modal",
            style: { background: theme.surface2, borderColor: theme.border },
            role: "dialog",
            "aria-modal": "true",
            "aria-labelledby": titleId,
            tabIndex: -1,
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "modal-head", children: [
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h2", { id: titleId, className: "modal-title", style: { color: theme.text }, children: title }),
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                  "button",
                  {
                    className: "modal-close",
                    type: "button",
                    "aria-label": "Close",
                    title: "Close",
                    onClick: dismiss,
                    children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(e4, { size: 14, weight: "bold", "aria-hidden": "true" })
                  }
                )
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(ModalEmbedProvider, { state: "none", children })
            ]
          }
        )
      }
    ),
    document.body
  );
}

// mockups/voice/before/source/platform.ts
function isPhone(doc = document) {
  return doc.documentElement.classList.contains("platform-ios");
}

// mockups/voice/before/source/kleio/VoiceGuide.tsx
var import_jsx_runtime3 = __toESM(require_jsx_runtime(), 1);
var VOICE_GUIDE = [
  {
    heading: "What she can do",
    topics: [
      {
        id: "read",
        icon: o,
        title: "Catch you up on your work",
        body: "She can read any chat, coding session, specialist or group chat, see how your projects are going, and brief you on what needs you, what finished and what failed."
      },
      {
        id: "show",
        icon: o2,
        title: "Show you things while you talk",
        body: "She can read out the reports and documents your chats, coding sessions, specialists, groups and projects made, and put them up beside her while the call goes on: documents, PDFs and pictures, including your projects' plans and images they made. She can show a web page she found as a picture of the page, with Open in browser for the page itself. Tap what she shows to see it full size. Say \u201Cclose it\u201D, or tap \xD7, to take it down. Web pages and PDFs need a Mac host on macOS 14 or later."
      },
      {
        id: "send",
        icon: a2,
        title: "Write prompts and send them",
        body: "She can write a prompt for Kleio, a specialist or a group chat, or a brief for a coding agent in one of your projects, read it back to you, and send it only once you say yes. Research and reports go to a new chat; she only makes a new project when you ask for one by name."
      },
      {
        id: "web",
        icon: e2,
        title: "Search the internet",
        body: "For anything outside your work, like news, prices or how something works, she can search the web and tell you what she found."
      },
      {
        id: "memory",
        icon: r,
        title: "Remember you",
        body: "When Brain is set up, she knows the memories Kleio keeps about you, the same ones text chat uses, and saves new ones when you tell her something worth keeping."
      }
    ]
  },
  {
    heading: "What she won't do",
    topics: [
      {
        id: "no-orchestrate",
        icon: r2,
        title: "Run a job on her own",
        body: "She won't plan out a job and pass it from agent to agent by herself. Every prompt she sends and every chat or project she starts is one you asked for, so you stay in control of the work."
      },
      {
        id: "no-act",
        icon: a,
        title: "Act on what she reads",
        body: "Instructions inside a web page, file or chat are information to her, not orders. Sending, starting or changing anything needs you to ask. If she has read something since you last spoke, she asks before opening a web page, because opening one contacts its site."
      },
      {
        id: "no-code",
        icon: e,
        title: "Change your files or code",
        body: "She can't edit anything herself. Coding work goes to a coding agent, with a brief you approved."
      },
      {
        id: "no-sign-in",
        icon: n,
        title: "Sign in to websites as you",
        body: "Your host opens web pages without your accounts, so a page that needs your login or a subscription shows its sign-in or paywall page. Open it in your browser to see yours."
      }
    ]
  },
  {
    heading: "Your data",
    topics: [
      {
        id: "openai",
        icon: e3,
        title: "Runs on OpenAI",
        body: "Kleio Voice uses OpenAI's model with your own API key. To answer you, what she reads goes to OpenAI, including your memories, chats, files and project details."
      }
    ]
  }
];
var GUIDE_INTRO = "Kleio Voice is a way to talk with your work, with a bit of Kleio's personality: ask what's happening, hear it in plain words, and decide what happens next.";
function VoiceGuide({ onClose, phone = isPhone() }) {
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
    Modal,
    {
      title: "What Kleio Voice can do",
      onClose,
      className: phone ? "session-help session-help-sheet voice-guide" : "session-help voice-guide",
      children: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "session-help-body", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "voice-guide-intro", children: GUIDE_INTRO }),
        VOICE_GUIDE.map((section) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("section", { className: "session-help-section", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("h3", { className: "session-help-heading", children: section.heading }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("ul", { className: "session-help-grid", children: section.topics.map(({ id, icon: TopicIcon, title, body }) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("li", { className: "session-help-row", children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(TopicIcon, { size: 20, "aria-hidden": "true", className: "session-help-icon" }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "session-help-title", children: title }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "session-help-text", children: body })
            ] })
          ] }, id)) })
        ] }, section.heading))
      ] })
    }
  );
}
export {
  VOICE_GUIDE,
  VoiceGuide
};
