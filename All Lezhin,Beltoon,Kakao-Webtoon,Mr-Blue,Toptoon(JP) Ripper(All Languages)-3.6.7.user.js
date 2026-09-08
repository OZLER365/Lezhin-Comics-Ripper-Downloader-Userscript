// ==UserScript==
// @name         All Lezhin,Beltoon,Kakao-Webtoon,Mr-Blue,Toptoon(JP) Ripper(All Languages)
// @namespace    https://greasyfork.org/en/users/1553223-ozler365
// @version      3.6.7
// @description  Fetches Images through Blob Hook, No Canvas Descrambling Needed, Used DOM for Page Ordering
// @author       ozler365
// @license      MIT
// @match        https://*.lezhinus.com/*
// @match        https://*.lezhin.com/*
// @match        https://*.lezhin.es/*
// @match        https://*.lezhin.jp/*
// @match        https://*.lezhinde.com/*
// @match        https://*.lezhinfr.com/*
// @match        https://*.lezhinth.com/*
// @match        https://*.beltoon.jp/*
// @match        https://*.bomtoon.com/*
// @match        https://*.bomtoon.tw/*
// @match        https://webtoon.kakao.com/*
// @match        https://www.toptoon.jp/*
// @match        https://viewer.mrblue.com/*
// @match        https://m.mrblue.com/*
// @icon         https://play-lh.googleusercontent.com/5j1P3NokKSTW5dZUWN8V7dYfjUSYkaSObLyF8h3nXIQKZr8pkMfJELLymQc9ATELPva4mJsnWFOIVvnoe0_DlQ
// @run-at       document-start
// @grant        unsafeWindow
// @grant        GM_download
// @downloadURL https://update.greasyfork.org/scripts/563063/All%20Lezhin%2CBeltoon%2CKakao-Webtoon%2CMr-Blue%2CToptoon%28JP%29%20Ripper%28All%20Languages%29.user.js
// @updateURL https://update.greasyfork.org/scripts/563063/All%20Lezhin%2CBeltoon%2CKakao-Webtoon%2CMr-Blue%2CToptoon%28JP%29%20Ripper%28All%20Languages%29.meta.js
// ==/UserScript==

