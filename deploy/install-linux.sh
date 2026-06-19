#!/usr/bin/env sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root"
  exit 1
fi

install -d -o reloop -g reloop /opt/reloop /etc/reloop /var/lib/reloop /var/log/reloop
cp -r rvm /opt/reloop/
python3 -m venv /opt/reloop/.venv
/opt/reloop/.venv/bin/pip install -r /opt/reloop/rvm/requirements.txt
cp rvm/config.example.json /etc/reloop/rvm.json
cp deploy/reloop-rvm.service /etc/systemd/system/
cp deploy/reloop-kiosk.service /etc/systemd/system/
systemctl daemon-reload
echo "Edit /etc/reloop/rvm.json, then run:"
echo "systemctl enable --now reloop-rvm reloop-kiosk"
