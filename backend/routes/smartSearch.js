const express = require("express");
const router = express.Router();
const { spawn } = require("child_process");
const path = require("path");
const { optionalAuth } = require("../middleware/auth");

const PYTHON_SCRIPT = path.join(__dirname, "..", "python-services", "smart_search.py");
const PYTHON_VENV = path.join(__dirname, "..", "python-services", "venv", "bin", "python3");
const SEARCH_TIMEOUT = 180000; // 3 minutes max for Nova Act

router.post("/", optionalAuth, async (req, res, next) => {
  try {
    const { query } = req.body;

    if (!query || typeof query !== "string" || query.trim().length === 0) {
      return res.status(400).json({ error: "query is required" });
    }

    console.log(`\n[smartSearch] ========== SMART SEARCH REQUEST ==========`);
    console.log(`[smartSearch] query: "${query}"`);
    console.log(`[smartSearch] authenticated: ${!!req.userId}`);
    console.log(`[smartSearch] Spawning Python Nova Act process...`);

    const result = await runPythonSearch(query.trim());

    console.log(`[smartSearch] Results: ${result.products ? result.products.length : 0} products`);
    console.log(`[smartSearch] ========== SMART SEARCH COMPLETE ==========\n`);

    res.json(result);
  } catch (error) {
    console.error(`[smartSearch] Error:`, error.message);

    // Return a user-friendly error instead of letting it fall through to the generic 500 handler
    let userMessage = "Smart search encountered an issue. Please try again.";
    if (error.message.includes("timed out")) {
      userMessage = "The search took too long — please try a simpler query or try again in a moment.";
    } else if (error.message.includes("Failed to spawn Python") || error.message.includes("ENOENT")) {
      userMessage = "Smart search is temporarily unavailable. The search service could not be started.";
    } else if (error.message.includes("No JSON output")) {
      userMessage = "The search completed but returned no results. Try rephrasing your query.";
    }

    res.status(502).json({ error: userMessage });
  }
});

/**
 * Spawn the Python smart_search.py script and collect JSON output.
 */
function runPythonSearch(query) {
  return new Promise((resolve, reject) => {
    // Use venv Python if available, otherwise fall back to system python3
    const fs = require("fs");
    const pythonCmd = fs.existsSync(PYTHON_VENV) ? PYTHON_VENV : (process.platform === "win32" ? "python" : "python3");

    const child = spawn(pythonCmd, [PYTHON_SCRIPT, "--query", query], {
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
      },
      timeout: SEARCH_TIMEOUT,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      const msg = data.toString();
      stderr += msg;
      // Forward Python logs to Node console
      process.stderr.write(`[smartSearch/python] ${msg}`);
    });

    child.on("close", (code) => {
      if (code !== 0 && !stdout.trim()) {
        reject(new Error(`Python process exited with code ${code}: ${stderr}`));
        return;
      }

      try {
        // Find the last line of stdout that looks like JSON
        const lines = stdout.trim().split("\n");
        let jsonStr = "";
        for (let i = lines.length - 1; i >= 0; i--) {
          if (lines[i].startsWith("{")) {
            jsonStr = lines[i];
            break;
          }
        }

        if (!jsonStr) {
          reject(new Error("No JSON output from Python script"));
          return;
        }

        const result = JSON.parse(jsonStr);
        resolve(result);
      } catch (parseErr) {
        reject(new Error(`Failed to parse Python output: ${parseErr.message}`));
      }
    });

    child.on("error", (err) => {
      reject(new Error(`Failed to spawn Python: ${err.message}`));
    });

    // Kill if timeout exceeded
    setTimeout(() => {
      if (!child.killed) {
        child.kill("SIGTERM");
        reject(new Error("Smart search timed out"));
      }
    }, SEARCH_TIMEOUT);
  });
}

module.exports = router;
