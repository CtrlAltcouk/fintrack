# Outflow

A self-hosted personal finance tracker. Tracks income, daily spending, and recurring bills with a dark-themed dashboard and charts.

**Stack:** Node.js · Express · SQLite · Chart.js · Vanilla JS  
**Currency:** GBP (£)

![Dashboard](https://img.shields.io/badge/status-active-brightgreen)

---

## One-line install on Proxmox

Run this in your **Proxmox host shell** (not inside a container):

```bash
bash -c "$(wget -qLO - https://raw.githubusercontent.com/CtrlAltcouk/fintrack/main/install.sh)"
```

The script will:
- Prompt for container ID, IP, password, and resources
- Download the Debian 12 template if needed
- Create and start the LXC container
- Install Node.js 20, clone this repo, and start the app with pm2
- Print the URL when done

---

## Manual install (existing Debian 12 system)

```bash
bash -c "$(wget -qLO - https://raw.githubusercontent.com/CtrlAltcouk/fintrack/main/setup.sh)"
```

Then open `http://<your-ip>:3000`

---

## Pages

| Page | What it does |
|---|---|
| Dashboard | Income / spent / remaining cards, 6-month bar chart, donut chart, bills panel |
| Daily Spending | Add/edit/delete transactions grouped by day, filter by category |
| Bills | Recurring bills with paid/unpaid/overdue status, mark paid, cancel |
| Income | Log income sources with monthly totals |
| Reports | Spending by category chart, month-over-month comparison table |
| Settings | Manage categories (add, rename, change colour, delete) |

---

## Requirements

- Proxmox VE 7+ (for the one-line installer)
- OR any Debian 12 / Ubuntu 22+ system (for the manual setup script)
- 512MB RAM, 4GB disk minimum

---

## Running locally (development)

```bash
git clone https://github.com/CtrlAltcouk/fintrack.git
cd fintrack
npm install
npm run dev
```

Open `http://localhost:3000`
