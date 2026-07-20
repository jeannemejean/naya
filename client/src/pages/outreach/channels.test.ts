import { describe, it, expect } from "vitest";
import { Mail, Linkedin } from "lucide-react";
import { channelMeta } from "./channels";

describe("channelMeta", () => {
  it("maps linkedin to salvia + Linkedin icon", () => {
    const m = channelMeta("linkedin");
    expect(m.id).toBe("linkedin");
    expect(m.label).toBe("LinkedIn");
    expect(m.dot).toContain("salvia");
    // lucide-react 0.453.0 exports icons as forwardRef exotic objects (typeof "object"),
    // not plain functions — assert the concrete icon reference instead of typeof "function".
    expect(m.Icon).toBe(Linkedin);
  });

  it("maps email to sulphur", () => {
    const m = channelMeta("email");
    expect(m.id).toBe("email");
    expect(m.label).toBe("Email");
    expect(m.Icon).toBe(Mail);
  });

  it("defaults unknown channel to email", () => {
    expect(channelMeta("sms").id).toBe("email");
  });
});
