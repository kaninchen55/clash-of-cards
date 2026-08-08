import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import { getFirestore, collection, getDocs, doc, getDoc, updateDoc, increment, setDoc, deleteDoc, FieldPath, runTransaction } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyCWBJOe4a27Qh2HCDwUaS1TbpAoSevIqg8",
    authDomain: "coc-clash-of-cards.firebaseapp.com",
    projectId: "coc-clash-of-cards",
    storageBucket: "coc-clash-of-cards.firebasestorage.app",
    messagingSenderId: "353299740955",
    appId: "1:353299740955:web:1a9bae00391cd265d7fbbe"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

let CLAN_NAME = "";
let CURRENT_ACCOUNT = "";
let VIEW_ACCOUNT = "";
let CARD_DATA = {};
let TRADING_MODE = false;
let TRADES = [];

let SESSION = JSON.parse(localStorage.getItem("clashSession")) || {
    clans: [],
    accounts: {},
    activeClan: "",
    activeAccount: ""
};

let PRIORITIES = JSON.parse(localStorage.getItem("clashPriorities")) || {};

function saveSession() {
    localStorage.setItem("clashSession", JSON.stringify(SESSION));
}

function savePriorities() {
    localStorage.setItem("clashPriorities", JSON.stringify(PRIORITIES));
}

const CARDS = {
    "Elixir Troops": [
        "Barbarian", "Archer", "Giant", "Goblin", "Wall Breaker", "Balloon",
        "Wizard", "Healer", "Dragon", "P.E.K.K.A", "Baby Dragon", "Miner",
        "Electro Dragon", "Yeti", "Dragon Rider", "Electro Titan", "Root Rider",
        "Thrower", "Meteor Golem"
    ],
    "Dark Elixir Troops": [
        "Minion", "Hog Rider", "Valkyrie", "Golem", "Witch", "Lava Hound",
        "Bowler", "Ice Golem", "Headhunter", "Apprentice Warden", "Druid",
        "Furnace", "Ruin Witch"
    ],
    "Builder Base Troops": [
        "Raged Barbarian", "Sneaky Archer", "Boxer Giant", "Beta Minion",
        "Bomber", "Builder Baby Dragon", "Cannon Cart", "Night Witch",
        "Drop Ship", "Power P.E.K.K.A", "Hog Glider"
    ],
    "Super Troops": [
        "Super Barbarian", "Super Archer", "Super Giant", "Sneaky Goblin",
        "Super Wall Breaker", "Rocket Balloon", "Super Wizard", "Super Dragon",
        "Inferno Dragon", "Super Miner", "Super Yeti", "Super Minion",
        "Super Hog Rider", "Super Valkyrie", "Super Witch", "Ice Hound",
        "Super Bowler"
    ]
};

const ALL_CARDS = Object.values(CARDS).flat();

const DISPLAY_NAMES = {
    "Builder Baby Dragon": "Baby Dragon"
};

function priorityKey(clan, account) {
    return `${clan}/${account}`;
}

function isPriority(account) {
    return !!PRIORITIES[priorityKey(CLAN_NAME, account)];
}

function togglePriority(account) {
    const key = priorityKey(CLAN_NAME, account);

    if (PRIORITIES[key])
        delete PRIORITIES[key];
    else
        PRIORITIES[key] = true;

    savePriorities();
    renderAccounts();
    renderMembers();

    if (TRADING_MODE)
        renderTrading();

    // animate the toggled member briefly
    try {
        const members = document.querySelectorAll('#sidebar .member');
        for (const m of members) {
            if (m.dataset.account === account) {
                m.classList.add('priority-anim');
                m.addEventListener('animationend', () => m.classList.remove('priority-anim'), { once: true });
                break;
            }
        }
    } catch (e) {
        // ignore when DOM not ready
    }
}

async function loadCardData() {
    const response = await fetch("./coc_cards.json");

    if (!response.ok)
        throw new Error("Could not load coc_cards.json");

    CARD_DATA = await response.json();
}

async function initializePlayerCards(player) {
    const ref = doc(db, "clans", CLAN_NAME, "players", player);
    const snap = await getDoc(ref);

    const cards = snap.exists() ? snap.data().cards || {} : {};
    let changed = false;

    ALL_CARDS.forEach(card => {
        if (cards[card] === undefined) {
            cards[card] = 0;
            changed = true;
        }
    });

    if (!snap.exists() || changed)
        await setDoc(ref, { cards }, { merge: true });
}

