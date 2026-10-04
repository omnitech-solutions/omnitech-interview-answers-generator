import Carbon.HIToolbox
import StudioShellCore

// System-wide keys through RegisterEventHotKey: no Accessibility or Input
// Monitoring permission, and the shell receives only the combinations it
// registered. A combination another app already owns is reported, not forced.
final class HotkeyCenter {
    private static var onFire: ((HotkeyBinding.Action) -> Void)?
    private static var bindings: [HotkeyBinding] = []
    private var refs: [EventHotKeyRef] = []
    private(set) var unavailable: [HotkeyBinding] = []

    func register(_ bindings: [HotkeyBinding], onFire: @escaping (HotkeyBinding.Action) -> Void) {
        Self.onFire = onFire
        Self.bindings = bindings
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(
            GetApplicationEventTarget(),
            { _, event, _ -> OSStatus in
                var id = EventHotKeyID()
                let status = GetEventParameter(
                    event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID),
                    nil, MemoryLayout<EventHotKeyID>.size, nil, &id)
                if status == noErr, Int(id.id) < HotkeyCenter.bindings.count {
                    let action = HotkeyCenter.bindings[Int(id.id)].action
                    DispatchQueue.main.async { HotkeyCenter.onFire?(action) }
                }
                return noErr
            },
            1, &spec, nil, nil)
        for (index, binding) in bindings.enumerated() {
            var ref: EventHotKeyRef?
            let id = EventHotKeyID(signature: OSType(0x5354_4448), id: UInt32(index))
            let status = RegisterEventHotKey(
                binding.keyCode, binding.carbonModifiers, id, GetApplicationEventTarget(), 0, &ref)
            if status == noErr, let ref { refs.append(ref) } else { unavailable.append(binding) }
        }
    }
}
