import { useEffect, useRef, useState } from "react";
import { cycleThinking, type ModelOption, type ThinkingState } from "./agent";
import { modelDisplayName } from "./model-name";
import { groupByProvider } from "./provider-labels";
import { isPhone } from "./platform";
import { PaidModelConfirm } from "./placeholder/PaidModelConfirm";

// The mockup's order and labels. A level the model lacks is not shown.
const THINKING_CHOICES: readonly (readonly [string, string])[] = [
  ["off", "Off"],
  ["low", "Low"],
  ["medium", "Medium"],
  ["high", "High"],
  ["xhigh", "X-High"],
  ["max", "Max"],
  ["ultra", "Ultra"],
];

export function thinkingChoices(levels: readonly string[]): (readonly [string, string])[] {
  if (levels.length === 0) return [];
  return THINKING_CHOICES.filter(([level]) => level === "off" || levels.includes(level));
}

// The app can only cycle, so step until the level is reached. A full turn of
// the cycle without it stops back where it started, changing nothing.
export async function applyThinkingLevel(
  target: string | null,
  start: string | null,
  cycle: () => Promise<ThinkingState | null> = cycleThinking,
): Promise<boolean> {
  if (target === start) return true;
  for (let step = 0; step < THINKING_CHOICES.length; step++) {
    const result = await cycle();
    if (!result) return false;
    if (result.thinkingLevel === target) return true;
    if (result.thinkingLevel === start) return false;
  }
  return false;
}

export function ModelTrigger({
  models,
  currentModel,
  disabled,
  title,
  open,
  panelId,
  onToggle,
  buttonRef,
}: {
  models: readonly ModelOption[];
  currentModel: string;
  disabled: boolean;
  title: string;
  open: boolean;
  panelId: string;
  onToggle: () => void;
  buttonRef?: React.Ref<HTMLButtonElement>;
}): React.ReactElement {
  const reason = disabled
    ? "Can't switch models while the agent is running — cancel the run or wait for it to finish"
    : models.length === 0
      ? "No models available yet — still connecting to the agent"
      : null;
  const billing = models.find((model) => model.id === currentModel)?.billing;
  const name = modelDisplayName(models, currentModel);
  return (
    <span className="model-picker">
      <button
        ref={buttonRef}
        type="button"
        className="model-button model-trigger"
        disabled={reason !== null}
        title={reason ?? (billing ? `${title} — ${billing.detail}` : title)}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={onToggle}
      >
        {billing?.paid === true ? `${name} · paid` : name}
      </button>
    </span>
  );
}

