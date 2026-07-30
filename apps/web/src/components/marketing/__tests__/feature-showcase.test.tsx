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
});