window.changeCard = async function(player, card, amount) {
    if (!isLoggedInAccount(CLAN_NAME, player))
        return;

    const id = `${player}-${card.replace(/\s+/g, "-")}`;
    const element = document.getElementById(id);

    if (!element)
        return;

    const oldValue = Number(element.textContent) || 0;
    const value = Math.max(0, oldValue + amount);

    if (value === oldValue)
        return;

    element.textContent = value;
    element.classList.toggle("more-than-one", value > 1);

    const cardElement = document.getElementById(
        `card-${player}-${card.replace(/\s+/g, "-")}`
    );

    if (cardElement)
        cardElement.classList.toggle("empty", value === 0);

    const ref = doc(
        db,
        "clans",
        CLAN_NAME,
        "players",
        player
    );

    try {
        await updateDoc(
            ref,
            new FieldPath("cards", card),
            increment(amount)
        );
    } catch (error) {
        element.textContent = oldValue;
        element.classList.toggle("more-than-one", oldValue > 1);

        if (cardElement)
            cardElement.classList.toggle("empty", oldValue === 0);

        console.error(error);
        alert("Failed to update card.");
        return;
    }

    let category = "";

    for (const [cat, cards] of Object.entries(CARDS)) {
        if (cards.includes(card)) {
            category = cat;
            break;
        }
    }

    if (!category)
        return;

    const categoryId = category.replace(/\s+/g, "-");

    const uniqueElement = document.getElementById(
        `${player}-${categoryId}-unique`
    );

    if (!uniqueElement)
        return;

    let unique = 0;

    CARDS[category].forEach(c => {
        const el = document.getElementById(
            `${player}-${c.replace(/\s+/g, "-")}`
        );

        if (el && Number(el.textContent) > 0)
            unique++;
    });

    uniqueElement.textContent =
        `${unique}/${CARDS[category].length}`;

    const check =
        uniqueElement.parentElement.querySelector(".check");

    if (check)
        check.textContent =
            unique === CARDS[category].length ? "✓" : "";
};

function tabClass(category) {
    switch (category) {
        case "Elixir Troops":
            return "tab-elixir";
        case "Dark Elixir Troops":
            return "tab-dark";
        case "Builder Base Troops":
            return "tab-builder";
        case "Super Troops":
            return "tab-super";
        default:
            return "";
    }
}

async function loadPlayers() {
    const player = VIEW_ACCOUNT || CURRENT_ACCOUNT;

    if (!CLAN_NAME || !player)
        return;

    const snapshot = await getDoc(
        doc(db, "clans", CLAN_NAME, "players", player)
    );

    if (!snapshot.exists())
        return;

    const data = snapshot.data();
    const editable = isLoggedInAccount(CLAN_NAME, player);

    let html = `
        <div class="event-window">
            <div class="event-header">
                <div class="event-title">Clash of Cards</div>

                <div class="header-player">
                    <div class="player-name">${escapeHtml(player)}</div>

                    ${editable ? `
                        <button
                            class="delete-account"
                            onclick="deleteCurrentAccount()"
                            title="Delete account"
                        >🗑</button>
                    ` : ""}
                </div>
            </div>

            <div class="event-body">
                <div class="category-counters">
    `;

    Object.entries(CARDS).forEach(([category, cards]) => {
        const unique = cards.filter(
            c => (data.cards?.[c] || 0) > 0
        ).length;

        html += `
            <div class="category-counter ${tabClass(category)}">
                <div class="counter-title">
                    ${category.replace(" Troops", " Cards")}
                </div>

                <span
                    class="counter-value"
                    id="${safeId(player)}-${category.replace(/\s+/g, "-")}-unique"
                >${unique}/${cards.length}</span>

                <span class="check">
                    ${unique === cards.length ? "✓" : ""}
                </span>
            </div>
        `;
    });

    html += `
                </div>

                <div class="cards">
    `;

    Object.entries(CARDS).forEach(([category, cards]) => {
        cards.forEach(card => {
            const amount = data.cards?.[card] || 0;
            const displayName = DISPLAY_NAMES[card] || card;
            const image =
                CARD_DATA[displayName]?.image ||
                CARD_DATA[card]?.image ||
                "";

            const id = card.replace(/\s+/g, "-");
            const playerId = safeId(player);

            html += `
                <div
                    class="card ${tabClass(category)} ${amount === 0 ? "empty" : ""}"
                    id="card-${playerId}-${id}"
                >
                    <div
                        class="card-frame"
                        ${editable
                            ? `onclick="changeCard('${escapeAttribute(player)}','${escapeAttribute(card)}',1)"`
                            : ""}
                    >
                        <img
                            src="${escapeAttribute(image)}"
                            alt="${escapeAttribute(displayName)}"
                        >
                    </div>

                    <div class="card-name">
                        ${escapeHtml(displayName)}
                    </div>

                    <div class="counter">
                        ${editable ? `
                            <button
                                class="minus"
                                onclick="changeCard('${escapeAttribute(player)}','${escapeAttribute(card)}',-1)"
                            >−</button>
                        ` : ""}

                        <span
                            class="count ${amount > 1 ? "more-than-one" : ""}"
                            id="${playerId}-${id}"
                        >${amount}</span>

                        ${editable ? `
                            <button
                                class="plus"
                                onclick="changeCard('${escapeAttribute(player)}','${escapeAttribute(card)}',1)"
                            >+</button>
                        ` : ""}
                    </div>
                </div>
            `;
        });
    });

    html += `
                </div>
            </div>
        </div>
    `;

    document.getElementById("players").innerHTML = html;
}

