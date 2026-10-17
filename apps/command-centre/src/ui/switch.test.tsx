// @vitest-environment jsdom
/** The switch (.specs/features/primitivas, C12): the role, the state, Space, and `disabled`. */
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Switch } from ".";
import { installPage, mount } from "./testkit";

installPage();

function Host({
  disabled = false,
  onChange = () => undefined,
}: {
  disabled?: boolean;
  onChange?: (v: boolean) => void;
}) {
  const [on, setOn] = useState(false);
  return (
    <Switch
      aria-label="Local graph"
      checked={on}
      disabled={disabled}
      onCheckedChange={(v) => {
        onChange(v);
        setOn(v);
      }}
    />
  );
}

describe("C12 switch", () => {
  it("C12 is a switch, and Space and a click toggle it with the new value", async () => {
    const onChange = vi.fn();
    mount(<Host onChange={onChange} />);
    const user = userEvent.setup();
    const sw = screen.getByRole("switch", { name: "Local graph" });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    sw.focus();
    await user.keyboard(" ");
    expect(sw.getAttribute("aria-checked")).toBe("true");
    expect(onChange).toHaveBeenLastCalledWith(true);
    await user.click(sw);
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it("C12 disabled does not toggle and calls nothing", async () => {
    const onChange = vi.fn();
    mount(<Host disabled onChange={onChange} />);
    const user = userEvent.setup();
    const sw = screen.getByRole("switch", { name: "Local graph" });
    await user.click(sw);
    sw.focus();
    await user.keyboard(" ");
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("C12 given children it is a chip: the children are its face and it keeps its class", () => {
    mount(
      <Switch checked onCheckedChange={() => undefined} className="brain-chip kind on">
        <span>wiki links</span>
      </Switch>,
    );
    const chip = screen.getByRole("switch", { name: "wiki links" });
    expect(chip.className).toContain("chip");
    expect(chip.className).toContain("brain-chip");
    expect(chip.getAttribute("aria-checked")).toBe("true");
    expect(chip.querySelector(".ui-switch-thumb")).toBeNull();
  });
});
