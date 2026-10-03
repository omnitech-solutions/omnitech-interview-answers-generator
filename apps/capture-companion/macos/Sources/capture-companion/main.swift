// capture-companion: the macOS capture companion for Studio's Active Session.
//
//   capture-companion pair     store the session credential in the Keychain
//   capture-companion run      capture the sources you select, send to Studio
//   capture-companion stop     stop the running companion locally
//   capture-companion status   show pairing, whether it runs, the stop marker
//
// UNOBSERVED / NOT PRODUCED HERE: a real run needs a signed .app bundle with an
// Info.plist carrying NSMicrophoneUsageDescription, NSSpeechRecognitionUsageDescription
// and a screen-recording explanation, plus the audio-input entitlement, before
// macOS will show its permission prompts. This command-line target compiles
// against ScreenCaptureKit, Speech, Security and AVFoundation, but it has not
// been run with real permissions; see the Swift package notes.
//
// Output is limited to static status strings, source names, states and counts.
// Nothing here prints or logs content, addresses or credentials.
import CaptureAdapters
import CaptureCore
import Foundation

let arguments = Array(CommandLine.arguments.dropFirst())
let paths = CompanionPaths()
let exitCode: Int32

switch arguments.first {
case "pair": exitCode = pairCommand(paths: paths)
case "run": exitCode = await runCommand(arguments: Array(arguments.dropFirst()), paths: paths)
case "stop": exitCode = stopCommand(paths: paths)
case "status": exitCode = statusCommand(paths: paths)
default:
    print(Status.usage)
    exitCode = 64
}
exit(exitCode)
