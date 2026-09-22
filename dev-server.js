import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 1. Load environment variables from .env.local or .env
for (const envFile of [".env.local", ".env"]) {
  const envPath = path.join(__dirname, envFile);
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        process.env[key] = val;
      }
    }
  }
}

// 2. Import API route handlers
const routes = {
  room: (await import("./api/room.js")).default,
  mission: (await import("./api/mission.js")).default,
  labels: (await import("./api/labels.js")).default,
  analyze: (await import("./api/analyze.js")).default,
  features: (await import("./api/features.js")).default,
  dataset: (await import("./api/dataset.js")).default,
  quality: (await import("./api/quality.js")).default,
  health: (await import("./api/health.js")).default,
  camera: (await import("./api/camera.js")).default,
  recovery: (await import("./api/recovery.js")).default,
  scores: (await import("./api/scores.js")).default,
};

const mimeTypes = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
  ".csv": "text/csv",
  ".txt": "text/plain",
};

// 3. Create HTTP Server
const server = http.createServer(async (req, res) => {
  // Add Vercel response helper methods
  res.status = function (code) {
    res.statusCode = code;
    return res;
  };
  res.json = function (data) {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(data));
  };

  const urlObj = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  let pathname = urlObj.pathname;

  // Handle /api/ routes
  if (pathname.startsWith("/api/")) {
    const routeName = pathname.slice(5).replace(/\.js$/, "");
    const handler = routes[routeName];

    if (!handler) {
      return res.status(404).json({ error: `API route /api/${routeName} not found` });
    }

    // Parse request body for POST/PUT requests
    let bodyData = "";
    req.on("data", (chunk) => {
      bodyData += chunk;
    });
    req.on("end", async () => {
      try {
        if (bodyData) {
          try {
            req.body = JSON.parse(bodyData);
          } catch {
            req.body = bodyData;
          }
        } else {
          req.body = {};
        }
        await handler(req, res);
      } catch (err) {
        console.error(`[API Error in /api/${routeName}]:`, err);
        if (!res.writableEnded) {
          res.status(err.status || 500).json({ error: err.message || "Internal Server Error" });
        }
      }
    });
    return;
  }

  // Handle Static Files in public/
  if (pathname === "/") pathname = "/index.html";
  const filePath = path.join(__dirname, "public", path.normalize(pathname).replace(/^(\.\.[\/\\])+/, ""));

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "text/plain");
      return res.end("404 Not Found");
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] || "application/octet-stream";
    res.setHeader("Content-Type", contentType);
    fs.createReadStream(filePath).pipe(res);
  });
});

const PORT = process.env.PORT || 3000;

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\n❌ Error: Port ${PORT} is currently in use by another process.`);
    console.error(`👉 Please close any other terminal running 'vercel dev' or Node server, then try again.\n`);
    process.exit(1);
  } else {
    throw err;
  }
});

server.listen(PORT, () => {
  console.log(`\n==================================================`);
  console.log(`🚀 Expedition Unknown Local Dev Server Ready!`);
  console.log(`👉 Host Page:    http://localhost:${PORT}/host.html`);
  console.log(`👉 Player Page:  http://localhost:${PORT}`);
  console.log(`==================================================\n`);
});
