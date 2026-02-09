#!/bin/bash
set -e

# This script installs the aerospace-layout-manager for your system.
# It detects the OS and architecture, then downloads the appropriate binary
# from the latest GitHub release.
#
# Use --local flag to build and install from the local repository instead.

# The script will install the binary to /usr/local/bin.
# You may be prompted for your password to move the binary to this location.

# Parse command line arguments
LOCAL_BUILD=false
for arg in "$@"; do
    case $arg in
        --local|-l)
            LOCAL_BUILD=true
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [--local|-l]"
            echo "  --local, -l  Build and install from local repository"
            exit 0
            ;;
        *)
            ;;
    esac
done

main() {
    REPO="CarterMcAlister/aerospace-layout-manager"
    INSTALL_NAME="aerospace-layout-manager"
    INSTALL_DIR="/usr/local/bin"

    # Determine the OS and architecture
    OS="$(uname -s)"
    ARCH="$(uname -m)"

    echo "Detected OS: ${OS}, Arch: ${ARCH}"

    case $OS in
        Darwin)
            PLATFORM="darwin"
            ;;
        *)
            echo "Unsupported operating system: $OS"
            exit 1
            ;;
    esac

    case $ARCH in
        x86_64)
            ARCH_TYPE="x64"
            ;;
        arm64 | aarch64)
            ARCH_TYPE="arm64"
            ;;
        *)
            echo "Unsupported architecture: $ARCH"
            exit 1
            ;;
    esac

    FILENAME="${INSTALL_NAME}-${PLATFORM}-${ARCH_TYPE}"

    if [ "$LOCAL_BUILD" = true ]; then
        echo "Building from local repository..."

        # Check if bun is installed
        if ! command -v bun &> /dev/null; then
            echo "Error: bun is not installed. Please install bun first: https://bun.sh"
            exit 1
        fi

        # Get the directory where the script is located
        SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

        # Build the project
        cd "$SCRIPT_DIR"
        echo "Running bun build..."

        if [ "$ARCH_TYPE" = "arm64" ]; then
            bun run build:mac
        else
            bun run build:mac-intel
        fi

        # Check if build succeeded
        BUILD_OUTPUT="build/${FILENAME}"
        if [ ! -f "$BUILD_OUTPUT" ]; then
            echo "Error: Build failed. Expected output at $BUILD_OUTPUT"
            exit 1
        fi

        echo "Build successful!"

        # Use the locally built binary
        TMP_FILE="$BUILD_OUTPUT"
    else

        # Get the latest release tag name.
        # The 'latest' endpoint doesn't include pre-releases, so we fetch all releases and get the first one.
        LATEST_RELEASE_URL="https://api.github.com/repos/${REPO}/releases"
        echo "Fetching latest release from ${LATEST_RELEASE_URL}"
        LATEST_TAG=$(curl -sL "${LATEST_RELEASE_URL}" | grep '"tag_name":' | head -n 1 | sed -E 's/.*"([^"]+)".*/\1/')

        if [ -z "$LATEST_TAG" ]; then
            echo "Could not find the latest release tag."
            exit 1
        fi

        echo "Latest tag is ${LATEST_TAG}"

        DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${LATEST_TAG}/${FILENAME}"

        echo "Downloading ${FILENAME} from ${DOWNLOAD_URL}"

        # Download to a temporary file
        TMP_FILE=$(mktemp)
        curl -L --fail -o "$TMP_FILE" "$DOWNLOAD_URL"

        # Make the file executable
        chmod +x "$TMP_FILE"
    fi

    INSTALL_PATH="${INSTALL_DIR}/${INSTALL_NAME}"

    echo "Installing to ${INSTALL_PATH}"

    # Use sudo if needed to move the file
    if [ -w "$INSTALL_DIR" ]; then
        mv "$TMP_FILE" "$INSTALL_PATH"
    else
        echo "Root permission is required to install to ${INSTALL_DIR}."
        sudo mv "$TMP_FILE" "$INSTALL_PATH"
    fi

    CONFIG_DIR="$HOME/.config/aerospace"
    LAYOUTS_FILE="$CONFIG_DIR/layouts.json"

    if [ ! -f "$LAYOUTS_FILE" ]; then
        echo "Creating layout file at $LAYOUTS_FILE"
        mkdir -p "$CONFIG_DIR"

        echo '{ "$schema": "https://raw.githubusercontent.com/CarterMcAlister/aerospace-layout-manager/main/layoutConfig.schema.json" }' > "$LAYOUTS_FILE"
    fi

    echo "Installation successful!"
    echo "You can now run '${INSTALL_NAME}' from your terminal."
    echo "Configure your layouts in $LAYOUTS_FILE"
}

main