async function renderMembers() {
    const box = document.getElementById("memberList");

    box.innerHTML = "";

    if (!CLAN_NAME)
        return;

    const snap = await getDocs(
        collection(db, "clans", CLAN_NAME, "players")
    );

    const members = snap.docs
        .map(p => p.id)
        .sort((a, b) => {
            // priority entries first, then ascending name
            const pa = isPriority(a) ? 0 : 1;
            const pb = isPriority(b) ? 0 : 1;

            if (pa !== pb)
                return pa - pb;

            return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
        });

    members.forEach(name => {
        const div = document.createElement("div");
        div.className = "member";
        // allow selecting this element by account name for animations
        div.dataset.account = name;

        if (name === VIEW_ACCOUNT)
            div.classList.add("active");

        if (isLoggedInAccount(CLAN_NAME, name))
            div.classList.add("logged-in");

        const label = document.createElement("span");
        label.className = "member-name";
        label.textContent = name;

        const star = document.createElement("button");
        star.className = "member-star";
        star.textContent =
            isPriority(name) ? "★" : "☆";

        star.title =
            isPriority(name)
                ? "Remove trading priority"
                : "Set trading priority";

        star.onclick = event => {
            event.stopPropagation();
            togglePriority(name);
        };

        div.appendChild(label);
        div.appendChild(star);

        div.onclick = async () => {
            VIEW_ACCOUNT = name;
            TRADING_MODE = false;

            await loadPlayers();

            renderAccounts();
            renderMembers();
        };

        box.appendChild(div);
    });
}

function renderAccounts() {
    const box = document.getElementById("accountList");

    box.innerHTML = "";

    Object.entries(SESSION.accounts).forEach(
        ([clan, accounts]) => {

            accounts.forEach(account => {
                const row = document.createElement("div");

                row.className = "account";
                row.draggable = true;
                row.dataset.clan = clan;
                row.dataset.account = account;

                if (
                    clan === CLAN_NAME &&
                    account === VIEW_ACCOUNT
                )
                    row.classList.add("active");

                const name = document.createElement("span");

                name.textContent =
                    clan +
                    "/" +
                    account +
                    (
                        PRIORITIES[
                            priorityKey(clan, account)
                        ]
                            ? " ★"
                            : ""
                    );

                name.style.flex = "1";
                name.style.cursor = "pointer";

                name.onclick = async () => {
                    await loadClan(clan);
                    await loadAccount(account);
                };

                const remove = document.createElement("button");

                remove.className = "removeAccount";
                remove.textContent = "-";

                remove.onclick = event => {
                    event.stopPropagation();

                    SESSION.accounts[clan] =
                        SESSION.accounts[clan]
                            .filter(a => a !== account);

                    if (
                        SESSION.accounts[clan].length === 0
                    ) {
                        delete SESSION.accounts[clan];

                        SESSION.clans =
                            SESSION.clans.filter(
                                c => c !== clan
                            );
                    }

                    if (
                        CLAN_NAME === clan &&
                        CURRENT_ACCOUNT === account
                    ) {
                        CURRENT_ACCOUNT = "";
                        SESSION.activeAccount = "";
                        VIEW_ACCOUNT = "";

                        document.getElementById(
                            "players"
                        ).innerHTML = "Select account";
                    }

                    saveSession();
                    renderAccounts();
                    renderMembers();
                };

                row.appendChild(name);
                row.appendChild(remove);

                box.appendChild(row);

                row.addEventListener(
                    "dragstart",
                    event => {
                        event.dataTransfer.setData(
                            "text/plain",
                            `${clan}|${account}`
                        );

                        row.classList.add("dragging");
                    }
                );

                row.addEventListener(
                    "dragend",
                    () => {
                        row.classList.remove("dragging");
                    }
                );

                row.addEventListener(
                    "dragover",
                    event => {
                        event.preventDefault();

                        const dragging =
                            box.querySelector(".dragging");

                        if (
                            !dragging ||
                            dragging === row
                        )
                            return;

                        const rect =
                            row.getBoundingClientRect();

                        const after =
                            event.clientY >
                            rect.top +
                            rect.height / 2;

                        if (after)
                            row.after(dragging);
                        else
                            row.before(dragging);
                    }
                );

                row.addEventListener(
                    "drop",
                    event => {
                        event.preventDefault();

                        const rows =
                            [
                                ...box.querySelectorAll(
                                    ".account"
                                )
                            ];

                        const newAccounts = {};

                        rows.forEach(r => {
                            const c = r.dataset.clan;
                            const a = r.dataset.account;

                            if (!newAccounts[c])
                                newAccounts[c] = [];

                            newAccounts[c].push(a);
                        });

                        SESSION.accounts = newAccounts;
                        SESSION.clans =
                            Object.keys(newAccounts);

                        saveSession();
                        renderAccounts();
                    }
                );
            });
        }
    );
}

function isLoggedInAccount(clan, account) {
    return SESSION.accounts[clan]?.includes(account) || false;
}

