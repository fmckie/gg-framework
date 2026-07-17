import React from "react";
import { SelectList } from "@kleio/coder/ui";
import { RADIO_STATIONS } from "./radio.js";

interface RadioPickerProps {
  /** Currently-playing station id, or null when off. Drives the * marker. */
  currentStationId: string | null;
  onSelect: (stationId: string | "off") => void;
  onCancel: () => void;
}

/**
 * Picker overlay shown when the user types `/radio`. Mirrors ModelSelector's
 * pattern (SelectList + currentValue marker) so the keybinds and visual
 * weight match the rest of the boss overlays — ↑↓ to navigate, Enter to
 * select, Esc to cancel.
 *
 * The "Off" entry is always last and selectable regardless of current state,
 * so users can stop the radio from inside the picker without remembering a
 * separate /radio-off command.
 */
export function RadioPicker({
  currentStationId,
  onSelect,
  onCancel,
}: RadioPickerProps): React.ReactElement {
  const items = [
    ...RADIO_STATIONS.map((s) => ({
      label: `${currentStationId === s.id ? "* " : "  "}${s.name}`,
      value: s.id,
      description: s.description,
    })),
    {
      label: `${currentStationId === null ? "* " : "  "}Off`,
      value: "off",
      description: "Stop the radio",
    },
  ];
  const initialIndex = Math.max(
    0,
    items.findIndex((i) => i.value === (currentStationId ?? "off")),
  );
  return (
    <SelectList
      items={items}
      onSelect={(v) => onSelect(v === "off" ? "off" : v)}
      onCancel={onCancel}
      initialIndex={initialIndex}
      windowSize={6}
    />
  );
}
