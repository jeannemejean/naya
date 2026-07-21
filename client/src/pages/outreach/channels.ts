import { Mail, Linkedin, type LucideIcon } from "lucide-react";

export type ChannelId = "email" | "linkedin";

type Meta = { id: ChannelId; label: string; Icon: LucideIcon; dot: string; chip: string; text: string };

const EMAIL: Meta = {
  id: "email",
  label: "Email",
  Icon: Mail,
  dot: "bg-naya-sulphur",
  chip: "bg-naya-sulphur/15 text-naya-olive border border-naya-sulphur/40",
  text: "text-naya-olive",
};

const LINKEDIN: Meta = {
  id: "linkedin",
  label: "LinkedIn",
  Icon: Linkedin,
  dot: "bg-naya-salvia",
  chip: "bg-naya-salvia/15 text-naya-salvia border border-naya-salvia/40",
  text: "text-naya-salvia",
};

export function channelMeta(channel: string): Meta {
  return channel === "linkedin" ? LINKEDIN : EMAIL;
}