async function loadClan(name) {
    const ref = doc(db, "clans", name);
    const snap = await getDoc(ref);

    if (!snap.exists())
        await setDoc(ref, { created: Date.now() });

    CLAN_NAME = name;
    SESSION.activeClan = name;

    if (!SESSION.clans.includes(name))
        SESSION.clans.push(name);

    if (!SESSION.accounts[name])
        SESSION.accounts[name] = [];

    saveSession();

    document.getElementById("clanDisplay").textContent =
        "Clan: " + name;

    document.getElementById("clanInput").style.display =
        "none";

    document.getElementById("clanButton").style.display =
        "none";

    document.getElementById("changeClanButton").style.display =
        "block";

    document.getElementById("tradingButton").style.display =
        "block";

    await renderMembers();
    renderAccounts();
}

async function loadAccount(name) {
    if (!CLAN_NAME)
        return;

    const ref = doc(
        db,
        "clans",
        CLAN_NAME,
        "players",
        name
    );

    const snap = await getDoc(ref);

    if (!snap.exists()) {
        await setDoc(ref, { cards: {} });
        await initializePlayerCards(name);
    }

    CURRENT_ACCOUNT = name;
    VIEW_ACCOUNT = name;

    SESSION.activeClan = CLAN_NAME;
    SESSION.activeAccount = name;

    if (!SESSION.accounts[CLAN_NAME])
        SESSION.accounts[CLAN_NAME] = [];

    if (!SESSION.accounts[CLAN_NAME].includes(name))
        SESSION.accounts[CLAN_NAME].push(name);

    if (!SESSION.clans.includes(CLAN_NAME))
        SESSION.clans.push(CLAN_NAME);

    saveSession();

    TRADING_MODE = false;

    await loadPlayers();

    renderAccounts();
    renderMembers();
}

window.deleteCurrentAccount = async function() {
    if (!CLAN_NAME || !VIEW_ACCOUNT)
        return;

    const player = VIEW_ACCOUNT;

    if (!isLoggedInAccount(CLAN_NAME, player))
        return;

    if (
        !confirm(
            `Delete ${player} permanently from Firebase?`
        )
    )
        return;

    try {
        await deleteDoc(
            doc(
                db,
                "clans",
                CLAN_NAME,
                "players",
                player
            )
        );

        if (SESSION.accounts[CLAN_NAME]) {
            SESSION.accounts[CLAN_NAME] =
                SESSION.accounts[CLAN_NAME]
                    .filter(a => a !== player);

            if (
                SESSION.accounts[CLAN_NAME].length === 0
            ) {
                delete SESSION.accounts[CLAN_NAME];

                SESSION.clans =
                    SESSION.clans.filter(
                        c => c !== CLAN_NAME
                    );
            }
        }

        delete PRIORITIES[
            priorityKey(CLAN_NAME, player)
        ];

        if (CURRENT_ACCOUNT === player) {
            CURRENT_ACCOUNT = "";
            SESSION.activeAccount = "";
        }

        VIEW_ACCOUNT = "";

        saveSession();
        savePriorities();

        document.getElementById(
            "players"
        ).innerHTML = "Select account";

        await renderMembers();
        renderAccounts();

    } catch (error) {
        console.error(error);
        alert("Failed to delete account.");
    }
};

document.getElementById("clanButton").onclick = () => {
    const name =
        document
            .getElementById("clanInput")
            .value
            .trim();

    if (name)
        loadClan(name);
};

document.getElementById("accountButton").onclick = () => {
    const name =
        document
            .getElementById("accountInput")
            .value
            .trim();

    if (name)
        loadAccount(name);
};

document.getElementById("toggleSidebar").onclick = () => {
    const sidebar = document.getElementById("sidebar");
    sidebar.classList.toggle("collapsed");
    document.body.classList.toggle("sidebar-hidden");

    // persist sidebar state (collapsed = 1, open = 0)
    localStorage.setItem(
        "clashSidebarCollapsed",
        sidebar.classList.contains("collapsed") ? "1" : "0"
    );
};

// Close sidebar when clicking outside and initialize persisted state
function setSidebarCollapsed(collapsed) {
    const sidebar = document.getElementById("sidebar");
    if (!sidebar) return;

    if (collapsed) {
        sidebar.classList.add("collapsed");
        document.body.classList.add("sidebar-hidden");
    } else {
        sidebar.classList.remove("collapsed");
        document.body.classList.remove("sidebar-hidden");
    }

    localStorage.setItem("clashSidebarCollapsed", collapsed ? "1" : "0");
}

document.addEventListener("click", (e) => {
    const sidebar = document.getElementById("sidebar");
    const toggle = document.getElementById("toggleSidebar");

    if (!sidebar || sidebar.classList.contains("collapsed"))
        return;

    // if click is outside both sidebar and toggle button, collapse
    if (!e.target.closest("#sidebar") && !e.target.closest("#toggleSidebar")) {
        // only collapse when the page cannot fit 6 cards with the sidebar open
        if (!canFitSixCards()) {
            setSidebarCollapsed(true);
        }
    }
});

// Return true if the layout can accommodate 6 card columns while the sidebar is open
function canFitSixCards() {
    const sidebar = document.getElementById("sidebar");
    const sbWidth = sidebar ? sidebar.offsetWidth : 320;

    // approximate available width for the cards area when sidebar is open
    const pagePadding = 40; // body padding + some buffer
    const available = window.innerWidth - sbWidth - pagePadding;

    // grid gap between cards (matches .cards gap)
    const gridGap = 5;
    const totalGap = gridGap * (6 - 1);

    const cardWidth = (available - totalGap) / 6;
    const minCardWidth = 56; // smallest acceptable card-frame width

    return cardWidth >= minCardWidth;
}

