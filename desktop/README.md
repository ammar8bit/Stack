# StackTime for Windows

A desktop app for [StackTime](https://stacktime.me/) built with Electron. It shows the same site as
the website, bundled locally, and adds what a browser tab cannot do: a tray icon with a live timer,
an always-on-top mini view, global hotkeys, native notifications, and a timer that keeps working
with no internet.

The website stays a single dependency-free `index.html`. Everything desktop-specific lives in this
folder, which has its own `package.json`.

## Run it

Requires Node.js 20 or newer.

```bash
cd desktop
```

```bash
npm install
```

```bash
npm run dev
```

If `npm install` reports that install scripts were skipped (newer npm versions do this), download
the Electron binary once with `node node_modules/electron/install.js`.

| Script | What it does |
| --- | --- |
| `npm run dev` | Copies the site, generates the icon and starts the app |
| `npm run build` | Unpacked app in `dist/win-unpacked` (quick check, no installer) |
| `npm run dist` | NSIS installer at `dist/StackTime-Setup-<version>.exe` |
| `npm run prepare:site` | Only the copy + icon step (the scripts above run it for you) |

A development run keeps its data in `%APPDATA%\StackTime (dev)`, separate from the installed app
(`%APPDATA%\StackTime`), so both can be open at once.

## Using it

- **Tray icon** – hover for the live timer. Right-click for Start/Pause, Open, Show/Hide Mini View,
  Launch on startup, Hotkeys and Quit. Closing the window keeps the timer running in the tray;
  only **Quit** exits.
- **Mini view** – small always-on-top timer with a play/pause button and today's progress against
  your daily goal. Drag it anywhere; it remembers its position.
- **Global hotkeys** (work while any app is focused):

  | Action | Default |
  | --- | --- |
  | Start / pause the timer | `Ctrl + Alt + S` |
  | Show / hide the mini view | `Ctrl + Alt + V` |
  | Show / hide the main window | `Ctrl + Alt + T` |

  Change them under tray → **Hotkeys…** (or Settings → Desktop app → Hotkeys). If another program
  already owns a combination, the settings window says so and keeps your previous hotkey.
- **Offline** – the app opens and the timer, goals and totals work with no connection. Cloud backup
  and Study Together show an Offline state; changes are kept on the device and sync when you
  reconnect. If another device changed your account while this one was offline, you are asked what
  to keep. A running timer is never replaced silently.
- **Sign-in** – email and password work inside the app, and the session survives restarts. Google
  sign-in opens your browser and returns through the `stacktime://` link (see "Google sign-in").

## How it fits together

```
desktop/
  scripts/prepare-site.js   copies ../index.html + icons into site/, vendors CDN files for offline use
  scripts/make-icon.js      builds build/icon.ico from ../assets/logo-512.png
  src/main.js               main process: windows, IPC, security rules, notifications, protocol links
  src/timer.js              derives the tray / mini view display from the timer snapshot
  src/windows.js            main window, mini view, settings window
  src/tray.js  src/hotkeys.js  src/config.js  src/protocol.js  src/updater.js
  src/preload/              the only bridges between the pages and the main process
  src/renderer/bridge.js    desktop behaviour that runs inside the site (sync queue, offline UI, ...)
  src/renderer/mini.*  settings.*
  test/                     development-only test harness (not shipped)
```

- **One source of truth.** `site/` is generated from the repository root on every `dev`, `build` and
  `dist`. Never edit it. The build fails loudly if the website's `<script>`/font tags change in a way
  the copy step does not recognise.
- **Works offline.** The website loads Supabase, Motion and Google Fonts from CDNs. The copy step
  swaps those for files from `node_modules` (`@supabase/supabase-js`, `motion`, `@fontsource/*`),
  so the packaged app needs nothing from the network to start.
- **The bridge in `index.html`.** The page checks `window.stacktimeDesktop`, which only exists inside
  this app. In a browser it is `undefined`, `desktopHooks` stays `null`, and each
  `if (desktopHooks)` line is skipped, so the website behaves exactly as before.
- **Shared timer state.** The page keeps running the timer logic (one implementation, shared with
  the website) and publishes a snapshot of timestamps to the main process on every change. The main
  process is the hub: the tray tooltip and mini view are computed there as "now minus start time",
  and Start/Pause from the tray, mini view or a hotkey is routed back to the page. Nothing counts
  ticks, so there is no drift after sleep or hours in the tray. `backgroundThrottling` is off so
  the hidden page keeps saving heartbeats and finishing countdowns on time.
- **Sleep.** Time spent asleep counts the same way it does on the website: the timer is wall-clock
  based, and if the machine was away for more than 3 hours the session is paused at the last moment
  the app was alive (the website's existing "stale timer" rule).

## Security

- `contextIsolation` on, `nodeIntegration` off, renderer sandbox on, no `<webview>`.
- Pages are served from a private `app://stacktime` origin with a Content-Security-Policy that only
  allows connections to the app's own Supabase project.
- The preload scripts expose a few named one-way messages; every IPC handler checks which window
  sent it.
- Navigation away from the bundled pages and all pop-ups are blocked; `https:` and `mailto:` links
  open in the default browser.
- Only the notification and clipboard-write permissions are granted.

## Google sign-in

The app is ready for it, but two things in the Supabase dashboard are needed (they need your
account, so they are not automated):

1. **Authentication → Providers → Google**: enable it and add your Google OAuth client. At the
   moment the project answers "provider is not enabled", which also affects the button on the website.
2. **Authentication → URL Configuration → Redirect URLs**: add `stacktime://auth-callback`.

The app uses the PKCE flow: it opens the system browser, Supabase redirects to
`stacktime://auth-callback?code=…`, Windows hands that link to the running app, and the app trades
the one-time code for a session. No token ever appears in a URL.

## Releasing

### Build the installer

```bash
npm run dist
```

This produces `dist/StackTime-Setup-<version>.exe`: a one-click, per-user NSIS installer (no admin
prompt) that adds Start Menu and desktop shortcuts, registers the `stacktime://` link and an
uninstaller. User data in `%APPDATA%\StackTime` is kept on uninstall.

Bump `version` in `desktop/package.json` before each release.

### Code signing

The installer is currently **unsigned**, so Windows SmartScreen shows "Windows protected your PC"
until the user clicks *More info → Run anyway*. To remove that warning you need a code-signing
certificate, which has to be bought:

- **Azure Trusted Signing** (cheapest, monthly) – add `build.win.azureSignOptions` to `package.json`.
- **OV/EV certificate** from a CA (Sectigo, DigiCert, …) – set the environment variables
  `CSC_LINK` (path or base64 of the `.pfx`) and `CSC_KEY_PASSWORD`, then run `npm run dist`.
  electron-builder signs the app and the installer automatically when they are present.

Never commit the certificate or its password.

### Auto-update (wired, off until there is a release feed)

`electron-updater` is included and called on startup, but it does nothing until a build contains
`resources/app-update.yml`, which electron-builder only writes when a publish target is configured.
`package.json` currently has `"publish": null`, so today the app makes no update requests.

To switch it on with GitHub Releases:

1. In `desktop/package.json`, replace `"publish": null` under `build` with:

   ```json
   "publish": [{ "provider": "github", "owner": "ammar8bit", "repo": "Stack" }]
   ```

2. Create a GitHub token with `repo` scope, set it as `GH_TOKEN`, and run
   `npx electron-builder --win nsis --publish always`. This uploads the installer, its blockmap and
   `latest.yml` to a draft release; publish the draft.
3. From then on installed apps check on startup, download in the background and update on the next
   quit. Updates should be signed with the same certificate as the installed version.

## Testing

`test/harness.js` is loaded only in a development run when `STACKTIME_TEST_PORT` is set. It exposes
a local control port so a script can click tray items, hide windows, take screenshots and switch
the app offline (`node test/ctl.js status`). It is not included in packaged builds.
