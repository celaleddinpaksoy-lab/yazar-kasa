#!/usr/bin/env bash
# YazarKasa — self-signed kod imzalama kimliği kurar.
# Apple Developer üyeliği olmadan electron-builder'ın uygulamayı (ana app +
# Electron Framework + helper'lar) düzgün biçimde imzalamasını sağlar;
# Gatekeeper'ın "uygulama hasar görmüş" hatası bundan doğar.
#
# Kullanım: bash ./scripts/macos-selfsign.sh [keychain_adı] [şifre] [CN]
# Çağıran iş bittikten sonra 'security delete-keychain <ad>' ile temizler.
# NOT: Yayın kalitesi için Developer ID + notarization gerekir (bu betik
# sadece yerel/self-distro sürümlerin sorunsuz açılması içindir).
set -euo pipefail

KC_NAME="${1:-build.keychain}"
KC_PW="${2:-yazarkasa-selfsign}"
CN="${3:-YazarKasa Self-Signed}"

D="$(mktemp -d)"
trap 'rm -rf "$D"' EXIT

# Kod imzalama (codeSigning) amacına uygun, 10 yıllık self-signed sertifika
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
openssl pkcs12 -export -out "$D/identity.p12" -inkey "$D/key.pem" -in "$D/cert.pem" \
  -name "YazarKasa" -passout "pass:${KC_PW}" 2>/dev/null || true

# Önceki kurulumu temizle (default keychain'i geri ver, sonra sil)
OLD_DEFAULT="$(security default-keychain -d user 2>/dev/null | tr -d ' \n"')"
if security show-keychain-info "$KC_NAME" >/dev/null 2>&1; then
  security default-keychain -s "$OLD_DEFAULT" 2>/dev/null || true
  security delete-keychain "$KC_NAME"
fi

security create-keychain -p "$KC_PW" "$KC_NAME"
security default-keychain -s "$KC_NAME"
security unlock-keychain -p "$KC_PW" "$KC_NAME"
security set-keychain-settings -lut 21600 "$KC_NAME"
# macOS'in secimport'u LibreSSL PKCS12'yi MAC hatasıyla reddettiği için PEM parçaları
# ayrı içe aktarılır. "valid identity" için sertifikanın kendi köküne güvenilir
# (trustRoot) eklenmesi gerekir.
security import "$D/cert.pem" -k "$KC_NAME" -T /usr/bin/codesign -T /usr/bin/security
security import "$D/key.pem" -k "$KC_NAME" -T /usr/bin/codesign -T /usr/bin/security
security add-trusted-cert -d -r trustRoot -k "$KC_NAME" "$D/cert.pem"
security set-key-partition-list -S apple-tool:,apple: -s -k "$KC_PW" "$KC_NAME"
# electron-builder "security find-identity"yi arama listesinden çözer; keychain'i
# arama listesine ekle (login yanında bulunsun, sistem listesini bozma).
security list-keychains -d user -s \
  "$HOME/Library/Keychains/login.keychain-db" \
  "$HOME/Library/Keychains/${KC_NAME}-db"

echo "Hazır — imzalama kimliği:"
security find-identity -v -p codesigning "$KC_NAME"