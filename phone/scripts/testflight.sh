#!/usr/bin/env bash
# Uploads an iPhone build of XR Starter to App Store Connect, for TestFlight.
#
#   DEVELOPMENT_TEAM=ABCDE12345 bun run ios:testflight
#
# Needs: a Mac with Xcode signed in to the Apple developer account, the app
# (bundle ID edu.mit.media.xrstarter) created in App Store Connect, and
# `bunx expo prebuild --platform ios` and `pod install` done once. After the
# upload, the build shows in App Store Connect › TestFlight in a few minutes.
set -euo pipefail
cd "$(dirname "$0")/../ios"
: "${DEVELOPMENT_TEAM:?Set DEVELOPMENT_TEAM to your Apple team ID}"

# App Store Connect takes each build number once, so use the time.
BUILD="$(date +%Y%m%d%H%M)"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $BUILD" XRStarter/Info.plist
echo "Build number $BUILD"

xcodebuild -workspace XRStarter.xcworkspace -scheme XRStarter -configuration Release \
  -destination 'generic/platform=iOS' -archivePath build/XRStarter.xcarchive \
  -allowProvisioningUpdates DEVELOPMENT_TEAM="$DEVELOPMENT_TEAM" archive

cat > build/ExportOptions.plist <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  <key>teamID</key><string>$DEVELOPMENT_TEAM</string>
  <key>signingStyle</key><string>automatic</string>
</dict>
</plist>
PLIST

xcodebuild -exportArchive -archivePath build/XRStarter.xcarchive \
  -exportOptionsPlist build/ExportOptions.plist -exportPath build/export -allowProvisioningUpdates
echo "Uploaded. Open App Store Connect › XR Starter › TestFlight."