(function() {
    'use strict';

    const targetWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    const STORAGE_KEY_AUTO_DL = 'lz_auto_download_enabled';

    const state = {
        urlToBlob: new Map(),
        pageRegistry: new Map(),
        seenHashes: new Set(),
        isAutoScrolling: false,
        isDownloading: false,
        autoDownload: localStorage.getItem(STORAGE_KEY_AUTO_DL) !== 'false',
        currentHref: window.location.href,
        cachedFolderName: null,
        cachedProgressEl: null
    };

    function setStatus(msg, isError = false) {
        const statusEl = document.getElementById('lz-status');
        if (!statusEl) return;
        if (!msg) {
            statusEl.style.display = 'none';
            return;
        }
        statusEl.style.display = 'block';
        statusEl.style.color = isError ? '#ff4c4c' : '#00e676';
        statusEl.innerText = msg;
    }

    function getFolderName() {
        if (state.cachedFolderName) return state.cachedFolderName;
        let name = document.title.split('|')[0].trim();
        state.cachedFolderName = name.replace(/[<>:"/\\|?*]/g, "").trim() || "Chapter_Download";
        return state.cachedFolderName;
    }

    function resetState() {
        state.urlToBlob.clear();
        state.pageRegistry.clear();
        state.seenHashes.clear();
        state.isAutoScrolling = false;
        state.isDownloading = false;
        state.cachedFolderName = null;
        state.cachedProgressEl = null;

        const mainBtn = document.getElementById('lz-main-btn');
        if (mainBtn) {
            mainBtn.innerText = "Start Auto-Capture";
            mainBtn.style.background = "#e60012";
            mainBtn.disabled = false;
        }
        setStatus('');
        updateUI();
    }

    // --- 1. Total Image Detection ---
    function getTotalPanels() {
        const cuts = document.querySelectorAll('[data-cut-index]');
        if (cuts.length > 0) return cuts.length;

        const regex = /^(\d+)\s*\/\s*(\d+)$/;
        if (state.cachedProgressEl && state.cachedProgressEl.offsetParent !== null) {
            const match = state.cachedProgressEl.innerText.trim().match(regex);
            if (match) return parseInt(match[2], 10);
        }

        const elements = document.querySelectorAll('div, span, p, button');
        for (let i = 0; i < elements.length; i++) {
            if (elements[i].offsetParent === null) continue;
            const match = elements[i].innerText.trim().match(regex);
            if (match) {
                state.cachedProgressEl = elements[i];
                return parseInt(match[2], 10);
            }
        }
        return null;
    }

    // --- 2. Cryptographic Hashing ---
    async function computeSHA256(blob) {
        const buffer = await blob.arrayBuffer();
        const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    // --- 3. The Hybrid Hook (Handles Beltoon/Bomtoon & Blobs) ---
    const originalCreateObjectURL = targetWindow.URL.createObjectURL;
    targetWindow.URL.createObjectURL = function(blob) {
        const url = originalCreateObjectURL.apply(this, arguments);

        if (state.isDownloading) return url;

        try {
            if (blob instanceof Blob) {
                state.urlToBlob.set(url, blob);

                if (document.querySelectorAll('[data-cut-index]').length === 0) {
                    const total = getTotalPanels();
                    if (total && state.pageRegistry.size >= total) return url;

                    computeSHA256(blob).then(hash => {
                        if (!state.seenHashes.has(hash)) {
                            state.seenHashes.add(hash);

                            const pageNum = state.pageRegistry.size + 1;
                            if (total && pageNum > total) return;

                            state.pageRegistry.set(pageNum, {
                                url: url,
                                isBlob: true,
                                blob: blob
                            });
                        }
                    });
                }
            }
        } catch (e) {}
        return url;
    };

    // --- 4. DOM Cut-Index Scanner (Handles Lezhin) ---
    function syncPagesWithDOM() {
        if (state.isDownloading) return; 

        const cuts = document.querySelectorAll('[data-cut-index]');
        if (cuts.length > 0) {
            const hasZero = document.querySelector('[data-cut-index="0"]') !== null;
            let needsUIUpdate = false;

            for (let i = 0; i < cuts.length; i++) {
                const cut = cuts[i];
                const rawIndex = parseInt(cut.getAttribute('data-cut-index'), 10);
                if (isNaN(rawIndex)) continue;

                const pageNum = hasZero ? rawIndex + 1 : rawIndex;

                if (!state.pageRegistry.has(pageNum)) {
                    const img = cut.querySelector('img');
                    if (img && img.src && (img.src.startsWith('http') || img.src.startsWith('blob:'))) {
                        const isBlob = img.src.startsWith('blob:');
                        state.pageRegistry.set(pageNum, {
                            url: img.src,
                            isBlob: isBlob,
                            blob: isBlob ? state.urlToBlob.get(img.src) : null
                        });
                        needsUIUpdate = true;
                    }
                }
            }
            if (needsUIUpdate) updateUI();
        } else {
            updateUI();
        }
    }

    // --- 5. Container Selectors ---
    function getPageContainers() {
        const selectors = [
            '[data-cut-index]',
            '.scroll-view > [data-cut-index]',
            'div[class^="ImageContainer__Container-"]',
            'div[class^="sc-"][width][height]',
            'div[class^="scrollViewCut__"]',
            'div[class^="VerticalViewer_page_container"]'
        ];
        for (const selector of selectors) {
            const nodes = document.querySelectorAll(selector);
            if (nodes.length > 0) return nodes;
        }
        return [];
    }

    // --- 6. Unified Flow: Smart Auto-Scroll (Dynamic Blob Loading) ---
    async function smartAutoScroll() {
        state.isAutoScrolling = true;
        setStatus('');
        const mainBtn = document.getElementById('lz-main-btn');
        mainBtn.innerText = "Stop Auto-Scroll";
        mainBtn.style.background = "#f0ad4e";

        const speed = parseInt(document.getElementById('lz-speed').value, 10);
        const containers = getPageContainers();

        if (containers.length > 0) {
            for (let i = 0; i < containers.length; i++) {
                if (!state.isAutoScrolling) break;
                const cut = containers[i];
                cut.scrollIntoView({ behavior: 'smooth', block: 'center' });

                await new Promise(resolve => {
                    const start = performance.now();
                    function check() {
                        if (!state.isAutoScrolling) return resolve();
                        const img = cut.querySelector('img');
                        
                        if (img && img.src) {
                            const isBlob = img.src.startsWith('blob:');
                            const isHttp = img.src.startsWith('http');
                            
                            // Core change: Wait until the img element has a valid blob/http source, 
                            // is completely rendered, and is wider than a 50px placeholder.
                            if ((isBlob || isHttp) && img.complete && img.naturalWidth > 50) {
                                return resolve(); 
                            }
                        }
                        
                        // Extended wait period: allows up to 15 seconds for slow blob generation
                        if (performance.now() - start > 15000) {
                            console.warn("Auto-scroll timeout on panel", i);
                            return resolve();
                        }
                        requestAnimationFrame(check);
                    }
                    check();
                });

                // Applies the user's slider speed only after the blob is fully loaded
                let waited = 0;
                while (waited < speed && state.isAutoScrolling) {
                    await new Promise(r => setTimeout(r, 50));
                    waited += 50;
                }
                syncPagesWithDOM();
            }
        } else {
            // Viewport Fallback remains untouched
            while (state.isAutoScrolling) {
                const scrollHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
                const currentScroll = window.scrollY + window.innerHeight;

                if (currentScroll >= scrollHeight - 50) {
                    await new Promise(r => setTimeout(r, 1500));
                    const newScrollHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
                    if (newScrollHeight <= scrollHeight) break;
                }

                window.scrollBy({ top: window.innerHeight * 0.6, behavior: 'smooth' });

                let waited = 0;
                while (waited < speed && state.isAutoScrolling) {
                    await new Promise(r => setTimeout(r, 50));
                    waited += 50;
                }
                syncPagesWithDOM();
            }
        }

        if (state.isAutoScrolling) {
            state.isAutoScrolling = false;
            syncPagesWithDOM();

            if (state.autoDownload) {
                mainBtn.innerText = "Auto-Downloading...";
                mainBtn.style.background = "#2563eb";
                downloadToFolder();
            } else {
                mainBtn.innerText = "Download Folder";
                mainBtn.style.background = "#2563eb";
                setStatus('All panels captured! Click to download.', false);
            }
        }
    }

    // --- 7. Lossless PNG Conversion ---
    async function convertToPngBlob(sourceItem) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            let objectUrl = null;

            if (sourceItem.isBlob && sourceItem.blob) {
                objectUrl = URL.createObjectURL(sourceItem.blob);
                img.src = objectUrl;
            } else {
                img.src = sourceItem.url;
            }

            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth;
                canvas.height = img.naturalHeight;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);

                if (objectUrl) URL.revokeObjectURL(objectUrl);

                canvas.toBlob(pngBlob => {
                    if (pngBlob) resolve(pngBlob);
                    else reject(new Error("Canvas export failed"));
                }, 'image/png');
            };

            img.onerror = () => {
                if (objectUrl) URL.revokeObjectURL(objectUrl);
                if (sourceItem.blob) resolve(sourceItem.blob);
                else reject(new Error("Failed to load image for PNG conversion"));
            };
        });
    }

    // --- 8. Pure Direct Downloader (PNG Enforcement) ---
    async function downloadToFolder() {
        if (state.isDownloading) return;
        state.isDownloading = true; 

        const mainBtn = document.getElementById('lz-main-btn');
        syncPagesWithDOM();

        if (state.pageRegistry.size === 0) {
            setStatus('No panels captured yet!', true);
            state.isDownloading = false;
            mainBtn.innerText = "Start Auto-Capture";
            mainBtn.style.background = "#e60012";
            return;
        }

        setStatus('Converting to PNG & saving...', false);
        mainBtn.innerText = "Saving PNGs...";
        mainBtn.disabled = true;
        const cleanTitle = getFolderName();

        const sortedPages = Array.from(state.pageRegistry.entries()).sort((a, b) => a[0] - b[0]);
        const pad = Math.max(String(sortedPages[sortedPages.length - 1][0]).length, 3);

        for (const [pageNum, item] of sortedPages) {
            const filename = `Panel_${String(pageNum).padStart(pad, '0')}.png`;
            const fullPath = `${cleanTitle}/${filename}`;

            try {
                const pngBlob = await convertToPngBlob(item);
                const tempUrl = URL.createObjectURL(pngBlob);

                GM_download({
                    url: tempUrl,
                    name: fullPath,
                    saveAs: false,
                    onload: () => URL.revokeObjectURL(tempUrl),
                    onerror: () => URL.revokeObjectURL(tempUrl)
                });
            } catch (err) {
                GM_download({
                    url: item.url,
                    name: fullPath,
                    saveAs: false,
                    onerror: (e) => console.error(`Error downloading ${filename}:`, e)
                });
            }

            await new Promise(r => setTimeout(r, 100));
        }

        mainBtn.innerText = "Done!";
        setStatus('Download initiated successfully!', false);
        setTimeout(() => {
            mainBtn.innerText = "Start Auto-Capture";
            mainBtn.style.background = "#e60012";
            mainBtn.disabled = false;
            state.isDownloading = false;
            setStatus('');
        }, 3000);
    }

    function handleMainButtonClick() {
        if (state.isDownloading) return;

        if (state.isAutoScrolling) {
            state.isAutoScrolling = false;
            const mainBtn = document.getElementById('lz-main-btn');
            mainBtn.innerText = "Start Auto-Capture";
            mainBtn.style.background = "#e60012";
            return;
        }

        const mainBtn = document.getElementById('lz-main-btn');
        if (mainBtn.innerText === "Download Folder") {
            downloadToFolder();
        } else {
            smartAutoScroll();
        }
    }

    // --- 9. Unified Background Tick Loop ---
    function updateUI() {
        const countEl = document.getElementById('lz-count');
        const totalEl = document.getElementById('lz-total');
        if (countEl) countEl.innerText = state.pageRegistry.size;

        const total = getTotalPanels();
        if (totalEl && total) {
            totalEl.innerText = `/ ${total}`;
        }
    }

    setInterval(() => {
        if (window.location.href !== state.currentHref) {
            state.currentHref = window.location.href;
            resetState();
        }
        syncPagesWithDOM();
    }, 400);

    // --- 10. Professional Movable & Minimizable UI ---
    window.addEventListener('DOMContentLoaded', () => {
        const style = document.createElement('style');
        style.textContent = `
            #lz-modal {
                position: fixed;
                top: 15%;
                right: 20px;
                z-index: 999999;
                background: #141416;
                color: #ffffff;
                padding: 14px;
                border-radius: 12px;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                box-shadow: 0 10px 30px rgba(0,0,0,0.7), 0 0 1px rgba(255,255,255,0.2);
                width: 230px;
                border: 1px solid #27272a;
                user-select: none;
            }
            #lz-header {
                cursor: grab;
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding-bottom: 10px;
                border-bottom: 1px solid #27272a;
                margin-bottom: 12px;
            }
            #lz-header:active {
                cursor: grabbing;
            }
            .lz-title {
                font-size: 11px;
                font-weight: 700;
                letter-spacing: 0.8px;
                color: #e4e4e7;
            }
            .lz-min-btn {
                background: transparent;
                border: none;
                color: #a1a1aa;
                cursor: pointer;
                font-size: 16px;
                line-height: 1;
                padding: 0 4px;
            }
            .lz-min-btn:hover {
                color: #ffffff;
            }
            #lz-speed {
                -webkit-appearance: none !important;
                appearance: none !important;
                accent-color: #e60012 !important;
                width: 100% !important;
                background: transparent !important;
                margin: 6px 0 !important;
                cursor: pointer !important;
            }
            #lz-speed::-webkit-slider-runnable-track {
                width: 100% !important;
                height: 5px !important;
                background: #e60012 !important;
                border-radius: 3px !important;
            }
            #lz-speed::-webkit-slider-thumb {
                -webkit-appearance: none !important;
                height: 15px !important;
                width: 15px !important;
                border-radius: 50% !important;
                background: #ffffff !important;
                margin-top: -5px !important;
                box-shadow: 0 0 4px rgba(0,0,0,0.6) !important;
            }
            #lz-speed::-moz-range-track {
                width: 100% !important;
                height: 5px !important;
                background: #e60012 !important;
                border-radius: 3px !important;
            }
            #lz-speed::-moz-range-thumb {
                height: 15px !important;
                width: 15px !important;
                border: none !important;
                border-radius: 50% !important;
                background: #ffffff !important;
            }
            .lz-toggle-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                margin-bottom: 12px;
                font-size: 11px;
                color: #d4d4d8;
            }
            .lz-switch {
                position: relative;
                display: inline-block;
                width: 32px;
                height: 18px;
            }
            .lz-switch input {
                opacity: 0;
                width: 0;
                height: 0;
            }
            .lz-slider {
                position: absolute;
                cursor: pointer;
                top: 0; left: 0; right: 0; bottom: 0;
                background-color: #3f3f46;
                transition: .2s;
                border-radius: 18px;
            }
            .lz-slider:before {
                position: absolute;
                content: "";
                height: 12px;
                width: 12px;
                left: 3px;
                bottom: 3px;
                background-color: white;
                transition: .2s;
                border-radius: 50%;
            }
            input:checked + .lz-slider {
                background-color: #00e676;
            }
            input:checked + .lz-slider:before {
                transform: translateX(14px);
            }
            .lz-support-link {
                color: #f0ad4e;
                text-decoration: none;
                font-size: 10px;
                display: block;
                margin-top: 8px;
                text-align: center;
            }
            .lz-support-link:hover {
                color: #ffffff;
            }
        `;
        document.head.appendChild(style);

        const ui = document.createElement('div');
        ui.id = 'lz-modal';
        ui.innerHTML = `
            <div id="lz-header">
                <span class="lz-title">MANGA RIPPER</span>
                <button class="lz-min-btn" id="lz-toggle-min">−</button>
            </div>
            <div id="lz-body">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; background: #202024; padding: 8px 10px; border-radius: 6px;">
                    <span style="font-size: 13px; font-weight: 600; color: #00e676;">Captured: <span id="lz-count">0</span> <span id="lz-total" style="color:#71717a; font-size:12px;"></span></span>
                </div>
                <div style="margin-bottom: 10px;">
                    <label style="font-size: 10px; color: #a1a1aa; display: block; margin-bottom: 3px;" id="lz-speed-lbl">Scroll Delay: 50ms</label>
                    <input type="range" id="lz-speed" min="50" max="3000" step="50" value="50">
                </div>
                <div class="lz-toggle-row">
                    <span>Auto-Download</span>
                    <label class="lz-switch">
                        <input type="checkbox" id="lz-auto-dl-toggle" ${state.autoDownload ? 'checked' : ''}>
                        <span class="lz-slider"></span>
                    </label>
                </div>
                <div id="lz-status" style="font-size: 11px; font-weight: 600; margin-bottom: 8px; text-align: center; display: none; line-height: 1.2;"></div>
                
                <button id="lz-main-btn" style="width: 100%; padding: 10px; background: #e60012; color: white; border: none; border-radius: 6px; font-size: 12px; font-weight: 700; cursor: pointer; transition: background 0.2s; margin-bottom: 8px;">Start Auto-Capture</button>
                <button id="lz-dedicated-dl-btn" style="width: 100%; padding: 10px; background: #2563eb; color: white; border: none; border-radius: 6px; font-size: 12px; font-weight: 700; cursor: pointer; transition: background 0.2s;">Download Captured</button>
                
                <a href="https://www.buymeacoffee.com/ozler" target="_blank" class="lz-support-link">☕ Support the Developer</a>
            </div>
        `;
        document.body.appendChild(ui);

        const bodyEl = document.getElementById('lz-body');
        const minBtn = document.getElementById('lz-toggle-min');
        let isMinimized = false;
        minBtn.onclick = () => {
            isMinimized = !isMinimized;
            bodyEl.style.display = isMinimized ? 'none' : 'block';
            minBtn.innerText = isMinimized ? '+' : '−';
            ui.style.width = isMinimized ? '130px' : '230px';
        };

        const headerEl = document.getElementById('lz-header');
        let isDragging = false, startX, startY, initLeft, initTop;

        headerEl.addEventListener('mousedown', (e) => {
            if (e.target === minBtn) return;
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            const rect = ui.getBoundingClientRect();
            initLeft = rect.left;
            initTop = rect.top;
            ui.style.right = 'auto';
            ui.style.left = `${initLeft}px`;
            ui.style.top = `${initTop}px`;
        });

        window.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            ui.style.left = `${initLeft + (e.clientX - startX)}px`;
            ui.style.top = `${initTop + (e.clientY - startY)}px`;
        });

        window.addEventListener('mouseup', () => { isDragging = false; });

        document.getElementById('lz-main-btn').onclick = handleMainButtonClick;
        
        document.getElementById('lz-dedicated-dl-btn').onclick = downloadToFolder;

        const toggleAuto = document.getElementById('lz-auto-dl-toggle');
        toggleAuto.onchange = (e) => {
            state.autoDownload = e.target.checked;
            localStorage.setItem(STORAGE_KEY_AUTO_DL, String(state.autoDownload));
        };

        const speedSlider = document.getElementById('lz-speed');
        const speedLbl = document.getElementById('lz-speed-lbl');
        speedSlider.oninput = (e) => { speedLbl.innerText = `Scroll Delay: ${e.target.value}ms`; };
    });
})();