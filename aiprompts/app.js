const statusBox = document.querySelector(".toast");
let statusTimer;
const sourceVideo = document.querySelector("video");
document.querySelectorAll("[data-seek]").forEach((button) =>
  button.addEventListener("click", () => {
    const seek = () => {
      sourceVideo.currentTime = Number(button.dataset.seek);
      sourceVideo.scrollIntoView({
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
        block: "center",
      });
      sourceVideo.focus();
      sourceVideo
        .play()
        .catch(() => notify("Press play to watch this moment."));
    };
    if (sourceVideo.readyState >= 1) seek();
    else {
      sourceVideo.addEventListener("loadedmetadata", seek, { once: true });
      sourceVideo.load();
    }
  }),
);
function notify(message) {
  statusBox.textContent = message;
  statusBox.classList.add("visible");
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => statusBox.classList.remove("visible"), 3200);
}
document.querySelectorAll("[data-copy]").forEach((button) =>
  button.addEventListener("click", async () => {
    const text = document.getElementById(button.dataset.copy).textContent;
    try {
      await navigator.clipboard.writeText(text);
      button.classList.add("copied");
      button.textContent = "Copied ✓";
      notify("Full prompt copied. Ready to paste.");
      setTimeout(() => {
        button.classList.remove("copied");
        button.innerHTML = 'Copy prompt <span aria-hidden="true">⧉</span>';
      }, 2200);
    } catch {
      const pre = document.getElementById(button.dataset.copy);
      pre.closest("details").open = true;
      const selection = getSelection();
      const range = document.createRange();
      range.selectNodeContents(pre);
      selection.removeAllRanges();
      selection.addRange(range);
      pre.focus();
      notify(
        "Clipboard unavailable. Prompt selected—press Ctrl+C or copy from the selection.",
      );
    }
  }),
);
const links = [...document.querySelectorAll("nav a")],
  steps = [...document.querySelectorAll('.step[id^="step-"]')];
let pending = false;
function update() {
  const height = document.documentElement.scrollHeight - innerHeight;
  document.querySelector(".progress").style.transform =
    `scaleX(${height > 0 ? scrollY / height : 0})`;
  let active = steps[0];
  for (const step of steps) {
    if (step.getBoundingClientRect().top < innerHeight * 0.4) active = step;
  }
  for (const link of links) {
    if (link.hash === "#" + active.id)
      link.setAttribute("aria-current", "step");
    else link.removeAttribute("aria-current");
  }
  pending = false;
}
addEventListener(
  "scroll",
  () => {
    if (!pending) {
      pending = true;
      requestAnimationFrame(update);
    }
  },
  { passive: true },
);
addEventListener("resize", update);
update();
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape")
    document.querySelectorAll(".tip[open]").forEach((el) => (el.open = false));
});
const helpTrigger = document.querySelector("[data-help]");
const helpPanel = document.querySelector("#help-panel");
helpTrigger?.addEventListener("click", () => {
  helpPanel.hidden = !helpPanel.hidden;
  helpTrigger.setAttribute("aria-expanded", String(!helpPanel.hidden));
  if (!helpPanel.hidden) {
    helpPanel.scrollIntoView({ behavior: "smooth", block: "center" });
  }
});

const consultationTrigger = document.querySelector(".consultation-trigger");
const consultationForm = document.querySelector("#consultation-form");
consultationTrigger?.addEventListener("click", () => {
  consultationForm.hidden = !consultationForm.hidden;
  consultationTrigger.setAttribute("aria-expanded", String(!consultationForm.hidden));
  consultationTrigger.innerHTML = consultationForm.hidden
    ? 'Request a private consultation <span>↓</span>'
    : 'Close request form <span>↑</span>';
  if (!consultationForm.hidden) consultationForm.querySelector("input")?.focus();
});

consultationForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formStatus = consultationForm.querySelector(".form-status");
  const submitButton = consultationForm.querySelector('button[type="submit"]');
  const endpoint = window.CONTACT_ENDPOINT || "";
  if (!endpoint) {
    formStatus.textContent = "The booking inbox is being connected. Please contact @ammar_doesphotography on Instagram for now.";
    return;
  }
  submitButton.disabled = true;
  formStatus.textContent = "Sending your request…";
  try {
    const payload = Object.fromEntries(new FormData(consultationForm).entries());
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error("Request failed");
    consultationForm.reset();
    formStatus.textContent = "Thank you — Ammar will be in touch soon.";
  } catch {
    formStatus.textContent = "Couldn’t send that just now. Please contact @ammar_doesphotography on Instagram.";
  } finally {
    submitButton.disabled = false;
  }
});
if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
  import("https://cdn.jsdelivr.net/npm/motion@12.23.12/+esm")
    .then(({ animate, inView }) => {
      inView(
        ".step",
        (element) => {
          animate(
            element,
            {
              opacity: [0.65, 1],
              transform: ["translateY(14px)", "translateY(0)"],
            },
            { duration: 0.45, ease: "easeOut" },
          );
        },
        { margin: "0px 0px -40px 0px" },
      );
      document.querySelectorAll(".button").forEach((button) => {
        button.addEventListener("pointerenter", () =>
          animate(button, { y: -2 }, { duration: 0.18 }),
        );
        button.addEventListener("pointerleave", () =>
          animate(button, { y: 0 }, { duration: 0.18 }),
        );
      });
      document
        .querySelectorAll(".copy")
        .forEach((button) =>
          button.addEventListener("click", () =>
            animate(button, { scale: [1, 0.96, 1] }, { duration: 0.25 }),
          ),
        );
    })
    .catch(() => {
      /* Content and controls work without animation. */
    });
}
