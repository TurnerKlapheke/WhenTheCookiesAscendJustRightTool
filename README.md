# Ascend At 1 Trillion (Cookie Clicker mod)

**Goal:** Automatically reach **exactly 1,000,000,000,000 (1 trillion)** cookies in **bank** and ascend.
This mod runs a fully automated, phase-based strategy so players can earn the “When The Cookies Ascend Just Right” shadow achievement with minimal fuss.

- Growth → Sell‑down (2 sub‑phases) → Farm‑only trim → Clicks‑only → Overshoot fix
- ROI model inspired by CookieMonster: `max(cost - bank, 0) / cps + cost / Δcps`
- Accurate Δcps: buildings via stored cps; upgrades via simulated buy → `Game.CalculateGains()` → revert
- Safe upgrade filters (avoids prestige/toggles/flat clickers/farm productivity; allows **% of CpS** clickers)
- Debug overlay (press **F7**): phase, bank, gap, CPS, click size, building counts, last action
- Auto‑start on load and after reincarnate

> ⚠️ **Halo gloves:** If owned, click size > 1. For exact single‑cookie precision in the final phase, use **Born again** (no heavenly upgrades). The debug overlay shows current click size and tags halo presence.

---

## Install (Steam)

1) In Steam: **Cookie Clicker → Manage → Browse local files**  
2) Open `resources/app/mods/local/`  
4) Download the latest release `.zip` from [Releases](https://github.com/<your-username>/cookieclicker-1trillion-mod/releases).
5) Extract and place the contained folder in `resources/app/mods/local/`.
6) Launch the game → **Options → Mods** → enable **Ascend At 1 Trillion**

---

## Usage

- Enable the mod. It starts automatically (on load and after reincarnate).  
- It will buy the best ROI buildings/upgrades, taper CPS near the end, sell everything for a precise finish, then **ascend and reincarnate** for you.

**Debug overlay:** press **F7** to toggle.

---

## Configuration

Top of `main.js`:

```js
mod.TARGET = 1e12;        // 1,000,000,000,000
mod.CLOSE_4_PHASE2 = 6e11;
mod.PHASE3_ENTER_GAP = 1e8;
mod.FINAL_CLICK_GAP = 2e4;
mod.PRECISION_SLOW_GAP = 1e2;
mod.OVERSHOOT_TOL = 0;
mod.LOOP_MS = 200;

// Phase‑2 sub‑tuning
mod.P2B_GAP = 1e9;
mod.P2A_SELL_PCT = 0.10;
mod.P2B_SELL_PCT = 0.25;
mod.P2A_ROI_CAP = 60;
```

Adjust if you want to be more or less aggressive; defaults aim for fast, safe completion on both fresh and late‑game saves.

---

## How it works (short)

- **ROI chooser** evaluates buildings and unlocked upgrades and picks the lowest time‑to‑payback.  
- **Sell‑down** has two sub‑phases: light taper while still allowing “slam‑dunk” ROI buys, then heavier taper with no new buys.  
- **Farm‑only trim** keeps only farms (un‑upgraded) and trims as you approach the target.  
- **Clicks‑only** sells all buildings and finishes by clicking; precision slows in the last few hundred cookies.  
- **Overshoot fix** buys and immediately sells cheap buildings (e.g., farm/cursor) to bring the bank back under target if needed.

---

## Compatibility / limits

- Works standalone; no CCSE required.  
- Avoids cosmetic toggles (seasons, milk styles, sound selectors).  
- If you use other automation mods, expect interference.  
- For 1‑cookie precision, use **Born again** if you own **Halo gloves**.

## Acknowledgements & Tooling

- **Design & implementation:** human‑written strategy and code, including phase logic, selling heuristics, and debug UX.
- **AI assistance:** portions of method‑hook discovery (what to call from Cookie Clicker’s main API), small algorithmic refinements, and this README were assisted by **ChatGPT‑5 Thinking**.
- Thanks to the Cookie Clicker community for the widely shared “1 trillion” strategies that inspired the phase structure.
