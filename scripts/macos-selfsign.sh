#!/usr/bin/env bash
# YazarKasa — self-signed kod imzalama kimliği kurar.
# Apple Developer üyeliği olmadan electron-builder'ın uygulamayı (ana app +
# Electron Framework + helper'lar) düzgün biçimde imzalamasını sağlar;
# Gatekeeper'ın "uygulama hasar görmüş" hatası bundan doğar.
#
# Kullanım: bash ./scripts/macos-selfsign.sh [keychain_adı] [şifre] [CN]
# CI: build'den önce tek sefer çağır; iş bittiğinde keychain runner'la ölür.
# NOT: Yayın kalitesi için Developer ID + notarization gerekir (bu betik
# sadece yerel/self-distro sürümlerin sorunsuz açılması içindir).
set -euo pipefail

KC_NAME="${1:-build.keychain}"
KC_PW="${2:-yazarkasa-selfsign}"
CN="${3:-YazarKasa Self-Signed}"
KC_DB="$HOME/Library/Keychains/${KC_NAME}-db"

log() { echo "[macos-selfsign] $*"; }

# GitHub Actions'ta sudo şifresizdir; macOS 14.7.5+ runner görüntülerinde
# 'security add-trusted-cert' sudosuz çalıştırılınca headless ortam asılı kalır
# (actions/runner-images#12116). Yerelde sudo gerekmez (mevcut oturum onaylar).
SUDO=""
if [ "${CI:-}" = "true" ]; then
  SUDO="sudo"
fi

D="$(mktemp -d)"
trap 'rm -rf "$D"' EXIT

log "Sertifika üretiliyor (CN=${CN})"
openssl genrsa -out "$D/key.pem" 2048 >/dev/null 2>&1
openssl req -new -key "$D/key.pem" -out "$D/csr.pem" -subj "/CN=${CN}"
cat > "$D/ext.cnf" <<'EOF'
[ req ]
distinguished_name = dn
[ dn ]
[ v3_req ]
keyUsage = digitalSignature
extendedKeyUsage = codeSigning
basicConstraints = critical, CA:FALSE
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid,issuer
EOF
openssl x509 -req -days 3650 -in "$D/csr.pem" -signkey "$D/key.pem" -out "$D/cert.pem" \
  -extfile "$D/ext.cnf" -extensions v3_req >/dev/null

# Önceki kurulumu temizle (default keychain'i geri ver, sonra sil)
if security show-keychain-info "$KC_NAME" >/dev/null 2>&1; then
  OLD_DEFAULT="$(security default-keychain -d user 2>/dev/null | tr -d ' \n"')"
  [ -n "$OLD_DEFAULT" ] && security default-keychain -s "$OLD_DEFAULT" 2>/dev/null || true
  security delete-keychain "$KC_NAME"
fi

log "Keychain kuruluyor"
security create-keychain -p "$KC_PW" "$KC_NAME"
security default-keychain -s "$KC_NAME"
security unlock-keychain -p "$KC_PW" "$KC_NAME"
security set-keychain-settings -lut 21600 "$KC_NAME"

log "Kimlik içe aktarılıyor"
# LibreSSL PKCS12, macOS secimport'unda MAC hatasıyla reddedilir; PEM parçaları
# ayrı içe aktarılır. -A: ephemeral keychain erişimini istemsiz bırakır.
security import "$D/cert.pem" -k "$KC_NAME" -T /usr/bin/codesign -T /usr/bin/security -A
security import "$D/key.pem" -k "$KC_NAME" -T /usr/bin/codesign -T /usr/bin/security -A
security set-key-partition-list -S apple-tool:,apple: -s -k "$KC_PW" "$KC_NAME"

log "Güven ekleniyor (ci_sudo=${CI:-no})"
# Self-signed leaf sertifikası ancak kendi köküne güven eklenirse "valid" bulunur
# (find-identity -v); yoksa electron-builder imzalamayı sessizce atlar.
$SUDO security add-trusted-cert -d -r trustRoot -k "$KC_DB" "$D/cert.pem"

# electron-builder 'security find-identity'yi arama listesinden çözer; keychain'i
# arama listesine ekle (login yanında bulunsun, sistem listesini bozma).
security list-keychains -d user -s \
  "$HOME/Library/Keychains/login.keychain-db" \
  "$KC_DB"

log "Kimlik kontrolü"
security find-identity -v -p codesigning "$KC_NAME"
if ! security find-identity -v -p codesigning "$KC_NAME" | grep -q "valid identities found"; then
  echo "HATA: geçerli imzalama kimliği bulunamadı — imzasız paket üretilir!" >&2
  exit 1
fi
log "Hazır"