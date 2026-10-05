import AppKit
import CoreGraphics
import StudioShellCore

// [DOMAIN] What the system says about displays and windows, reduced to the
// plain values StudioShellCore decides over. A display's name is the system's
// (NSScreen.localizedName); a window is only its id, owner, layer and geometry:
// no title, so nothing here can carry content.
enum Displays {
    // In NSScreen.screens order, matched by CGDirectDisplayID.
    static func infos() -> [DisplayInfo] {
        var ids: [UInt32] = []
        var names: [UInt32: String] = [:]
        for screen in NSScreen.screens {
            guard let number = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber else {
                continue
            }
            ids.append(number.uint32Value)
            names[number.uint32Value] = screen.localizedName
        }
        return DisplayInfo.list(ids: ids, names: names)
    }

    static func frames(of infos: [DisplayInfo]) -> [DisplayFrame] {
        infos.map { DisplayFrame(id: $0.id, frame: CGDisplayBounds(CGDirectDisplayID($0.id))) }
    }

    // The sampled application's on-screen windows, FRONT-TO-BACK (the window server's order).
    static func windows(ofPid pid: Int32?) -> [PlacedWindow] {
        guard let pid,
            let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]]
        else { return [] }
        return list.compactMap { entry in
            guard (entry[kCGWindowOwnerPID as String] as? Int32) == pid,
                let number = entry[kCGWindowNumber as String] as? UInt32,
                let layer = entry[kCGWindowLayer as String] as? Int,
                let bounds = entry[kCGWindowBounds as String] as? NSDictionary,
                let frame = CGRect(dictionaryRepresentation: bounds)
            else { return nil }
            return PlacedWindow(windowId: number, ownerPid: pid, layer: layer, frame: frame)
        }
    }
}
