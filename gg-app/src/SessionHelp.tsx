import type React from "react";
import {
  ArrowLeftIcon,
  BrainIcon,
  CaretRightIcon,
  ChatCircleTextIcon,
  CheckSquareIcon,
  CpuIcon,
  GitCommitIcon,
  ListChecksIcon,
  MicrophoneIcon,
  NotepadIcon,
  PaperclipIcon,
  PaperPlaneRightIcon,
  PlusIcon,
  QuestionIcon,
  RocketLaunchIcon,
  StopCircleIcon,
} from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import type { WorkspaceMode } from "./agent";
import { Modal } from "./Modal";
import { isPhone } from "./platform";
import "./session-help.css";

interface HelpTopic {
  id: string;
  icon: Icon;
  title: string;
  body: string;
}

interface HelpSection {
  heading: string;
  topics: HelpTopic[];
}

/** The guide's topics for a mode: only what that mode's screen shows. */
export function sessionHelpSections(mode: WorkspaceMode, phone: boolean): HelpSection[] {
  const code = mode === "code";
  const basics: HelpTopic[] = [
    {
      id: "message",
      icon: PaperPlaneRightIcon,
      title: "Message Kleio",
      body: phone
        ? "Type in the box at the bottom and tap send. Return adds a new line."
        : "Type in the box at the bottom and press Return to send. Shift+Return adds a new line.",
    },
    {
      id: "attach",
      icon: PaperclipIcon,
      title: "Attach files",
      body: phone
        ? "Tap the paperclip to add images or videos to your message."
        : "Click the paperclip to add images or videos, or drop files onto the window.",
    },
    {
      id: "dictate",
      icon: MicrophoneIcon,
      title: "Dictate",
      body: "Tap the mic beside send to record, then tap it again to stop. The text lands in the box so you can check it before sending.",
    },
    {
      id: "stop",
      icon: StopCircleIcon,
      title: "Stop",
      body: phone
        ? "While Kleio works, send turns into stop. Tap it to cancel the run."
        : "While Kleio works, send turns into stop. Click it or press Esc to cancel the run.",
    },
  ];

  const model: HelpTopic = code
    ? {
        id: "models",
        icon: CpuIcon,
        title: "Models",
        body: "The Kleio picker in the bottom bar chooses Kleio's model. The Helper picker follows Kleio's unless you pin one, and Thinking sets how hard the model reasons when it supports it.",
      }
    : {
        id: "models",
        icon: CpuIcon,
        title: "Model",
        body: "The picker in the bottom bar chooses Kleio's model. Thinking sets how hard it reasons when the model supports it.",
      };

  const back: HelpTopic = {
    id: "back",
    icon: ArrowLeftIcon,
    title: "Back",
    body:
      mode === "chat"
        ? "The back arrow returns to your chats."
        : mode === "motion"
          ? "The back arrow returns to your motion sessions."
          : "The back arrow returns to this project's sessions.",
  };
  const newSession: HelpTopic = {
    id: "new",
    icon: PlusIcon,
    title: mode === "chat" ? "New chat" : "New session",
    body:
      mode === "chat"
        ? "New starts a fresh chat with an empty context. This one stays saved and you can reopen it from the list."
        : "New starts a fresh session with an empty context. This one stays saved and you can reopen it from the session list.",
  };

  if (!code) {
    const yours: HelpTopic[] = [newSession, back];
    if (mode === "chat") {
      yours.push({
        id: "brain",
        icon: BrainIcon,
        title: "Brain",
        body: "Brain shows what Kleio remembers from your chats, so you can review and curate it.",
      });
    }
    return [
      { heading: "Basics", topics: [...basics, model] },
      { heading: mode === "chat" ? "Your chats" : "Your sessions", topics: yours },
    ];
  }

  return [
    { heading: "Basics", topics: basics },
    {
      heading: "Working with Helper",
      topics: [
        {
          id: "muse",
          icon: ChatCircleTextIcon,
          title: "Ask Helper",
          body: phone
            ? "Start a message with @helper, or tap the @helper button, to ask Helper. It answers alongside Kleio's work without stopping it, and it can read your project but not change it."
            : "Start a message with @helper to ask Helper. It answers alongside Kleio's work without stopping it, and it can read your project but not change it.",
        },
        {
          id: "autopilot",
          icon: RocketLaunchIcon,
          title: "Autopilot",
          body: "With Autopilot on in the header, Helper reviews Kleio's work when a run finishes and sends it back for fixes if needed. It pauses after a few rounds so you can take a look.",
        },
        model,
      ],
    },
    {
      heading: "Plans and questions",
      topics: [
        {
          id: "plans",
          icon: ListChecksIcon,
          title: "Plans",
          body: "When Kleio proposes a plan, choose Accept to build it, Feedback to ask for changes, or Reject to set it aside.",
        },
        {
          id: "questions",
          icon: QuestionIcon,
          title: "Questions",
          body: "When Kleio needs a decision, a question appears in the conversation. Pick an option or type your own answer. If the app is in the background, you also get a notification.",
        },
      ],
    },
    {
      heading: "Your sessions",
      topics: [
        newSession,
        back,
        {
          id: "notes",
          icon: NotepadIcon,
          title: "Notes",
          body: "Notes opens your notes for this project.",
        },
        {
          id: "tasks",
          icon: CheckSquareIcon,
          title: "Tasks",
          body: "Tasks lists this project's tasks and lets you run them.",
        },
        {
          id: "commit",
          icon: GitCommitIcon,
          title: "Commit",
          body: "The commit button in the header runs your commit command. In a folder without Git it offers to set Git up instead.",
        },
      ],
    },
  ];
}

interface SessionHelpProps {
  mode: WorkspaceMode;
  onClose: () => void;
  /** Defaults to the running platform; injectable for tests. */
  phone?: boolean;
}

/** The session screen's guide: a card on the Mac, a bottom sheet on the iPhone. */
export function SessionHelp({
  mode,
  onClose,
  phone = isPhone(),
}: SessionHelpProps): React.ReactElement {
  const sections = sessionHelpSections(mode, phone);
  return (
    <Modal
      title="How this screen works"
      onClose={onClose}
      className={phone ? "session-help session-help-sheet" : "session-help"}
    >
      <div className="session-help-body">
        {sections.map((section) => (
          <section key={section.heading} className="session-help-section">
            <h3 className="session-help-heading">{section.heading}</h3>
            {phone ? (
              <div className="session-help-list">
                {section.topics.map(({ id, icon: TopicIcon, title, body }) => (
                  <details key={id} className="session-help-topic">
                    <summary className="session-help-summary">
                      <TopicIcon size={20} aria-hidden="true" className="session-help-icon" />
                      <span className="session-help-title">{title}</span>
                      <CaretRightIcon size={14} aria-hidden="true" className="session-help-caret" />
                    </summary>
                    <p className="session-help-text">{body}</p>
                  </details>
                ))}
              </div>
            ) : (
              <ul className="session-help-grid">
                {section.topics.map(({ id, icon: TopicIcon, title, body }) => (
                  <li key={id} className="session-help-row">
                    <TopicIcon size={20} aria-hidden="true" className="session-help-icon" />
                    <div>
                      <div className="session-help-title">{title}</div>
                      <p className="session-help-text">{body}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </Modal>
  );
}
