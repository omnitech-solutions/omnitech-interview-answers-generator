#!/bin/sh
# Wraps the built `studio-shell` executable in a minimal .app bundle and ad-hoc
# signs it, so macOS attributes Screen Recording to the shell itself. A
# development bundle: ad-hoc signed, so macOS asks again after each rebuild. A
# release needs a Developer ID signature and notarisation, not provided here.
#
#   swift build -c release && scripts/bundle-app.sh
#   open .build/InterviewStudioShell.app
#
# LSUIElement: an accessory app (menu-bar item, no Dock icon, not in the app
# switcher), so pressing the floating window never makes the shell the frontmost
# app; "capture the focused window" keeps reading the window being interviewed in.
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
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSAppTransportSecurity</key>
  <dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict>
</plist>
PLIST

codesign --force --sign - "$bundle" >/dev/null
echo "$bundle"
