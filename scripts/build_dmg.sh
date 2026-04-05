#!/bin/bash
set -e

APP_NAME="MarkdownOffice"
BUILD_DIR="build/macos/Build/Products/Release"
DMG_DIR="build/dmg"
DMG_NAME="${APP_NAME}.dmg"

echo "==> Building macOS app..."
flutter build macos

echo "==> Creating DMG..."
rm -rf "$DMG_DIR"
mkdir -p "$DMG_DIR"

create-dmg \
  --volname "$APP_NAME" \
  --window-pos 200 120 \
  --window-size 600 400 \
  --icon-size 100 \
  --icon "${APP_NAME}.app" 150 190 \
  --app-drop-link 450 190 \
  --no-internet-enable \
  "$DMG_DIR/$DMG_NAME" \
  "$BUILD_DIR/markdownoffice.app"

echo "==> DMG erstellt: $DMG_DIR/$DMG_NAME"
echo "==> Groesse: $(du -h "$DMG_DIR/$DMG_NAME" | cut -f1)"
