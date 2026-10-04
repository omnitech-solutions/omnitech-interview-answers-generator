#!/bin/sh
# Wraps the built `studio-shell` executable in a minimal .app bundle and ad-hoc
# signs it, so macOS attributes Screen Recording to the shell itself. A
# development bundle: ad-hoc signed, so macOS asks again after each rebuild. A
# release needs a Developer ID signature and notarisation, not provided here.
#
#   swift build -c release && scripts/bundle-app.sh
#   open .build/InterviewStudioShell.app
#
# A regular app (Dock icon, app menu): no LSUIElement. The floating panels are
# non-activating, so pressing one never makes the shell the frontmost app;
# "capture the focused window" keeps reading the window being interviewed in
# (FocusSampling falls back to the last other app while the main window is key).
# There is no App Sandbox: the web view needs only outbound network, and
# ScreenCaptureKit needs the user's Screen Recording grant, not an entitlement.
set -eu

cd "$(dirname "$0")/.."
binary=".build/release/studio-shell"
bundle=".build/InterviewStudioShell.app"

[ -x "$binary" ] || {
  echo "build first: swift build -c release" >&2
  exit 1
}

rm -rf "$bundle"
mkdir -p "$bundle/Contents/MacOS"
cp "$binary" "$bundle/Contents/MacOS/studio-shell"

cat >"$bundle/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>com.omnitech.studio-shell</string>
  <key>CFBundleName</key><string>Interview Studio</string>
  <key>CFBundleDisplayName</key><string>Interview Studio</string>
  <key>CFBundleExecutable</key><string>studio-shell</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>CFBundleURLTypes</key>
  <array><dict>
    <key>CFBundleURLName</key><string>com.omnitech.studio-shell.signin</string>
    <key>CFBundleURLSchemes</key><array><string>omnitech-studio</string></array>
  </dict></array>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSMicrophoneUsageDescription</key>
  <string>Interview Studio listens to your microphone during a live session you start, so your assistant can hear the interviewer. Speech is turned into text on this Mac and no audio is recorded or kept.</string>
  <key>NSSpeechRecognitionUsageDescription</key>
  <string>Interview Studio recognises speech on this Mac, never on a server, to turn what is said in your live session into text.</string>
  <key>NSAppTransportSecurity</key>
  <dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict>
</plist>
PLIST

codesign --force --sign - "$bundle" >/dev/null
echo "$bundle"
