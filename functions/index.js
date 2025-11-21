const functions = require("firebase-functions")

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
