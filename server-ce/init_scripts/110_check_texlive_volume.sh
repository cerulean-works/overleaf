#!/bin/bash
set -euo pipefail

TEXLIVE_ROOT="${OVERLEAF_TEXLIVE_ROOT:-/usr/local/texlive}"
BASELINE_FILE="${OVERLEAF_TEXLIVE_BASELINE_FILE:-/etc/overleaf/texlive-baseline}"

if [[ ! -s "$TEXLIVE_ROOT/.overleaf-baseline" ]] ||
  ! cmp -s "$BASELINE_FILE" "$TEXLIVE_ROOT/.overleaf-baseline"; then
  cat >&2 <<'EOF'
The TeX Live volume does not match this image's release, architecture, or baseline.
Use a new versioned TeX Live volume for an image upgrade; keep the old volume for
rollback. See server-ce/README.md. The existing volume has not been changed.
EOF
  exit 101
fi

IFS=/ read -r release arch baseline < "$BASELINE_FILE"
TLMGR="$TEXLIVE_ROOT/$release/bin/$arch/tlmgr"
if [[ ! -x "$TLMGR" ]]; then
  echo "The TeX Live volume is incomplete: the expected tlmgr executable is missing." >&2
  exit 101
fi

if ! "$TLMGR" --version | grep -Eq "TeX Live .* version ${release}$"; then
  echo "The installed TeX Live release does not match this image." >&2
  exit 101
fi

# /usr/local/bin belongs to the image, while packages live in the persisted tree.
# Recreate links after every container replacement, including newly added tools.
"$TLMGR" path add
echo "Using persistent TeX Live $release ($arch, $baseline)."
