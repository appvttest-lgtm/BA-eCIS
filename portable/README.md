# Australia Post Barcode Auditer — run locally with Node.js

This is the **no-install** version of the tool. It runs on the Node.js you install
from the company software portal, so there is **no .exe** to be blocked by workstation
security policy and nothing needs to be code-signed.

Everything runs locally on your own machine. The tool does not upload or store label
data on any server.

---

## 1. Install Node.js (one time)

Install **Node.js LTS (version 20.10 or newer)** from the Company Software Portal /
Software Center.

Confirm it worked: open a terminal (PowerShell or Command Prompt) and run

    node --version

You should see something like `v20.x` or `v22.x`.

## 2. Unzip this folder

Unzip it somewhere you can write to, e.g. your **Documents** folder. Avoid running it
from inside the zip preview.

## 3. Start the tool

1. Open a terminal **in the unzipped folder**:
   In File Explorer, hold **Shift**, right-click the folder, and choose
   **"Open PowerShell window here"** (or **"Open in Terminal"**).
2. Run:

       node server.mjs

   You should see:

       eParcel Auditor Local running at http://127.0.0.1:3000

3. Leave this terminal window open while you use the tool.

## 4. Open the tool in your browser

Go to:

    http://127.0.0.1:3000

## 5. Stop the tool

Close the terminal window, or press **Ctrl + C** in it. (Closing the terminal stops
the local server.)

---

## Troubleshooting

- **"node is not recognized"** — Node.js isn't installed yet, or the terminal was open
  before you installed it. Install Node from the portal (step 1), then open a *new*
  terminal.
- **"Port 3000 is already in use"** — start it on a different port. In PowerShell:

       $env:PORT = 3001 ; node server.mjs

  then open `http://127.0.0.1:3001` instead.
- **Page won't load** — make sure the terminal still shows the "running at..." message
  and that you used `http://` (not `https://`).

## Feedback

Please send feedback to: _<add your name / email / Teams channel here>_
