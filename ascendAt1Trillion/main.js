Game.registerMod("ascendAt1Trillion", {
    init: function () {
        const mod = this;

        // config vars
        mod.TARGET = 1e12; // Looking for 1 trillion (1,000,000,000,000) cookies in the bank
        mod.CLOSE_4_PHASE2 = 6e11; // begin controlled sell-down once bank ≥ 600b (keeps growth longer before taper)
        mod.PHASE3_ENTER_GAP = 1e8; // when within 100m of target, go farm-only (farms un-upgraded = controllable)
        mod.FINAL_CLICK_GAP = 2e4; // within 20k -> sell ALL and click only (fast finish ~3–5 min at ~100cps)
        mod.PRECISION_SLOW_GAP = 1e2; // within 100 go to single-click precision
        mod.OVERSHOOT_TOL = 0; // must be exactly target (DUH)
        mod.LOOP_MS = 200; // loop length

        // Phase-2 sub-tuning (keeps run fast without dumping CPS too early)
        mod.P2B_GAP = 1e9; // when gap ≤ 1b, switch to harder taper inside Phase 2
        mod.P2A_SELL_PCT = 0.10; // sell 10% of each non-Farm per pass
        mod.P2B_SELL_PCT = 0.25; // sell 25% of each non-Farm per pass
        mod.P2A_ROI_CAP = 60; // still buy in Phase 2A if ROI < 60s (keeps growth efficient)

        // State
        mod.active = false;
        mod.loop = null;
        mod.clickLoop = null;
        mod.lastAction = 'init';

        // Halo gloves detection (heavenly upgrade that makes clicks > 1 cookie)
        mod.haloGloves = false;

        // Debug Panel (F7 toggle)
        mod.debugEnabled = false;
        mod.debugPanel = null;
        mod.debugTimer = null;

        function beaut(n){ try { return Beautify(n); } catch { return (n||0).toLocaleString(); } }
        function phaseName(p){
            return p===1?'Growth'
                 : p===2?'Sell-down'
                 : p===3?'Farm-only trim'
                 : p===4?'Clicks only'
                 : p===5?'Overshoot fix'
                 : 'missingNo'; // hehe
        }

        function buildDebugPanel(){
            if (mod.debugPanel) return; // if the panel already exists, don't make it again
            const el = document.createElement('div');
            el.id = 'ascendAt1T-debug';
            el.style.position = 'fixed';
            el.style.top = '10px';
            el.style.right = '10px';
            el.style.zIndex = 999999;
            el.style.background = 'rgba(0,0,0,0.7)';
            el.style.color = '#fff';
            el.style.font = '12px/1.35 monospace';
            el.style.padding = '10px';
            el.style.border = '1px solid #666';
            el.style.borderRadius = '6px';
            el.style.minWidth = '260px';
            el.style.pointerEvents = 'none';
            el.innerHTML = '<b>Ascend@1T Debug</b><div id="ascendAt1T-debug-body"></div>';
            document.body.appendChild(el);
            mod.debugPanel = el;
        }

        function countBuildings(){
            let s=0; for (const o of Game.ObjectsById) s+=o.amount; return s;
        }

        // helper : current click size (after multipliers)
        function clickSize(){
            Game.CalculateGains();
            return Game.computedMouseCps || 1;
        }

        function updateDebugPanel(){
            if (!mod.debugPanel) return; // if the debug panel hasn't been init then don't update it
            const body = document.getElementById('ascendAt1T-debug-body');
            if(!body) return; // same logic as 2 lines above but for a different element
            const b = bank();
            const gap = mod.TARGET - b; // the delta of our current bank vs target
            const farms = Game.Objects['Farm'] ? Game.Objects['Farm'].amount : (Game.ObjectsById.find(o=>o.name==='Farm')||{amount:0}).amount;
            const p = currentPhase();
            body.innerHTML =
                'Phase: ' + phaseName(p) + '<br>' +
                'Bank:  ' + beaut(b) + '<br>' +
                'Gap:   ' + beaut(gap) + '<br>' +
                'CPS:   ' + beaut(cps()) + '<br>' +
                'Click: ' + beaut(clickSize()) + (mod.haloGloves ? ' (halo)' : '') + '<br>' +
                'Blds:  ' + countBuildings() + ' (Farms: '+farms+')<br>' +
                'Last:  ' + mod.lastAction;
        }

        function toggleDebug(){
            mod.debugEnabled = !mod.debugEnabled;
            if(mod.debugEnabled){
                buildDebugPanel();
                if (!mod.debugTimer) mod.debugTimer = setInterval(updateDebugPanel, 250);
                Game.Notify('Ascend@1T', 'Debug panel ON (F7 to hide)', [16,5]);
            } else {
                if (mod.debugTimer){ clearInterval(mod.debugTimer); mod.debugTimer=null; }
                if (mod.debugPanel){ mod.debugPanel.remove(); mod.debugPanel=null; }
                Game.Notify('Ascend@1T', 'Debug panel OFF', [16,5]);
            }
        }
        window.addEventListener('keydown', (e)=>{
            if (e.key === 'F7'){ toggleDebug(); }
        });

        // forbidden upgrades 
        // either too strong for precision to be possible or classified as an upgrade but not actually an upgrade (eg toggles)
        const FORBIDDEN_NAMES = new Set([
            // prestige-cps store line (too strong)
            "Heavenly chip secret","Heavenly cookie stand","Heavenly bakery","Heavenly confectionery","Heavenly key",
            // click doubling upgrades (flat click power)
            "Reinforced index finger","Carpal tunnel prevention cream","Ambidextrous",
            // farm line (keep farms weak for late control)
            "Cheap hoes","Fertilizer","Cookie trees","Genetically-modified cookies",
            // misc
            "egg","Sugar frenzy",
            // cosmetic/toggles commonly seen
            "Golden cookie sound selector","Classic milk selector","Fancy milk selector","Plain milk selector"
        ]);

        // allow-list helper : click upgrades that add "% of your CpS" are safe
        function isPctOfCpsClicker(u){
            const desc = (u && u.desc) ? u.desc.toLowerCase() : '';
            return /\b% of your cps\b/.test(desc);
        }

        function isForbiddenUpgrade(u){
            if (u.pool === 'prestige' || u.pool === 'toggle') return true;
            // allow safe clickers that scale with CpS (0 buildings => 0 bonus => precise)
            if (isPctOfCpsClicker(u)) return false;
            if (FORBIDDEN_NAMES.has(u.name)) return true;
            // block the entire "fingers" line (flat click power from buildings)
            if (/\bfingers\b/i.test(u.name)) return true;
            return false;
        }

        // Helper methods
        function bank(){ return Game.cookies; } // cookies in bank
        function cps(){ return Math.max(1, Game.cookiesPs); } // safe cps

        function clickBigCookie(n=1){
            // use engine API to avoid DOM flakiness
            for (let i=0;i<n;i++) Game.ClickCookie();
            mod.lastAction = 'click x'+n;
        }

        // ΔCps for buildings at current multipliers
        function buildingDeltaCps(obj){
            try{
                if (typeof obj.cps === 'function') return obj.cps(obj) || 0;
                return (obj.storedTotalCps || obj.storedCps || 0) || 0;
            }catch(e){
                return (obj.storedTotalCps || obj.storedCps || 0) || 0;
            }
        }

        // ΔCps for upgrades by simulating buy -> CalculateGains -> revert
        function upgradeDeltaCps(u){
            if (!u || u.bought) return 0;
            const base = cps();
            let delta = 0;
            const prev = u.bought;
            try{
                u.bought = 1;
                Game.CalculateGains();
                delta = Math.max(0, cps() - base);
            } finally {
                u.bought = prev;
                Game.CalculateGains();
            }
            return delta;
        }

        // ROI = wait + payback = max(cost - bank,0)/cps + cost/Δcps
        function roiForBuilding(obj){
            const cost = obj.getPrice();
            const wait = Math.max(cost - bank(), 0) / cps();
            const d = Math.max(1e-12, buildingDeltaCps(obj));
            return wait + cost / d;
        }
        function roiForUpgrade(u){
            const cost = u.getPrice();
            const wait = Math.max(cost - bank(), 0) / cps();
            const d = Math.max(1e-12, upgradeDeltaCps(u));
            return wait + cost / d;
        }

        // best investment by ROI (lower is better)
        function bestInvestment(){
            let best = null;
            let bestROI = Infinity;

            // Buildings
            for (const obj of Game.ObjectsById){
                const cost = obj.getPrice();
                if (cost > 0){
                    const roi = roiForBuilding(obj);
                    if (roi < bestROI){
                        bestROI = roi;
                        best = {type:'building', id:obj.id, name:obj.name, roi};
                    }
                }
            }

            // Upgrades
            const list = Game.UpgradesInStore.slice();
            for (const u of list){
                if (!u.unlocked || isForbiddenUpgrade(u)) continue;
                const cost = u.getPrice();
                if (cost <= 0) continue;
                const roi = roiForUpgrade(u);
                if (roi < bestROI){
                    bestROI = roi;
                    best = {type:'upgrade', upgrade:u, name:u.name, roi};
                }
            }

            return best;
        }

        // Selling utilities
        function sellAllOf(obj){
            if (!obj) return;
            let guard = 0;
            while (obj.amount>0 && guard<10000){
                obj.sell(1);
                guard++;
            }
        }
        function sellAllNonFarms(){
            for (const obj of Game.ObjectsById){
                if (obj.name!=="Farm" && obj.amount>0){
                    sellAllOf(obj);
                    mod.lastAction = 'sell ALL non-farms';
                }
            }
        }
        function sellAll(){
            for (const obj of Game.ObjectsById){
                if (obj.amount>0){ sellAllOf(obj); }
            }
            mod.lastAction = 'sell ALL';
        }
        function sellPercentOfEachNonFarm(pct){
            for (const obj of Game.ObjectsById){
                if (obj.name==="Farm") continue;
                if (obj.amount>0){
                    const toSell = Math.max(1, Math.ceil(obj.amount * pct));
                    let n = Math.min(toSell, obj.amount);
                    for (let i=0;i<n;i++) obj.sell(1);
                    mod.lastAction = 'sell ' + toSell + ' ' + obj.name + '(%)';
                }
            }
        }
        function totalBuildings(){
            let s=0; for (const o of Game.ObjectsById) s+=o.amount; return s;
        }

        // Overshoot correction: buy+sell Farm or Cursor (loses 75% of cost) to drop bank
        function correctOvershoot(){
            const farm = Game.Objects['Farm'] || Game.ObjectsById.find(o=>o.name==='Farm');
            const cursor = Game.Objects['Cursor'] || Game.ObjectsById.find(o=>o.name==='Cursor');
            let guard = 0;
            while (bank()>mod.TARGET && guard<500){
                const pick = (farm && bank()>=farm.getPrice()) ? farm :
                             (cursor && bank()>=cursor.getPrice()) ? cursor : null;
                if (!pick) break;
                pick.buy(1); pick.sell(1);
                guard++;
            }
            mod.lastAction = 'overshoot fix x'+guard;
        }

        // Phase detection based on *bank* (not total baked)
        function currentPhase(){
            const b = bank();
            const toTarget = mod.TARGET - b;

            if (b > mod.TARGET + mod.OVERSHOOT_TOL) return 5; // overshoot
            if (toTarget <= mod.FINAL_CLICK_GAP)   return 4; // click-only
            if (toTarget <= mod.PHASE3_ENTER_GAP)  return 3; // farm-only phase
            if (b >= mod.CLOSE_4_PHASE2)           return 2; // selling + throttle
            return 1; // growth
        }

        // Main control loop
        function loop(){
            const phase = currentPhase();

            // Phase 5 — Overshoot fix (we went past the target)
            if (phase === 5){
                correctOvershoot();
                return;
            }

            // Phase 4 — Clicks only (ensure absolute precision)
            if (phase === 4){
                // Make sure we have zero buildings for perfect control
                if (totalBuildings() > 0) sellAll();

                // Spin a dedicated click loop if not already running
                if (!mod.clickLoop){
                    mod.clickLoop = setInterval(()=>{
                        const b = bank();
                        const gap = mod.TARGET - b;

                        if (gap > mod.PRECISION_SLOW_GAP){
                            // still some distance: click faster but not insane
                            // 10 clicks per tick * 20 ticks/sec ≈ 200 cps
                            clickBigCookie(10);
                        } else if (gap > 0){
                            // really close: single clicks for precision
                            clickBigCookie(1);
                        } else if (gap === 0){
                            // nailed it: ascend, then reincarnate
                            clearInterval(mod.clickLoop); mod.clickLoop = null;
                            mod.lastAction = 'ASCEND';
                            Game.Ascend(1);
                            setTimeout(()=>{ Game.Reincarnate(1); }, 2000);
                        } else {
                            // we somehow crossed over between ticks: correct and retry
                            correctOvershoot();
                        }
                    }, 50);
                }
                return; // do not buy/sell in phase 4
            }

            // For phases 1–3, ensure the phase-4 click loop is off
            if (mod.clickLoop){ clearInterval(mod.clickLoop); mod.clickLoop = null; }

            // Phase 3 — Farm-only trim
            if (phase === 3){
                // Keep only farms; sell everything else outright (to zero)
                sellAllNonFarms();

                // keep making progress while trimming
                const toTarget = mod.TARGET - bank();
                if (toTarget > 1e7)      clickBigCookie(10);
                else if (toTarget > 1e6) clickBigCookie(5);
                else                     clickBigCookie(2);

                // When very close, trim farms one-by-one for finer control
                if (toTarget <= 1e6){
                    const farm = Game.Objects['Farm'];
                    if (farm && farm.amount>0){ farm.sell(1); mod.lastAction='sell 1 Farm'; }
                }
                // No buying here
                return;
            }

            // Phase 2 — Sell-down (gently reduce CPS in two sub-phases)
            if (phase === 2){
                const gap = mod.TARGET - bank();

                if (gap > mod.P2B_GAP){
                    // Phase 2A : keep growth healthy, start tapering
                    sellPercentOfEachNonFarm(mod.P2A_SELL_PCT);

                    // Optional buying if it's a slam-dunk ROI (< 60s)
                    const best = bestInvestment();
                    if (best && best.roi < mod.P2A_ROI_CAP && best.type==='building'){
                        Game.ObjectsById[best.id].buy(1);
                        mod.lastAction = 'buy building '+Game.ObjectsById[best.id].name+' (P2A ROI '+best.roi.toFixed(1)+'s)';
                    } else if (best && best.roi < mod.P2A_ROI_CAP && best.type==='upgrade'){
                        best.upgrade.buy();
                        mod.lastAction = 'buy upgrade '+best.name+' (P2A ROI '+best.roi.toFixed(1)+'s)';
                    }

                    // clicking keeps momentum
                    clickBigCookie(10);
                } else {
                    // Phase 2B : stronger taper, no more buying
                    sellPercentOfEachNonFarm(mod.P2B_SELL_PCT);

                    // lighter clicking to avoid spike overshoot later
                    if (gap > 5e8)      clickBigCookie(8);
                    else if (gap > 5e7) clickBigCookie(4);
                    else                clickBigCookie(2);
                }
                return;
            }

            // Phase 1 — Growth (choose best ROI purchase + active clicking)
            const best = bestInvestment();
            if (best){
                if (best.type === 'building'){
                    Game.ObjectsById[best.id].buy(1);
                    mod.lastAction = 'buy building ' + Game.ObjectsById[best.id].name +
                                    (best.roi != null ? ' (ROI ' + best.roi.toFixed(1) + 's)' : '');
                } else if (best.type === 'upgrade'){
                    best.upgrade.buy();
                    mod.lastAction = 'buy upgrade ' + best.name +
                                    (best.roi != null ? ' (ROI ' + best.roi.toFixed(1) + 's)' : '');
                }
            }

            // Keep the engine clicking during growth
            clickBigCookie(20);
        }

        // Bootstrapping
        function start(){
            if (mod.active) return;
            mod.active = true;
            if (mod.loop) clearInterval(mod.loop);
            mod.loop = setInterval(loop, mod.LOOP_MS);

            // detect Halo gloves and warn about Born again for exact 1-per-click precision
            mod.haloGloves = !!(Game.Has && Game.Has('Halo gloves'));
            if (mod.haloGloves){
                Game.Notify("AscendAt1Trillion",
                    "Halo gloves detected (clicks are stronger). For exact 1-cookie clicks in the final phase, use Born again mode.",
                    [16,5]);
            }

            Game.Notify("AscendAt1Trillion", "Automation running. (F7: debug)", [16,5]);
        }
        function stop(){
            mod.active = false;
            if (mod.loop){clearInterval(mod.loop); mod.loop=null;}
            if (mod.clickLoop){clearInterval(mod.clickLoop); mod.clickLoop=null;}
        }

        // Start after reincarnate or on load
        Game.registerHook("reincarnate", ()=>{
            setTimeout(start, 1500);
        });
        // Start if game is already running (fresh load)
        setTimeout(start, 1500);

        // Optional manual control:
        // window.addEventListener('keydown',(e)=>{ if(e.key==='F8') start(); if(e.key==='F9') stop(); });
    },

    save:function(){ return ""; },
    load:function(str){}
});