// On resize, reopen the sidebar automatically if six cards fit and user hasn't explicitly collapsed it
window.addEventListener('resize', () => {
    try {
        const persisted = localStorage.getItem('clashSidebarCollapsed');
        if (canFitSixCards() && persisted !== '1') {
            setSidebarCollapsed(false);
        }
    } catch (e) {}
});

document.getElementById("changeClanButton").onclick = () => {
    CLAN_NAME = "";
    CURRENT_ACCOUNT = "";
    VIEW_ACCOUNT = "";

    SESSION.activeClan = "";
    SESSION.activeAccount = "";

    saveSession();

    TRADING_MODE = false;
    TRADES = [];

    document.getElementById(
        "clanDisplay"
    ).textContent = "Clan: None";

    document.getElementById(
        "clanInput"
    ).style.display = "block";

    document.getElementById(
        "clanButton"
    ).style.display = "block";

    document.getElementById(
        "changeClanButton"
    ).style.display = "none";

    document.getElementById(
        "tradingButton"
    ).style.display = "none";

    document.getElementById(
        "players"
    ).innerHTML = "Select clan";
};

document.getElementById("tradingButton").onclick =
    async () => {
        TRADING_MODE = true;
        await renderTrading();
    };

/* =========================
   TRADING
========================= */

async function getClanPlayers() {
    if (!CLAN_NAME) return [];
    const snap = await getDocs(collection(db, "clans", CLAN_NAME, "players"));
    return snap.docs.map(d => ({
        name: d.id,
        cards: d.data().cards || {}
    }));
}

async function getPendingTrades() {
    if (!CLAN_NAME)
        return [];

    const snap = await getDocs(
        collection(db, "clans", CLAN_NAME, "trades")
    );

    return snap.docs
        .map(d => ({
            id: d.id,
            ...d.data()
        }))
        .filter(t => t.status === "requested");
}

function tradeKey(trade) {
    return [
        trade.category,
        trade.from,
        trade.to,
        trade.give,
        trade.receive
    ].join("|");
}

function pendingCardKeys(pendingTrades) {
    const used = new Set();

    pendingTrades.forEach(trade => {
        used.add(`${trade.from}|${trade.give}`);
        used.add(`${trade.from}|${trade.receive}`);
        used.add(`${trade.to}|${trade.give}`);
        used.add(`${trade.to}|${trade.receive}`);
    });

    return used;
}

function getCategory(card) {
    for (const [category, cards] of Object.entries(CARDS)) {
        if (cards.includes(card)) return category;
    }
    return null;
}

function optimizeTrades(players, pendingTrades = []) {
    const trades = [];
    const priorityCounts = {};
    const locked = pendingCardKeys(pendingTrades);

    players.forEach(p => {
        if (isPriority(p.name))
            priorityCounts[p.name] = 0;
    });

    for (const [category, cards] of Object.entries(CARDS)) {
        const candidates = [];

        for (const a of players) {
            for (const b of players) {
                if (a.name === b.name)
                    continue;

                for (const give of cards) {
                    const aGive =
                        Number(a.cards[give] || 0);

                    const bGive =
                        Number(b.cards[give] || 0);

                    if (aGive <= 1 || bGive !== 0)
                        continue;

                    for (const receive of cards) {
                        if (give === receive)
                            continue;

                        const aReceive =
                            Number(a.cards[receive] || 0);

                        const bReceive =
                            Number(b.cards[receive] || 0);

                        if (bReceive <= 1 || aReceive !== 0)
                            continue;

                        if (
                            locked.has(`${a.name}|${give}`) ||
                            locked.has(`${a.name}|${receive}`) ||
                            locked.has(`${b.name}|${give}`) ||
                            locked.has(`${b.name}|${receive}`)
                        )
                            continue;

                        const priorityCount =
                            (isPriority(a.name) ? 1 : 0) +
                            (isPriority(b.name) ? 1 : 0);

                        const balance =
                            (priorityCounts[a.name] || 0) +
                            (priorityCounts[b.name] || 0);

                        candidates.push({
                            category,
                            from: a.name,
                            to: b.name,
                            give,
                            receive,
                            priorityCount,
                            balance
                        });
                    }
                }
            }
        }

        candidates.sort((a, b) => {
            if (a.priorityCount !== b.priorityCount)
                return b.priorityCount - a.priorityCount;

            if (a.balance !== b.balance)
                return a.balance - b.balance;

            if (a.from !== b.from)
                return a.from.localeCompare(b.from);

            if (a.to !== b.to)
                return a.to.localeCompare(b.to);

            return a.give.localeCompare(b.give);
        });

        const used = new Set();

        for (const candidate of candidates) {
            const keys = [
                `${candidate.from}|${candidate.give}`,
                `${candidate.from}|${candidate.receive}`,
                `${candidate.to}|${candidate.give}`,
                `${candidate.to}|${candidate.receive}`
            ];

            if (keys.some(key => used.has(key)))
                continue;

            keys.forEach(key => used.add(key));

            trades.push({
                category: candidate.category,
                from: candidate.from,
                to: candidate.to,
                give: candidate.give,
                receive: candidate.receive,
                status: "optimized"
            });

            if (isPriority(candidate.from))
                priorityCounts[candidate.from]++;

            if (isPriority(candidate.to))
                priorityCounts[candidate.to]++;
        }
    }

    return trades;
}

