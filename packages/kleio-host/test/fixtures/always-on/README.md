# Always-on check fixtures (always-on.test.ts)

Captured read-only on 2026-10-16:

- `macbook-batt.txt`, `macbook-custom.txt`: `pmset -g batt` and `pmset -g custom`
  on a MacBook (it has a battery).
- `mini-batt.txt`, `mini-custom.txt`: the same on the Mac mini, a desktop.

Built by hand (no Windows PC, desktop Mac with a UPS or Linux box was at hand):

- `built-desktop-sleepy-custom.txt`: `mini-custom.txt` with `sleep 10`,
  `autorestart 0` and `womp 0`.
- `built-desktop-ups-batt.txt`: `mini-batt.txt` plus a UPS's line.
- `built-powercfg-*.txt`: `powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE`
  in the layout Microsoft documents: sleep never (`never`), after 30 minutes
  (`30min`), German labels with sleep after an hour (`german`), and no value
  (`unknown`). Stored with LF; the tests feed them with CRLF, as Windows prints.

systemctl's answers are single words (systemctl(1)), so they are written inline
in the test, and the sysfs trees are made in a temp folder per test.
