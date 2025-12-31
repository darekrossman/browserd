#!/bin/bash
#
# Build browserd tarball for deployment to sandboxes
#
# Creates a compressed tarball containing everything needed to run browserd
# in a remote sandbox environment.
#
# Output: dist/browserd.tar.gz
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DIST_DIR="$PACKAGE_DIR/dist"

echo "Building browserd tarball..."
echo "Package dir: $PACKAGE_DIR"

# Create dist directory if it doesn't exist
mkdir -p "$DIST_DIR"

# Create a temporary directory for staging
STAGING_DIR=$(mktemp -d)
trap "rm -rf $STAGING_DIR" EXIT

# Create browserd directory in staging
mkdir -p "$STAGING_DIR/browserd"

# Copy source files
echo "Copying source files..."
cp -r "$PACKAGE_DIR/src" "$STAGING_DIR/browserd/"

# Copy configuration files
echo "Copying configuration files..."
cp "$PACKAGE_DIR/package.json" "$STAGING_DIR/browserd/"
cp "$PACKAGE_DIR/tsconfig.json" "$STAGING_DIR/browserd/"

# Copy bunfig.toml if it exists
if [ -f "$PACKAGE_DIR/bunfig.toml" ]; then
  cp "$PACKAGE_DIR/bunfig.toml" "$STAGING_DIR/browserd/"
fi

# Create the tarball
echo "Creating tarball..."
tar -czf "$DIST_DIR/browserd.tar.gz" -C "$STAGING_DIR" browserd

# Copy install script to dist
echo "Copying install script..."
cp "$SCRIPT_DIR/install.sh" "$DIST_DIR/"

# Show output
echo ""
echo "Build complete!"
echo "Output files:"
ls -lh "$DIST_DIR"/*.tar.gz "$DIST_DIR"/install.sh
