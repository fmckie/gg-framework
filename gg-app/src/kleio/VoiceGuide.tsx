// "What Kleio's voice can do": what she can and can't do on a call, in plain
// words. Opened from Settings (Talk to Kleio) and from the voice screen. Each
// claim matches a tool she has (kleio-host voice.ts VOICE_TOOLS) or a limit
// the app enforces; keep them in step when a tool is added or removed.

import {
  BrainIcon,
  ChatsCircleIcon,
  CodeIcon,
  EyeIcon,
  GlobeIcon,
  HandIcon,
  LockKeyIcon,
  PaperPlaneTiltIcon,
  ProhibitIcon,
  type Icon,
} from "@phosphor-icons/react";
import { Modal } from "../Modal";
import { isPhone } from "../platform";
import "../session-help.css";

interface GuideTopic {
  readonly id: string;
  readonly icon: Icon;
  readonly title: string;
  readonly body: string;
}

interface GuideSection {
  readonly heading: string;
  readonly topics: readonly GuideTopic[];
}

export const VOICE_GUIDE: readonly GuideSection[] = [
  {
    heading: "What she can do",
    topics: [
      {
        id: "read",
        icon: ChatsCircleIcon,
        title: "Catch you up on your work",
        body: "She can read any chat, coding session, specialist or group chat, see how your projects are going, and brief you on what needs you, what finished and what failed.",
      },
      {
        id: "show",
        icon: EyeIcon,
        title: "Read and show your files",
        body: "She can read out the reports and documents your chats, coding sessions, specialists, groups and projects made, and pull one up on your screen without ending the call.",
      },
      {
        id: "send",
        icon: PaperPlaneTiltIcon,
        title: "Write prompts and send them",
        body: "She can write a prompt for Kleio, a specialist or a group chat, or a brief for a coding agent in one of your projects, read it back to you, and send it only once you say yes. Research and reports go to a new chat; she only makes a new project when you ask for one by name.",
      },
      {
        id: "web",
        icon: GlobeIcon,
        title: "Search the internet",
        body: "For anything outside your work, like news, prices or how something works, she can search the web and tell you what she found.",
      },
      {
        id: "memory",
        icon: BrainIcon,
        title: "Remember you",
        body: "When Brain is set up, she knows the memories Kleio keeps about you, the same ones text chat uses, and saves new ones when you tell her something worth keeping.",
      },
    ],
  },
  {
    heading: "What she won't do",
    topics: [
      {
        id: "no-orchestrate",
        icon: ProhibitIcon,
        title: "Run a job on her own",
        body: "She won't plan out a job and pass it from agent to agent by herself. Every prompt she sends and every chat or project she starts is one you asked for, so you stay in control of the work.",
      },
      {
        id: "no-act",
        icon: HandIcon,
        title: "Act on what she reads",
        body: "Instructions inside a web page, file or chat are information to her, not orders. Sending, starting or changing anything needs you to ask.",
      },
      {
        id: "no-code",
        icon: CodeIcon,
        title: "Change your files or code",
        body: "She can't edit anything herself. Coding work goes to a coding agent, with a brief you approved.",
      },
    ],
  },
  {
    heading: "Your data",
    topics: [
      {
        id: "openai",
        icon: LockKeyIcon,
        title: "Runs on OpenAI",
        body: "Kleio Voice uses OpenAI's model with your own API key. To answer you, what she reads goes to OpenAI, including your memories, chats, files and project details.",
      },
    ],
  },
];

/** Kleio Voice is a way to talk with your work, not an autopilot. */
const GUIDE_INTRO =
  "Kleio Voice is a way to talk with your work, with a bit of Kleio's personality: ask what's happening, hear it in plain words, and decide what happens next.";

interface VoiceGuideProps {
  onClose: () => void;
  /** Defaults to the running platform; injectable for tests. */
  phone?: boolean;
}

/** The guide: a card on the Mac, a bottom sheet on the iPhone. */
export function VoiceGuide({ onClose, phone = isPhone() }: VoiceGuideProps): React.ReactElement {
  return (
    <Modal
      title="What Kleio Voice can do"
      onClose={onClose}
      className={phone ? "session-help session-help-sheet voice-guide" : "session-help voice-guide"}
    >
      <div className="session-help-body">
        <p className="voice-guide-intro">{GUIDE_INTRO}</p>
        {VOICE_GUIDE.map((section) => (
          <section key={section.heading} className="session-help-section">
            <h3 className="session-help-heading">{section.heading}</h3>
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
          </section>
        ))}
      </div>
    </Modal>
  );
}
