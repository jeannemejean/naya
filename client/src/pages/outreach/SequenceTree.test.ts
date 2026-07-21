import { describe, it, expect } from "vitest";
import { buildBranches } from "./SequenceTree.logic";
import type { DraftSequenceStep } from "./types";

function step(partial: Partial<DraftSequenceStep>): DraftSequenceStep {
  return { channel: "email", delayDays: 0, intention: "x", condition: "always", ...partial };
}

describe("buildBranches", () => {
  it("keeps a fully 'always' sequence on a single trunk segment", () => {
    const steps = [
      step({ channel: "linkedin", condition: "always" }),
      step({ channel: "email", condition: "always" }),
      step({ channel: "email", condition: "always" }),
    ];
    const segments = buildBranches(steps);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ kind: "trunk" });
    if (segments[0].kind === "trunk") {
      expect(segments[0].nodes.map((n) => n.index)).toEqual([0, 1, 2]);
    }
  });

  it("forks on an adjacent complementary pair (if_invite_accepted / if_invite_not_accepted)", () => {
    const steps = [
      step({ channel: "linkedin", condition: "always" }),
      step({ channel: "email", condition: "if_invite_not_accepted" }),
      step({ channel: "linkedin", condition: "if_invite_accepted" }),
    ];
    const segments = buildBranches(steps);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ kind: "trunk" });
    expect(segments[1]).toMatchObject({ kind: "fork" });
    if (segments[1].kind === "fork") {
      expect(segments[1].positive.index).toBe(2);
      expect(segments[1].positive.affordance).toBe("positive");
      expect(segments[1].negative.index).toBe(1);
      expect(segments[1].negative.affordance).toBe("negative");
    }
  });

  it("forks on if_opened / if_not_opened, and if_clicked pairs with if_not_opened too", () => {
    const opened = buildBranches([step({ condition: "if_opened" }), step({ condition: "if_not_opened" })]);
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({ kind: "fork" });

    const clicked = buildBranches([step({ condition: "if_not_opened" }), step({ condition: "if_clicked" })]);
    expect(clicked).toHaveLength(1);
    expect(clicked[0]).toMatchObject({ kind: "fork" });
  });

  it("renders a lone conditional (no adjacent complement) as a single labeled branch", () => {
    const steps = [
      step({ channel: "linkedin", condition: "always" }),
      step({ channel: "email", condition: "if_not_opened" }),
    ];
    const segments = buildBranches(steps);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ kind: "trunk" });
    expect(segments[1]).toMatchObject({ kind: "branch" });
    if (segments[1].kind === "branch") {
      expect(segments[1].node.index).toBe(1);
      expect(segments[1].node.affordance).toBe("negative");
      expect(segments[1].node.label).toBe("si email non ouvert");
    }
  });

  it("returns to the trunk after a fork, and keeps each step's original array index", () => {
    const steps = [
      step({ channel: "linkedin", condition: "always" }), // 0 trunk
      step({ channel: "email", condition: "if_invite_not_accepted" }), // 1 fork (negative)
      step({ channel: "linkedin", condition: "if_invite_accepted" }), // 2 fork (positive)
      step({ channel: "email", condition: "if_not_opened" }), // 3 lone branch
      step({ channel: "email", condition: "always" }), // 4 trunk
    ];
    const segments = buildBranches(steps);
    expect(segments.map((s) => s.kind)).toEqual(["trunk", "fork", "branch", "trunk"]);
    expect(segments[0].kind === "trunk" && segments[0].nodes.map((n) => n.index)).toEqual([0]);
    expect(segments[3].kind === "trunk" && segments[3].nodes.map((n) => n.index)).toEqual([4]);
  });

  it("returns an empty array for an empty step list", () => {
    expect(buildBranches([])).toEqual([]);
  });
});
