import type { ProductMember } from "@omnitech/platform-contracts";

// Up to two initials from the name; the e-mail's first letter if it has none.
export function initialsOf(member: Pick<ProductMember, "name" | "email">) {
  const words = member.name.trim().split(/\s+/).filter(Boolean);
  const letters =
    words.length > 1
      ? `${words[0]?.[0] ?? ""}${words[words.length - 1]?.[0] ?? ""}`
      : (words[0]?.slice(0, 2) ?? member.email.slice(0, 1));
  return letters.toUpperCase() || "?";
}

// What the footer and the menu say about who this is. A local user has no
// account, and the words say so.
export function identityOf(member: ProductMember) {
  const local = member.kind === "local";
  return {
    name: local ? "Local user" : member.name || member.email,
    detail: local ? "No account · this computer" : member.email,
    initials: local ? "LU" : initialsOf(member),
  };
}