async function renderTrading() {
    if (!CLAN_NAME) {
        document.getElementById(
            "players"
        ).innerHTML = "Select clan";

        return;
    }

    const players =
        await getClanPlayers();

    if (players.length < 2) {
        document.getElementById(
            "players"
        ).innerHTML = `
            <div class="trade-window">
                <div class="trade-header">
                    <div>
                        <div class="trade-title">
                            Card Trading
                        </div>
                    </div>
                </div>

                <div class="trade-empty">
                    At least two clan members are required.
                </div>
            </div>
        `;

        return;
    }

    const priorityPlayers =
        players.filter(
            player => isPriority(player.name)
        );

    const pendingTrades =
        await getPendingTrades();

    TRADES = pendingTrades;

    document.getElementById(
        "players"
    ).innerHTML = `
        <div class="trade-window">

            <div class="trade-header">

                <div>
                    <div class="trade-title">
                        Card Trading
                    </div>

                    <div class="trade-subtitle">
                        ${players.length} members
                        ${
                            priorityPlayers.length
                                ? ` · ${priorityPlayers.length} priority`
                                : ""
                        }
                    </div>
                </div>

            </div>

            <div class="trade-info">
                Only cards with
                <b>more than 1</b>
                can be given.
                Only accounts with
                <b>0</b>
                can receive.
                Trades never cross categories.
            </div>

            <div class="trade-controls">
                <button
                    id="optimizeButton"
                    class="optimize-button"
                >
                    Optimize Trades
                </button>
            </div>

            <div
                id="tradeResults"
                class="trade-results"
            >
                ${
                    pendingTrades.length
                        ? ""
                        : `
                            <div class="trade-empty">
                                Press Optimize Trades
                            </div>
                        `
                }
            </div>

        </div>
    `;

    if (pendingTrades.length)
        renderTradeResults();

    document.getElementById(
        "optimizeButton"
    ).onclick = async () => {

        const button =
            document.getElementById(
                "optimizeButton"
            );

        if (button.disabled)
            return;

        button.disabled = true;
        button.textContent =
            "Optimizing...";

        try {
            const freshPlayers =
                await getClanPlayers();

            const lockedTrades =
                await getPendingTrades();

            const newTrades =
                optimizeTrades(
                    freshPlayers,
                    lockedTrades
                );

            TRADES = [
                ...lockedTrades,
                ...newTrades
            ];

            renderTradeResults();

        } catch (error) {
            console.error(error);

            alert(
                error.message ||
                "Failed to optimize trades."
            );

        } finally {
            button.disabled = false;
            button.textContent =
                "Optimize Trades";
        }
    };
}