export function ModelPanel({
  id,
  models,
  currentModel,
  thinkingLevel,
  thinkingLevels,
  onUseModel,
  onApplyThinking,
  onPreviewThinking,
  onClose,
  helper,
}: {
  id: string;
  models: readonly ModelOption[];
  currentModel: string;
  thinkingLevel: string | null;
  thinkingLevels: readonly string[];
  onUseModel: (modelId: string, options?: { confirmPaid?: boolean }) => void;
  onApplyThinking: (level: string | null) => void;
  /** The level being tried in the panel; undefined when it matches the saved one. */
  onPreviewThinking: (level: string | null | undefined) => void;
  onClose: () => void;
  /** The phone's Helper model picker, which its footer has no room for. */
  helper?: React.ReactNode;
}): React.ReactElement {
  const [query, setQuery] = useState("");
  const [candidate, setCandidate] = useState(currentModel);
  const [pendingLevel, setPendingLevel] = useState<string | null>(thinkingLevel);
  const [confirmingPaid, setConfirmingPaid] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const useRefButton = useRef<HTMLButtonElement>(null);

  // Not on the phone: a focused field raises its keyboard over the list.
  useEffect(() => {
    if (!isPhone()) searchRef.current?.focus({ preventScroll: true });
  }, []);

  // On the bubble phase, so an open Usage popover takes Escape first.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const allGroups = groupByProvider(models);
  const needle = query.trim().toLowerCase();
  const groups = allGroups
    .map((group) => ({
      ...group,
      models: group.models.filter((model) =>
        `${group.label} ${model.name}`.toLowerCase().includes(needle),
      ),
    }))
    .filter((group) => group.models.length > 0);
  const count = groups.reduce((sum, group) => sum + group.models.length, 0);

  const currentName = modelDisplayName(models, currentModel);
  const currentGroup = allGroups.find((group) =>
    group.models.some((model) => model.id === currentModel),
  );
  const candidateModel = models.find((model) => model.id === candidate);
  const candidateName = modelDisplayName(models, candidate);
  const same = candidate === currentModel;
  const levelChanged = same && pendingLevel !== thinkingLevel;
  const choices = same ? thinkingChoices(thinkingLevels) : [];

  function stage(modelId: string): void {
    setCandidate(modelId);
    setConfirmingPaid(false);
    // Another model's levels are not known until it is in use.
    if (modelId !== currentModel && pendingLevel !== thinkingLevel) {
      setPendingLevel(thinkingLevel);
      onPreviewThinking(undefined);
    }
  }

  function pickLevel(level: string | null): void {
    setPendingLevel(level);
    onPreviewThinking(level === thinkingLevel ? undefined : level);
  }

  function confirm(): void {
    if (same) {
      if (!levelChanged) return;
      onApplyThinking(pendingLevel);
      onClose();
      return;
    }
    // A model that spends real money still asks first, Cancel by default.
    if (candidateModel?.billing?.paid === true) {
      setConfirmingPaid(true);
      return;
    }
    onUseModel(candidate);
    onClose();
  }

  function moveRowFocus(event: React.KeyboardEvent<HTMLElement>): void {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const rows = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [],
    );
    if (rows.length === 0) return;
    const index = rows.indexOf(document.activeElement as HTMLButtonElement);
    const down = event.key === "ArrowDown";
    const next =
      index === -1
        ? down
          ? 0
          : rows.length - 1
        : (index + (down ? 1 : -1) + rows.length) % rows.length;
    rows[next]?.focus();
  }

  return (
    <section id={id} className="model-panel" aria-label="Model">
      <header>
        <h3>Model</h3>
        <span className="model-panel-meta">From connected Settings providers</span>
        <span className="model-panel-esc" aria-hidden="true">
          esc
        </span>
        <button type="button" className="model-close" aria-label="Close Model" onClick={onClose}>
          {"×"}
        </button>
      </header>
      <div className="model-summary">
        <strong>
          {currentGroup
            ? `Current · ${currentName} · ${currentGroup.label}`
            : `Current · ${currentName}`}
        </strong>
        <small>{`${allGroups.length} ${allGroups.length === 1 ? "provider" : "providers"}`}</small>
      </div>
      {helper && <div className="model-helper">{helper}</div>}
      <label className="model-search">
        Search
        <input
          ref={searchRef}
          type="search"
          aria-label="Search models or providers"
          placeholder="Models or providers"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            if (listRef.current) listRef.current.scrollTop = 0;
          }}
          onKeyDown={moveRowFocus}
        />
        <output aria-live="polite">{`${count} ${count === 1 ? "model" : "models"}`}</output>
      </label>
      <div
        ref={listRef}
        className="model-list"
        role="group"
        aria-label="Available models"
        onKeyDown={moveRowFocus}
      >
        {groups.map((group) => (
          <div key={group.key} className="model-group">
            <h4>{`${group.label} · ${group.models.length}`}</h4>
            {group.models.map((model) => {
              // A local model that can't call tools can't run the agent.
              const toolless = model.supportsTools === false;
              const meta = [
                model.id === currentModel ? "✓ Current" : "",
                toolless ? "No tool calling" : "",
                model.billing?.label ?? "",
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <button
                  key={`${model.provider}:${model.id}`}
                  type="button"
                  className="model-option"
                  data-model={model.id}
                  aria-pressed={model.id === candidate}
                  disabled={toolless}
                  title={
                    toolless
                      ? `${model.name} has no tool calling, so it can't run the agent`
                      : undefined
                  }
                  onClick={() => stage(model.id)}
                >
                  <span>{model.name}</span>
                  <small>{meta}</small>
                </button>
              );
            })}
          </div>
        ))}
        {count === 0 && (
          <p className="model-empty">No matching models. Try another name or provider.</p>
        )}
      </div>
      {choices.length > 0 ? (
        <div className="model-thinking">
          <div className="thinking-heading">
            <span id={`${id}-thinking-label`}>Thinking</span>
            <small id={`${id}-thinking-note`}>
              Shared with the control below · applied on confirmation
            </small>
          </div>
          <div
            className="thinking-levels"
            role="radiogroup"
            aria-labelledby={`${id}-thinking-label`}
            aria-describedby={`${id}-thinking-note`}
          >
            {choices.map(([level, label]) => (
              <label key={level} className="thinking-choice" data-level={level}>
                <input
                  type="radio"
                  name={`${id}-thinking`}
                  value={level}
                  aria-label={label}
                  checked={(pendingLevel ?? "off") === level}
                  onChange={() => pickLevel(level === "off" ? null : level)}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </div>
      ) : (
        !same &&
        candidateModel?.supportsThinking !== false && (
          <div className="model-thinking">
            <div className="thinking-heading">
              <span>Thinking</span>
              <small>Levels are listed for the model in use.</small>
            </div>
          </div>
        )
      )}
      {confirmingPaid && candidateModel ? (
        <PaidModelConfirm
          model={candidateModel}
          standardName={
            candidateModel.billing?.standardModel
              ? modelDisplayName(models, candidateModel.billing.standardModel)
              : undefined
          }
          onConfirm={() => {
            onUseModel(candidate, { confirmPaid: true });
            onClose();
          }}
          onCancel={() => {
            setConfirmingPaid(false);
            requestAnimationFrame(() => useRefButton.current?.focus());
          }}
        />
      ) : (
        <div className="model-review">
          <div className="model-review-copy" aria-live="polite">
            <strong>{`${same ? "Current" : "Candidate"} · ${candidateName}`}</strong>
            {/* Only a note the app holds for this model; none means no claim. */}
            {candidateModel?.billing && <p>{candidateModel.billing.detail}</p>}
          </div>
          <button type="button" className="model-cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            ref={useRefButton}
            type="button"
            className="model-use"
            disabled={same && !levelChanged}
            onClick={confirm}
          >
            {levelChanged ? "Apply thinking" : "Use model"}
          </button>
        </div>
      )}
    </section>
  );
}
