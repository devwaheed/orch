# Product

![Product Map showing factory stages and overall progress](images/product-map.jpg)

![Product Gates showing the open decision and answer controls](images/product-gates.jpg)

![New product wizard showing its first step](images/product-wizard.jpg)

![Product Trail showing grouped factory decisions](images/product-trail.jpg)

![Product Files showing the product file tree and selected file](images/product-files.jpg)

## What you see

Product shows how a SaaS Factory product moves from its brief through design and build. The header contains **Map · Gates · Design · Trail · Files**, the overall progress line, and the current stage or gate. The Product activity item appears for factory products and its badge counts open gates.

On **Map**, Planning, Design and Build follow the factory’s stage order. Each stage shows its state, title and skill. The Build column includes active specs from the Specs queue, with **Watch live** to open a spec in Specs → Live.

On **Gates**, the open decision appears first. Select a gate to see its question, supporting files and any recorded answer. Type your words and choose **Record my answer**. Answers recorded in chat appear with the same wording and show **in chat**.

On **Design**, compare **Your pick**, **Approved prototype**, and **Built** for Marketing site and Console. Missing images show **Not made yet** and the stage that will make them. Palette chips show each colour’s job from `design/palette.json`. Assets show their credit and licence from `design/assets/manifest.json`. The **Locked** contract pill appears when `design/contract.json` exists.

On **Trail**, review decisions grouped by stage group. Filter with **All**, **Your decisions**, or **Agent decisions**. Evidence links open the matching item in Files.

On **Files**, browse `docs/`, `design/`, `specs/` and `refs/`. Markdown uses the in-app Help renderer and images appear inline. Select another file and choose **Open** to use its default app, or **Show in Finder** to reveal it in the file manager.

## How to…

### Set up a product

1. Choose **New → New product**, or open the command palette (⌘K on macOS, Ctrl+K elsewhere) and choose **New product**.
2. Describe the product, or choose **Use files or a folder…** to attach references. Remove an attachment with its close button.
3. Choose **Generate**, **Skip**, or **Choose file** for Research, Value map, PRD and Architecture. Then pick Marketing site, Console, or both; choose how far to take the work and how the specs should run.
4. Review the grouped summary. Choose **Change** beside an answer to edit it; **Continue** returns to Summary.
5. Choose **Set up and start**. orch initializes the factory plan, opens Map and starts the pipeline run.

The terminal dock closes while the wizard is open and returns to its previous state when the wizard closes or finishes.

Keyboard: Return continues when the current step is valid. In the brief, use ⌘Return on macOS or Ctrl+Return elsewhere. Escape goes back.

### Answer a gate

1. Open **Gates** and select the decision marked **Needs you**.
2. Review the files named by the gate. Select a numbered tile to put that number into your answer.
3. Type your answer and choose **Record my answer**. orch records the exact words with the factory and refreshes the pipeline.

### Pause or stop the pipeline

1. While the header says **Working**, choose **Pause** to hold the run after its current turn or **Stop** to stop the session.
2. Choose **Resume** or **Start again** from the run state when you’re ready.

The pipeline stops at a gate for your answer. It never answers a gate on your behalf. When the factory’s Build stage runs, its specs appear in the normal queue and follow the queue’s ordering and verification rules.
