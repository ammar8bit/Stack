# Stack

Stack is a minimal, browser based study timer built to help you stay consistent and accountable. It tracks your study sessions, lets you time individual practice questions, run focused countdowns, and set an overall hours goal with a deadline so you always know exactly how much you need to do today. Everything runs locally in your browser with no sign up, no server, and no tracking.

Stack was built by Ammar, an ACCA student, as a personal tool to study more consistently, and shared so anyone else working toward a goal (exams, certifications, coursework, or anything else) can use it too.

## Live Demo

Once deployed with GitHub Pages, your live link will be:

```
https://ammar8bit.github.io/Stack/
```

## Features

### Three Timer Modes
- **Session**: Tracks your full study session from start to finish. This is the main timer and it keeps running in the background even while you use the other modes.
- **Practice**: Times how long each individual question or exercise takes you, while your overall session timer keeps counting in the background.
- **Timer**: A countdown timer for focused, timed work. Set a custom hours, minutes, and seconds target and Stack counts down from there.

Hovering over each mode button shows a short explanation of what it does.

### Pause and Resume
Taking a break does not cost you your progress. Pause freezes the active timer exactly where it is, and Resume picks it back up without losing any recorded time.

### Goals and Deadlines
On first use, Stack asks how many hours you want to study and by what date. From that point on, it automatically works out how many hours you need to complete today to stay on track, and shows this as a small progress widget in the corner of the screen alongside your overall progress bar.

You are never locked into a goal:
- Change your goal hours or deadline at any time from Settings.
- Prefer not to track a fixed goal at all? Choose "Start Without a Goal" during setup, or turn off Goal Tracking later in Settings. Stack will then simply show your total accumulated study time instead of a progress bar.
- When you reach your goal, or your deadline passes, a small popup lets you know and gives you the option to set a new goal and deadline or keep logging sessions as they are.

### Countdown Alerts
When a countdown timer in Timer mode reaches zero, Stack lets you know in three ways:
1. A short audio chime (built with the Web Audio API, so it works offline with no external sound files).
2. The browser tab title flashes until you stop or reset the timer, so you notice even if you have switched tabs.
3. An optional browser notification if the tab is in the background and notification permission has been granted.

Sound alerts can be muted at any time from Settings.

### Daily Motivation
A rotating collection of study and productivity quotes appears above the timer and refreshes automatically while you are working.

### Light and Dark Themes
Toggle between a dark, warm red theme and a light, cream colored theme from the Settings panel. Your preference is remembered automatically.

### Fully Responsive
The layout adjusts for desktops, laptops, tablets, and phones, so the experience stays consistent no matter what device you are studying on.

### Local, Private, and Persistent
All of your data (session totals, goal settings, theme preference, and so on) is stored in your browser's local storage. Nothing is ever sent to a server. Your progress is remembered automatically the next time you open the page, and stays entirely on your own device.

## Getting Started

Stack is a single self contained HTML file. There is nothing to install and no build step.

### Option 1: Open It Directly
Download or clone the repository and open `index.html` in any modern web browser.

### Option 2: Host It with GitHub Pages
1. Push this repository to GitHub, making sure the main file is named `index.html` at the root of the repo (or inside a `/docs` folder if you prefer that structure).
2. In your repository, go to **Settings > Pages**.
3. Under **Source**, select the branch you want to deploy from (usually `main`) and the root folder.
4. Save. GitHub will publish your site at `https://<your-username>.github.io/<repo-name>/` within a few minutes.

## How to Use It

1. On your first visit, a welcome screen explains how Stack works and asks you to set a study goal (total hours and a deadline), or you can skip goal tracking entirely.
2. Choose a mode: Session, Practice, or Timer.
3. Press Start to begin timing. Use Pause if you need a break, and Reset to clear the current timer without affecting your saved totals.
4. Check the widget in the top left corner at any time to see how many hours you need to hit today to stay on pace for your goal.
5. Open Settings (the gear icon in the bottom right) at any time to change your goal, deadline, theme, or sound preferences, or to reset all of your progress.

## Customization

Everything under the gear icon in the bottom right is adjustable:

| Setting | What It Does |
|---|---|
| Light Theme | Switches between dark and light color schemes |
| Goal Tracking | Turns your hours goal and deadline on or off |
| Goal (hours) | Sets your total study hours target |
| Deadline | Sets the date you want to reach your goal by |
| Timer Sound Alert | Mutes or unmutes the countdown finish sound |
| Contact Support | Shows an email address to get in touch |
| Reset All Progress | Permanently clears all saved study data |

## Tech Stack

Stack is built with plain HTML, CSS, and JavaScript. No frameworks, no build tools, and no dependencies to install.

- Fonts are loaded from Google Fonts (Anton for the timer display, Inter for body text).
- All timing logic uses `performance.now()` for accuracy, and `requestAnimationFrame` for smooth updates.
- Data persistence uses the browser's `localStorage` API.
- Countdown alert sounds are generated with the Web Audio API.

## Browser Support

Stack works in all modern browsers (Chrome, Firefox, Safari, Edge) on both desktop and mobile. Since it relies on `localStorage`, browsing in a fully private or incognito window may prevent your progress from being saved between sessions.

## Data and Privacy

Stack does not collect, transmit, or store any of your data outside of your own browser. There is no backend, no analytics, and no account system. If you clear your browser's site data or use a different browser or device, your saved progress will not carry over.

## Support the Project

If Stack has helped you stay consistent with your own studying, you are welcome to support its development:

- GitHub Sponsors: coming soon
- Binance UID: coming soon

## Contact

Questions, feedback, or bug reports are welcome. Reach out at **ammarkhan5683@gmail.com**, or use the Contact Support option inside the app's Settings panel.

## Contributing

This started as a personal tool, but suggestions and improvements are welcome. Feel free to open an issue or submit a pull request if you would like to contribute.

## License

No formal license has been applied to this project yet. If you would like to reuse, modify, or distribute this code, please reach out first.

## Acknowledgements

Built by Ammar, an ACCA student, to make studying toward a long term goal a little more structured and a lot more consistent. If it helps you the same way, that is the whole point.
