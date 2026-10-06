#!/usr/bin/env bash
set -euo pipefail

# Build fnOS .fpk package for EnglishForge
# This script creates a .fpk that can be installed via fnOS App Center

VERSION="${1:-0.1.0}"
OUTPUT_DIR="./dist/fpk"
PACKAGE_NAME="englishforge"

echo "=== Building EnglishForge FPK ==="
echo "Version: $VERSION"

# Create FPK directory structure
mkdir -p "$OUTPUT_DIR/$PACKAGE_NAME"
cd "$OUTPUT_DIR/$PACKAGE_NAME"

# Create manifest (INI format for fnOS)
cat > manifest << MANIFEST_EOF
[Package]
Name=$PACKAGE_NAME
Version=$VERSION
Maintainer=EnglishForge Team
Description=Private English Learning Application for NAS
Website=https://github.com/english-forge/english-forge
License=AGPL-3.0

[Category]
Education

[Docker]
Version=1.0
MANIFEST_EOF

# Create privilege file (non-root)
mkdir -p config
cat > config/privilege << PRIVILEGE_EOF
User=forge
Group=forge
PRIVILEGE_EOF

# Create resource file
cat > config/resource << RESOURCE_EOF
[Docker]
Compose=/app/docker-compose.yaml
RESOURCE_EOF

# Create app directory
mkdir -p app

# Copy docker-compose to app directory
cp ../../docker-compose.yml app/docker-compose.yaml

# Create ICON placeholder (128x128 PNG)
# In production, replace with actual app icon
cat > ICON.PNG << ICON_EOF
# Placeholder - replace with actual 128x128 PNG icon
ICON_EOF

echo ""
echo "=== FPK Build Complete ==="
echo "Package location: $OUTPUT_DIR/$PACKAGE_NAME/"
echo ""
echo "Next steps:"
echo "  1. Place ICON.PNG and ICON_256.PNG in the package directory"
echo "  2. Run: cd $OUTPUT_DIR && tar -czf ${PACKAGE_NAME}_v${VERSION}.fpk ${PACKAGE_NAME}/"
echo "  3. Upload the .fpk to fnOS App Center for review"
echo ""
echo "Note: This is a skeleton script. Adjust paths and icons for production."
