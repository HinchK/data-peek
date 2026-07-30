import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FeatureShowcase } from "../feature-showcase";
import { observers } from "../../../../vitest.setup";

// FEATURE_CLIPS has 7 entries across 4 populated categories (editor: 1,
// performance: 1, data: 2, infra: 3); "ai" has none, so it renders no tab.
describe("FeatureShowcase", () => {
  beforeEach(() => {
    observers.length = 0;
    window.location.hash = "";
  });

  it("renders a tab per populated category", () => {
    render(<FeatureShowcase />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(4);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
  });

  it("shows exactly one video at a time", () => {
    render(<FeatureShowcase />);
    expect(screen.getAllByTestId("clip-video")).toHaveLength(1);
  });

  it("switches the visible clip when another feature is selected", async () => {
    const user = userEvent.setup();
    render(<FeatureShowcase />);

    // The editor tab (selected by default) has only one feature, so switch to
    // the "data" category first to get a list with more than one option.
    await user.click(screen.getByRole("tab", { name: "Data" }));

    const options = screen.getAllByRole("option");
    expect(options.length).toBeGreaterThan(1);
    expect(options[0]).toHaveAttribute("aria-selected", "true");

    await user.click(options[1]);
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByTestId("clip-video")).toHaveLength(1);
  });

  it("reflects the selection in the URL hash", async () => {
    const user = userEvent.setup();
    render(<FeatureShowcase />);
    await user.click(screen.getByRole("tab", { name: "Data" }));
    await user.click(screen.getAllByRole("option")[1]);
    expect(window.location.hash).toMatch(/^#feature-/);
  });

  it("switching category selects that category's first feature", async () => {
    const user = userEvent.setup();
    render(<FeatureShowcase />);
    const tabs = screen.getAllByRole("tab");
    await user.click(tabs[1]);
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
  });

  it("does not render a tab for an empty category", () => {
    render(<FeatureShowcase />);
    expect(screen.queryByRole("tab", { name: "AI" })).not.toBeInTheDocument();
  });

  it("wires every tab to the single tabpanel it controls", () => {
    render(<FeatureShowcase />);
    const panel = screen.getByRole("tabpanel");
    const tabs = screen.getAllByRole("tab");

    for (const tab of tabs) {
      expect(tab).toHaveAttribute("aria-controls", panel.id);
    }
    // The panel is labelled by whichever tab is currently active.
    expect(panel).toHaveAttribute("aria-labelledby", tabs[0].id);
  });

  it("uses roving tabindex: only the selected tab is in the tab order", () => {
    render(<FeatureShowcase />);
    const tabs = screen.getAllByRole("tab");

    expect(tabs[0]).toHaveAttribute("tabindex", "0");
    for (const tab of tabs.slice(1)) {
      expect(tab).toHaveAttribute("tabindex", "-1");
    }
  });

  it("supports Arrow/Home/End keyboard navigation between tabs", async () => {
    const user = userEvent.setup();
    render(<FeatureShowcase />);
    const tabs = screen.getAllByRole("tab");
    const last = tabs.length - 1;

    tabs[0].focus();
    await user.keyboard("{ArrowRight}");
    expect(tabs[1]).toHaveFocus();
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    expect(tabs[1]).toHaveAttribute("tabindex", "0");
    expect(tabs[0]).toHaveAttribute("tabindex", "-1");

    await user.keyboard("{End}");
    expect(tabs[last]).toHaveFocus();
    expect(tabs[last]).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{Home}");
    expect(tabs[0]).toHaveFocus();
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");

    // ArrowLeft from the first tab wraps around to the last.
    await user.keyboard("{ArrowLeft}");
    expect(tabs[last]).toHaveFocus();
    expect(tabs[last]).toHaveAttribute("aria-selected", "true");
  });

  it("reflects a category switch in the URL hash, same as an option click", async () => {
    const user = userEvent.setup();
    render(<FeatureShowcase />);
    await user.click(screen.getByRole("tab", { name: "Performance" }));
    expect(window.location.hash).toBe("#feature-query-plans");
  });
});
