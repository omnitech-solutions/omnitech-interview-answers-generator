import Foundation

// [DOMAIN] The closed owner skills of the Active Session (mirror of
// LIVE_OWNER_SKILLS in packages/interview-contracts/src/live-session.ts). The
// shell only remembers which one is current and tells the pages through the
// `set-skill:<id>` intent; what a skill means to the assist is Studio's.
public enum OwnerSkill: String, CaseIterable, Sendable {
    case programming
    case dsa
    case systemDesign = "system-design"
    case behavioral
    case dataScience = "data-science"
    case salesBusiness = "sales-business"
    case presentation
    case negotiation
    case devops

    public var label: String {
        switch self {
        case .programming: "Programming"
        case .dsa: "DSA"
        case .systemDesign: "System Design"
        case .behavioral: "Behavioral"
        case .dataScience: "Data Science"
        case .salesBusiness: "Sales & Business"
        case .presentation: "Presentation"
        case .negotiation: "Negotiation"
        case .devops: "DevOps"
        }
    }

    public static let `default`: OwnerSkill = .dsa

    // Wraps in both directions: Cmd+Down after the last skill is the first.
    public func cycled(by step: Int) -> OwnerSkill {
        let all = Self.allCases
        let index = all.firstIndex(of: self) ?? 0
        let next = ((index + step) % all.count + all.count) % all.count
        return all[next]
    }
}