function renderTradeResults() {
    const box = document.getElementById("tradeResults");

    if (!box)
        return;

    box.innerHTML = "";

    if (!TRADES.length) {
        box.innerHTML = `
            <div class="trade-empty">
                No trades available.
            </div>
        `;
        return;
    }

    const categoryOrder = Object.keys(CARDS);

    TRADES.sort((a, b) => {
        // put trades involving the current account first
        const aOwn = (a.from === CURRENT_ACCOUNT || a.to === CURRENT_ACCOUNT) ? 0 : 1;
        const bOwn = (b.from === CURRENT_ACCOUNT || b.to === CURRENT_ACCOUNT) ? 0 : 1;

        if (aOwn !== bOwn)
            return aOwn - bOwn;

        const aLocked = a.status === "requested" ? 0 : 1;
        const bLocked = b.status === "requested" ? 0 : 1;

        if (aLocked !== bLocked)
            return aLocked - bLocked;

        const ca = categoryOrder.indexOf(a.category);
        const cb = categoryOrder.indexOf(b.category);

        if (ca !== cb)
            return ca - cb;

        return a.from.localeCompare(b.from);
    });

    TRADES.forEach(trade => {
        const row = document.createElement("div");
        row.className = "trade-row";

        if (trade.status === "requested")
            row.classList.add("trade-requested");

        const fromPriority = isPriority(trade.from);
        const toPriority = isPriority(trade.to);

        const giveName = DISPLAY_NAMES[trade.give] || trade.give;
        const receiveName = DISPLAY_NAMES[trade.receive] || trade.receive;

        const giveImage =
            CARD_DATA[giveName]?.image ||
            CARD_DATA[trade.give]?.image ||
            "";

        const receiveImage =
            CARD_DATA[receiveName]?.image ||
            CARD_DATA[trade.receive]?.image ||
            "";

        const isRequested = trade.status === "requested";

        const fromLoggedIn =
            isLoggedInAccount(CLAN_NAME, trade.from);

        const toLoggedIn =
            isLoggedInAccount(CLAN_NAME, trade.to);

        const canRequest =
            !isRequested && fromLoggedIn;

        const canCancel =
            isRequested &&
            fromLoggedIn &&
            trade.requestedBy === trade.from;

        const canConfirm =
            isRequested && toLoggedIn;

        row.innerHTML = `
            <div class="trade-type ${tabClass(trade.category)}">
                ${trade.category.replace(" Troops", "")}
            </div>

            <div class="trade-side">
                <span class="${fromPriority ? "priority-name" : ""}">
                    ${fromPriority ? "★ " : ""}${escapeHtml(trade.from)}
                </span>

                <img
                    src="${escapeAttribute(giveImage)}"
                    alt="${escapeAttribute(giveName)}"
                >

                <span>
                    ${escapeHtml(giveName)}
                </span>
            </div>

            <div class="trade-symbol">
                ⇄
            </div>

            <div class="trade-side">
                <span class="${toPriority ? "priority-name" : ""}">
                    ${toPriority ? "★ " : ""}${escapeHtml(trade.to)}
                </span>

                <img
                    src="${escapeAttribute(receiveImage)}"
                    alt="${escapeAttribute(receiveName)}"
                >

                <span>
                    ${escapeHtml(receiveName)}
                </span>
            </div>

            <div class="trade-actions">

                ${
                    !isRequested
                        ? `
                            <button
                                class="request-trade"
                                ${canRequest ? "" : "disabled"}
                            >
                                Request
                            </button>
                        `
                        : `
                            <button
                                class="cancel-trade"
                                ${canCancel ? "" : "disabled"}
                            >
                                Cancel
                            </button>

                            <button
                                class="confirm-trade"
                                ${canConfirm ? "" : "disabled"}
                            >
                                Confirm
                            </button>
                        `
                }

            </div>
        `;

        const requestButton =
            row.querySelector(".request-trade");

        if (requestButton && canRequest) {
            requestButton.onclick = async () => {
                await requestTrade(trade, row);
            };
        }

        const cancelButton =
            row.querySelector(".cancel-trade");

        if (cancelButton && canCancel) {
            cancelButton.onclick = async () => {
                await cancelTrade(trade, row);
            };
        }

        const confirmButton =
            row.querySelector(".confirm-trade");

        if (confirmButton && canConfirm) {
            confirmButton.onclick = async () => {
                await confirmTrade(trade, row);
            };
        }

        box.appendChild(row);
    });
}

async function requestTrade(trade, row) {
    if (!trade || !row)
        return;

    if (!isLoggedInAccount(CLAN_NAME, trade.from)) {
        alert(`${trade.from} is not logged in.`);
        return;
    }

    const button = row.querySelector(".request-trade");

    if (!button)
        return;

    button.disabled = true;
    button.textContent = "...";

    try {
        const tradeId = crypto.randomUUID();
        const ref = doc(db,"clans",CLAN_NAME,"trades",tradeId);
        await setDoc(ref, {
            category: trade.category,
            from: trade.from,
            to: trade.to,
            give: trade.give,
            receive: trade.receive,
            status: "requested",
            requestedBy: trade.from,
            requestedAt: Date.now()
        });

        trade.id = tradeId;
        trade.status = "requested";
        // reflect requester locally so cancel button becomes enabled immediately
        trade.requestedBy = trade.from;
        trade.requestedAt = Date.now();

        renderTradeResults();

    } catch (error) {
        console.error(error);

        button.disabled = false;
        button.textContent = "Request";

        alert(
            error.message ||
            "Failed to request trade."
        );
    }
}

async function cancelTrade(trade, row) {
    if (!trade || !row)
        return;

    if (trade.status !== "requested")
        return;

    if (!isLoggedInAccount(CLAN_NAME, trade.from)) {
        alert(`${trade.from} is not logged in.`);
        return;
    }

    const button = row.querySelector(".cancel-trade");

    if (!button || button.disabled)
        return;

    button.disabled = true;
    button.textContent = "...";

    try {
        const tradeRef = doc(db,"clans",CLAN_NAME,"trades",trade.id);

        const snap = await getDoc(tradeRef);

        if (!snap.exists()) {throw new Error("Trade no longer exists.");}

        const savedTrade = snap.data();

        if (savedTrade.status !== "requested") {
            throw new Error("Trade is no longer active.");
        }

        if (savedTrade.requestedBy !== trade.from) {
            throw new Error("You cannot cancel this request.");
        }

        await deleteDoc(tradeRef);

        TRADES = TRADES.filter(t => t.id !== trade.id);

        row.remove();

        const results = document.getElementById("tradeResults");

        if (
            results &&
            !results.querySelector(".trade-row")
        ) {
            results.innerHTML = `
                <div class="trade-empty">
                    No remaining trades.
                </div>
            `;
        }

    } catch (error) {
        console.error(error);

        button.disabled = false;
        button.textContent = "Cancel";

        alert(error.message || "Failed to cancel trade.");
    }
}

