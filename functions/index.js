const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();

// HTTP endpoint: maakt een issue aan in GitHub
exports.reportIssue = functions.https.onRequest(async (req, res) => {
  // CORS
  const origin = req.get("Origin")
  const allowedOrigins = [
    "https://prive-jo.web.app",
    "https://prive-jo-dev.web.app"
  ]

  if (allowedOrigins.includes(origin)) {
    res.set("Access-Control-Allow-Origin", origin)
  } else {
    res.set("Access-Control-Allow-Origin", allowedOrigins[0])
  }
  res.set("Vary", "Origin")
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS")
  res.set("Access-Control-Allow-Headers", "Content-Type")

  if (req.method === "OPTIONS") {
    res.status(204).send("")
    return
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST" })
    return
  }

    const token = process.env.GITHUB_TOKEN
  const repo = process.env.GITHUB_REPO

  if (!token || !repo) {
    console.error("Missing GITHUB_TOKEN or GITHUB_REPO env vars")
    res.status(500).json({ error: "GitHub config ontbreekt" })
    return
  }


  const body = req.body || {}
  const type = body.type
  const title = body.title
  const description = body.description
  const context = body.context || null

  if (!title || !description || !type) {
    res.status(400).json({ error: "Titel, type en beschrijving zijn verplicht" })
    return
  }

  const labels = []

  if (type === "bug") labels.push("type/bug")
  if (type === "enhancement") labels.push("type/enhancement")
  if (type === "idea") labels.push("type/idea")

  if (context && context.env) {
    labels.push(`env/${String(context.env).toLowerCase()}`)
  }

  labels.push("from-app")

  let issueBody = description + "\n\n"
  issueBody += "---\n"
  issueBody += "Ingediend via app\n"

  if (context) {
    issueBody += `Environment: ${context.env || "nvt"}\n`
    issueBody += `Pagina-id: ${context.pageId || "nvt"}\n`
    issueBody += `URL: ${context.url || "nvt"}\n`
    issueBody += `Titel: ${context.title || "nvt"}\n`
    issueBody += `User-Agent: ${context.userAgent || "nvt"}\n`
  }

  const apiUrl = `https://api.github.com/repos/${repo}/issues`

  try {
    const ghRes = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/vnd.github+json",
        "User-Agent": "firebase-report-issue"
      },
      body: JSON.stringify({
        title,
        body: issueBody,
        labels
      })
    })

    if (!ghRes.ok) {
      const text = await ghRes.text()
      console.error("GitHub issue error", ghRes.status, text)
      res.status(500).json({ error: "Issue maken mislukt" })
      return
    }

    const json = await ghRes.json()
    res.status(200).json({
      number: json.number,
      url: json.html_url
    })
  } catch (err) {
    console.error("GitHub fetch fout", err)
    res.status(500).json({ error: "Interne fout bij aanmaken issue" })
  }
})

// ── Dagelijkse herinneringen: workflow kaarten met deadline vandaag ────────────
// Draait elke werkdag om 08:00 (Europe/Brussels)
// Vereist Blaze (pay-as-you-go) plan op Firebase
exports.sendDailyReminders = functions.pubsub
  .schedule("0 8 * * 1-5")
  .timeZone("Europe/Brussels")
  .onRun(async () => {
    const db = admin.firestore();
    const messaging = admin.messaging();

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const snap = await db.collection("workflowCards")
      .where("dueDate", ">=", admin.firestore.Timestamp.fromDate(today))
      .where("dueDate", "<",  admin.firestore.Timestamp.fromDate(tomorrow))
      .where("finishedAt", "==", null)
      .get();

    if (snap.empty) return null;

    // Groepeer per gebruiker
    const byUser = {};
    snap.forEach((d) => {
      const { uid, title } = d.data();
      if (!uid) return;
      if (!byUser[uid]) byUser[uid] = [];
      byUser[uid].push(title || "Taak");
    });

    const sends = Object.entries(byUser).map(async ([uid, titles]) => {
      const tokenDoc = await db.doc(`fcmTokens/${uid}`).get();
      if (!tokenDoc.exists) return;
      const { token } = tokenDoc.data();
      if (!token) return;

      const count = titles.length;
      await messaging.send({
        token,
        notification: {
          title: `${count} deadline${count > 1 ? "s" : ""} vandaag`,
          body: titles.slice(0, 3).join(", ") + (count > 3 ? ` +${count - 3} meer` : ""),
        },
        webpush: {
          fcmOptions: { link: "/src/modules/Workflow/workflow.html" },
          notification: {
            icon: "/icons/icon-192.png",
            badge: "/icons/icon-192.png",
            tag: "workflow-deadline",
          },
        },
      });
    });

    await Promise.allSettled(sends);
    return null;
  });
