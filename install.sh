#!/bin/sh
#
# Cerberus installer for macOS and Linux.
#
#   curl -fsSL https://raw.githubusercontent.com/leodudedev/cerberus-term/main/install.sh | sh
#
# Downloading with curl skips the Gatekeeper quarantine a browser attaches, so
# the app opens on the first double click without `xattr -cr` — which is the
# whole reason this script exists while the builds stay unsigned.
#
# Options (after `sh -s --` when piping):
#   --version X.Y.Z   install a specific release instead of the latest
#   --help
#
set -eu

REPO="leodudedev/cerberus-term"
MAC_APP="/Applications/Cerberus.app"
LINUX_DIR="${HOME}/.local/share/cerberus-term"
LINUX_BIN="${HOME}/.local/bin"
VERSION=""

# ---------------------------------------------------------------- helpers ---

say() { printf '%s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

need() {
  command -v "$1" >/dev/null 2>&1 || die "\`$1\` is required but not installed."
}

usage() {
  cat <<'EOF'
Cerberus installer

  install.sh [--version X.Y.Z]

  --version X.Y.Z   install that release instead of the latest
  --help            this text
EOF
}

# sha256 of a file, whichever tool this box has.
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

# ------------------------------------------------------------------- args ---

while [ $# -gt 0 ]; do
  case "$1" in
    --version)
      [ $# -ge 2 ] || die "--version needs a value"
      VERSION="${2#v}"
      shift 2
      ;;
    --version=*)
      VERSION="${1#--version=}"
      VERSION="${VERSION#v}"
      shift
      ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown option: $1 (try --help)" ;;
  esac
done

need curl
command -v sha256sum >/dev/null 2>&1 || need shasum

if [ -n "$VERSION" ]; then
  BASE="https://github.com/${REPO}/releases/download/v${VERSION}"
else
  BASE="https://github.com/${REPO}/releases/latest/download"
fi

# ------------------------------------------------------ platform + assets ---

OS="$(uname -s)"
MACHINE="$(uname -m)"

case "$OS" in
  Darwin)
    case "$MACHINE" in
      arm64) ASSET="Cerberus-mac-arm64.zip" ;;
      x86_64)
        die "Intel Macs aren't built yet — only Apple Silicon. Follow
       https://github.com/${REPO}/issues if you need an x64 build."
        ;;
      *) die "unsupported macOS architecture: $MACHINE" ;;
    esac
    SUMS="SHA256SUMS-macOS.txt"
    ;;
  Linux)
    case "$MACHINE" in
      x86_64|amd64) ASSET="Cerberus-linux-x86_64.AppImage" ;;
      *)
        die "only x86_64 Linux is built today (this box is $MACHINE)."
        ;;
    esac
    SUMS="SHA256SUMS-Linux.txt"
    ;;
  *)
    die "unsupported platform: $OS — Windows has an installer on the releases page."
    ;;
esac

# Replacing a bundle under a running app leaves it in a half-swapped state.
if pgrep -f 'Cerberus\.app/Contents/MacOS/Cerberus' >/dev/null 2>&1 ||
   pgrep -f 'cerberus-term/Cerberus\.AppImage' >/dev/null 2>&1; then
  die "Cerberus is running — quit it first, then re-run this script."
fi

# --------------------------------------------------------------- download ---

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT INT TERM

say "→ downloading ${ASSET}"
curl -fSL --progress-bar -o "${TMP}/${ASSET}" "${BASE}/${ASSET}" ||
  die "download failed — check that ${BASE}/${ASSET} exists."

say "→ verifying checksum"
curl -fsSL -o "${TMP}/${SUMS}" "${BASE}/${SUMS}" ||
  die "no ${SUMS} on that release. Releases before v0.14.0 don't publish
       checksums; install those from the releases page instead."

EXPECTED="$(awk -v f="$ASSET" '$2 == f || $2 == "*" f { print $1; exit }' "${TMP}/${SUMS}")"
[ -n "$EXPECTED" ] || die "${ASSET} is not listed in ${SUMS}."

ACTUAL="$(sha256_of "${TMP}/${ASSET}")"
[ "$EXPECTED" = "$ACTUAL" ] || die "checksum mismatch for ${ASSET}
       expected ${EXPECTED}
       got      ${ACTUAL}"

# ---------------------------------------------------------------- install ---

if [ "$OS" = "Darwin" ]; then
  # /Applications is group-writable for admins, so this is usually silent; a
  # non-admin account (or an app owned by someone else) falls back to sudo.
  SUDO=""
  if [ ! -w /Applications ] || { [ -e "$MAC_APP" ] && [ ! -w "$MAC_APP" ]; }; then
    command -v sudo >/dev/null 2>&1 || die "/Applications isn't writable and sudo isn't available."
    say "→ /Applications needs elevated rights"
    SUDO="sudo"
  fi

  say "→ extracting"
  mkdir -p "${TMP}/x"
  ditto -x -k "${TMP}/${ASSET}" "${TMP}/x"
  [ -d "${TMP}/x/Cerberus.app" ] || die "unexpected archive layout in ${ASSET}."

  say "→ installing to ${MAC_APP}"
  $SUDO rm -rf "$MAC_APP"
  $SUDO mv "${TMP}/x/Cerberus.app" "$MAC_APP"
  # Belt and braces: curl doesn't set com.apple.quarantine, but a proxy or a
  # re-download by other means might have.
  $SUDO xattr -cr "$MAC_APP" 2>/dev/null || true

  say ""
  say "Cerberus installed. Open it from Launchpad, Spotlight, or:"
  say "  open -a Cerberus"
else
  say "→ installing to ${LINUX_DIR}"
  mkdir -p "$LINUX_DIR" "$LINUX_BIN" \
    "${HOME}/.local/share/applications" \
    "${HOME}/.local/share/icons/hicolor/512x512/apps"

  install -m 755 "${TMP}/${ASSET}" "${LINUX_DIR}/Cerberus.AppImage"
  ln -sf "${LINUX_DIR}/Cerberus.AppImage" "${LINUX_BIN}/cerberus"

  curl -fsSL -o "${HOME}/.local/share/icons/hicolor/512x512/apps/cerberus.png" \
    "https://raw.githubusercontent.com/${REPO}/main/build/icon.png" || true

  cat > "${HOME}/.local/share/applications/cerberus.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Cerberus
Comment=GUI terminal multiplexer with remote control
Exec=${LINUX_DIR}/Cerberus.AppImage %U
Icon=cerberus
Terminal=false
Categories=Development;Utility;
StartupWMClass=Cerberus
EOF

  command -v update-desktop-database >/dev/null 2>&1 &&
    update-desktop-database "${HOME}/.local/share/applications" >/dev/null 2>&1 || true

  say ""
  say "Cerberus installed. Launch it from your app menu, or:"
  say "  cerberus"

  case ":${PATH}:" in
    *":${LINUX_BIN}:"*) ;;
    *) say ""
       say "note: ${LINUX_BIN} isn't in your PATH — add it to use \`cerberus\`." ;;
  esac
fi

say ""
say "Re-run this script any time to update. To uninstall:"
if [ "$OS" = "Darwin" ]; then
  say "  rm -rf ${MAC_APP} ~/.cerberus-term"
else
  say "  rm -rf ${LINUX_DIR} ${LINUX_BIN}/cerberus ~/.cerberus-term"
  say "  rm -f ~/.local/share/applications/cerberus.desktop"
fi
