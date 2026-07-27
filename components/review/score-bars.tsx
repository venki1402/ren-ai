"use client";

import { RUBRIC_AXES, RUBRIC_AXIS_LABELS } from "@/lib/ai/rubric";
import { TONE_VAR, toneFor, type RubricScore } from "@/lib/score";

// Transparent per-axis rubric breakdown (doc Section 5.4). Shows exactly the
// five axes and their 0-10 values with a semantic color — no hidden metric.
export function ScoreBars({ score }: { score: RubricScore }) {
  return (
    <dl className="flex flex-col gap-2">
      {RUBRIC_AXES.filter((axis) => typeof score[axis] === "number").map((axis) => {
        const value = score[axis];
        const tone = TONE_VAR[toneFor(value)];
        return (
          <div key={axis} className="flex items-center gap-3">
            <dt className="w-28 shrink-0 text-xs text-muted-foreground">
              {RUBRIC_AXIS_LABELS[axis]}
            </dt>
            <dd className="flex flex-1 items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full transition-[width] duration-500"
                  style={{ width: `${value * 10}%`, background: tone }}
                />
              </div>
              <span
                className="w-6 text-right text-xs tabular-nums"
                style={{ color: tone }}
              >
                {value}
              </span>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
