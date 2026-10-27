import { Figure, Step, Node, Chip } from './kit.js';

export function JobFlowDiagram() {
  return (
    <Figure
      title="A job from goal to merge"
      label="A job from goal to merge: a goal begins in New job, selects a mode, and the router chooses an account so the agent works in its own worktree with quota-limit pause handling, followed by checks, an audit by a different agent, and review to approve, merge, or send corrections."
    >
      <div className="grid grid-cols-2 gap-3">
        <Step
          number={1}
          icon="play"
          title="Goal"
          subtitle="New job"
        />

        <Step
          number={2}
          icon="split"
          title="Mode"
          chips={[
            <Chip key="split">One job, split up</Chip>,
            <Chip key="compare">Compare agents</Chip>,
            <Chip key="council">Council</Chip>,
            <Chip key="autoloop">Autoloop</Chip>,
          ]}
        />

        <Step
          number={3}
          icon="swap"
          title="Router picks an account"
          chips={[
            <Chip key="primary">Primary first</Chip>,
            <Chip key="headroom">Most headroom</Chip>,
          ]}
        />

        <Step
          number={4}
          icon="branch"
          title="Agent works in its own worktree"
        />

        <Node
          dashed
          icon="clock"
          title="If the account hits its limit"
          subtitle="Account hits its limit → paused → resumes on another account, or when the limit resets"
        />

        <Step
          number={5}
          icon="shield"
          title="Checks and guardrails"
        />

        <Step
          number={6}
          icon="robot"
          title="Audit by a different agent"
        />

        <Step
          number={7}
          icon="review"
          title="Review"
          subtitle="approve, merge or send corrections"
        />
      </div>
    </Figure>
  );
}
