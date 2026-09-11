const allowedOrigin = "https://stacktime.me";

function headers(origin) {
  return {
    "Access-Control-Allow-Origin": origin === allowedOrigin ? allowedOrigin : allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Origin",
  };
}

function reply(body, status, origin) {
  return new Response(JSON.stringify(body), { status, headers: headers(origin) });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: headers(origin) });
    if (origin !== allowedOrigin || request.method !== "POST") return reply({ error: "Not found" }, 404, origin);

    let payload;
    try {
      payload = await request.json();
    } catch {
      return reply({ error: "Invalid request" }, 400, origin);
    }

    const name = String(payload.name || "").trim().slice(0, 120);
    const email = String(payload.email || "").trim().slice(0, 254);
    const whatsapp = String(payload.whatsapp || "").trim().slice(0, 80);
    const message = String(payload.message || "").trim().slice(0, 3000);
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return reply({ error: "Please provide your name and a valid email." }, 400, origin);
    }

    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: env.FROM_EMAIL,
        to: [env.TO_EMAIL],
        reply_to: email,
        subject: `New consultation request from ${name}`,
        text: [
          "New private consultation request from StackTime.",
          "",
          `Name: ${name}`,
          `Email: ${email}`,
          `WhatsApp: ${whatsapp || "Not provided"}`,
          "",
          `Message:\n${message || "Not provided"}`,
        ].join("\n"),
      }),
    });

    if (!emailResponse.ok) return reply({ error: "Email delivery failed" }, 502, origin);
    return reply({ ok: true }, 200, origin);
  },
};
