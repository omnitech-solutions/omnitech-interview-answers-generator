#!/bin/sh
# Wraps the built `capture-companion` executable in a minimal .app bundle and
# ad-hoc signs it, so macOS attributes the microphone, speech-recognition and
# screen-recording permissions to the companion itself instead of the terminal
# or app that launched it (a grant for a launcher only takes effect after that
# launcher is relaunched). A development bundle: it is ad-hoc signed, so macOS
# asks again after each rebuild. A release needs a Developer ID signature and
# notarisation, which this script does not provide.
#
#   swift build -c release && scripts/bundle-app.sh
#   open -n .build/CaptureCompanion.app --stdout out.log --stderr err.log \
#     --args run --screen --window-title "LeetCode"
#
# Capture now (Studio's Analyze on the focused window or a masked region) needs
# only `run --screen` and Screen Recording access granted to THIS bundle. If a
# focused-window or named-window match fails, list what the companion can see
# (application name, layer, on-screen flag, title length, never a title):
#   .build/CaptureCompanion.app/Contents/MacOS/capture-companion windows
set -eu

cd "$(dirname "$0")/.."
binary=".build/release/capture-companion"
bundle=".build/CaptureCompanion.app"

[ -x "$binary" ] || {
  echo "build first: swift build -c release" >&2
  exit 1
}

rm -rf "$bundle"
mkdir -p "$bundle/Contents/MacOS"
cp "$binary" "$bundle/Contents/MacOS/capture-companion"

cat >"$bundle/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>com.omnitech.capture-companion</string>
  <key>CFBundleName</key><string>CaptureCompanion</string>
  <key>CFBundleExecutable</key><string>capture-companion</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSUIElement</key><true/>
  <key>NSMicrophoneUsageDescription</key>
  <string>The capture companion transcribes your voice on this Mac for your Studio session.</string>
  <key>NSSpeechRecognitionUsageDescription</key>
  <string>The capture companion recognises speech on this Mac; audio is never saved or uploaded.</string>
</dict>
</plist>
PLIST

codesign --force --sign - "$bundle" >/dev/null
echo "$bundle"
