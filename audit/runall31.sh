#!/bin/bash
export NODE_PATH=/home/claude/.npm-global/lib/node_modules
for t in t1-permaqr t2-charge t3-total t4-edge t5-sweep t6-stress t7-qrroundtrip t8-single t9-names \
         t10-lang t11-langs t12-cashback-off t13-site t14-paylink t15-gateway t16-refund t17-standard-qr \
         t18-errors t19-diagnose t20-purchase t21-gas t22-history t23-vesting t24-small-amounts \
         t25-injection-and-network t26-gateway-local t27-invoice-page t28-web-invoice t29-pay-refusals \
         t30-new-wallet-and-gas t31-seed-and-overwrite t32-site-page t33-android-manifest t34-scan-currency-and-screens t35-move-to-domain t36-two-hosts t37-lookalike-names t38-faceid-web \
         t39-invoice-trust t40-stale-state t41-invoice-log t42-seed-import t43-totp-stable t44-totp-everywhere t45-name-price t46-thirteenth-word t47-late-confirm t48-cabinet-lang; do
  printf "%-26s " "$t"
  timeout 600 node $t.mjs 2>&1 | grep -E "^--- |^ПРОВАЛ|^ОШИБКИ|^  pageerror|^  console" | tr '\n' ' '
  echo
done
echo "ВСЁ"