async function confirmTrade(trade, row) {
    if (!trade || !row)
        return;

    if (trade.status !== "requested")
        return;

    if (CURRENT_ACCOUNT !== trade.to) {
        alert(
            `Only ${trade.to} can confirm this trade.`
        );
        return;
    }

    const button =
        row.querySelector(".confirm-trade");

    if (!button || button.disabled)
        return;

    button.disabled = true;
    button.textContent = "...";

    try {
        await runTransaction(
            db,
            async transaction => {

                const fromRef = doc(
                    db,
                    "clans",
                    CLAN_NAME,
                    "players",
                    trade.from
                );

                const toRef = doc(
                    db,
                    "clans",
                    CLAN_NAME,
                    "players",
                    trade.to
                );

                const tradeRef = doc(
                    db,
                    "clans",
                    CLAN_NAME,
                    "trades",
                    trade.id
                );

                const fromSnap =
                    await transaction.get(fromRef);

                const toSnap =
                    await transaction.get(toRef);

                const tradeSnap =
                    await transaction.get(tradeRef);

                if (
                    !fromSnap.exists() ||
                    !toSnap.exists()
                ) {
                    throw new Error(
                        "Account no longer exists."
                    );
                }

                if (!tradeSnap.exists()) {
                    throw new Error(
                        "Trade no longer exists."
                    );
                }

                const savedTrade =
                    tradeSnap.data();

                if (
                    savedTrade.status !==
                    "requested"
                ) {
                    throw new Error(
                        "Trade has already been completed."
                    );
                }

                const fromCards = {
                    ...(fromSnap.data().cards || {})
                };

                const toCards = {
                    ...(toSnap.data().cards || {})
                };

                const fromGive =
                    Number(
                        fromCards[trade.give] || 0
                    );

                const fromReceive =
                    Number(
                        fromCards[trade.receive] || 0
                    );

                const toGive =
                    Number(
                        toCards[trade.receive] || 0
                    );

                const toReceive =
                    Number(
                        toCards[trade.give] || 0
                    );

                if (fromGive <= 1) {
                    throw new Error(
                        `${trade.from} no longer has an extra ${trade.give}.`
                    );
                }

                if (fromReceive !== 0) {
                    throw new Error(
                        `${trade.from} already has ${trade.receive}.`
                    );
                }

                if (toGive <= 1) {
                    throw new Error(
                        `${trade.to} no longer has an extra ${trade.receive}.`
                    );
                }

                if (toReceive !== 0) {
                    throw new Error(
                        `${trade.to} already has ${trade.give}.`
                    );
                }

                fromCards[trade.give] =
                    fromGive - 1;

                fromCards[trade.receive] = 1;

                toCards[trade.receive] =
                    toGive - 1;

                toCards[trade.give] = 1;

                transaction.update(
                    fromRef,
                    {
                        cards: fromCards
                    }
                );

                transaction.update(
                    toRef,
                    {
                        cards: toCards
                    }
                );

                transaction.delete(
                    tradeRef
                );
            }
        );

        row.classList.add(
            "trade-confirmed"
        );

        button.textContent = "✓";

        TRADES =
            TRADES.filter(
                t => t.id !== trade.id
            );

        setTimeout(() => {
            row.remove();

            const results =
                document.getElementById(
                    "tradeResults"
                );

            if (
                results &&
                !results.querySelector(
                    ".trade-row"
                )
            ) {
                results.innerHTML = `
                    <div class="trade-empty">
                        No remaining trades.
                    </div>
                `;
            }
        }, 700);

    } catch (error) {
        console.error(error);

        button.disabled = false;
        button.textContent = "Confirm";

        alert(
            error.message ||
            "Trade failed."
        );

        await renderTrading();
    }
}

function groupTrades(trades) {
    const grouped = {};

    trades.forEach(trade => {

        const key =
            `${trade.category}|${trade.from}|${trade.to}`;

        if (!grouped[key]) {
            grouped[key] = {
                category: trade.category,
                from: trade.from,
                to: trade.to,
                cards: []
            };
        }

        if (
            !grouped[key].cards.includes(
                trade.card
            )
        ) {
            grouped[key].cards.push(
                trade.card
            );
        }
    });

    return Object.values(grouped);
}

function safeId(value) {
    return String(value)
        .replace(/[^a-zA-Z0-9_-]/g, "-");
}

function escapeHtml(value) {
return String(value)
.replace(/&/g,"&amp;")
.replace(/</g,"&lt;")
.replace(/>/g,"&gt;")
.replace(/"/g,"&quot;")
.replace(/'/g,"&#039;");
}

function escapeAttribute(value) {
return escapeHtml(value);
}

async function setup() {
    try {
        // restore sidebar state from previous session
        const saved = localStorage.getItem("clashSidebarCollapsed");
        if (saved !== null) {
            setSidebarCollapsed(saved === "1");
        }
        await loadCardData();

        if (SESSION.activeClan) {
            await loadClan(
                SESSION.activeClan
            );

            if (SESSION.activeAccount)
                await loadAccount(
                    SESSION.activeAccount
                );
        } else {
            document.getElementById(
                "players"
            ).innerHTML =
                "Select clan";
        }

    } catch (error) {
        console.error(error);

        document.getElementById(
            "players"
        ).innerHTML =
            "Failed to load application.";
    }
}

setup();