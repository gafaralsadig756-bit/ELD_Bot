const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    DisconnectReason,
    Browsers
} = require("@whiskeysockets/baileys");

const pino = require("pino");
const fs = require("fs");
const readline = require("readline");

// ======================================================
// 👑 ELD BOT - الإعدادات الأساسية
// ======================================================

const EMPEROR_NUM = "294992316322"; // ← غير هذا لرقمك
const BOT_PHONE = "249930756661";
const DB_FILE = "./eld_database.json";
const AUTH_DIR = "./auth_info";

const RANKS = ["E", "D", "C", "B", "A", "S"];

// ======================================================
// 📊 نظام الترقيات
// ======================================================

const RANK_REQUIREMENTS = {
    E: { messages: 900, events: 0, members: 0, days: 3, demotionDays: 15, needsTeach: false },
    D: { messages: 1500, events: 150, members: 0, days: 3, demotionDays: 15, needsTeach: true },
    C: { messages: 2500, events: 350, members: 0, days: 3, demotionDays: 15, needsTeach: false },
    B: { messages: 3000, events: 400, members: 0, days: 5, demotionDays: 15, needsTeach: false },
    A: { messages: 5000, events: 500, members: 0, days: 7, demotionDays: 15, needsTeach: false },
    S: { messages: 10000, events: 700, members: 0, days: 150, demotionDays: 999, needsTeach: false }
};

const DEFAULT_ROYALS = {
    "إمبراطور": EMPEROR_NUM,
    "نائب الامبراطور": null,
    "رئيس المجلس": null,
    "اللورد": null,
    "نواب اللورد": null,
    "الماركيز": null,
    "نواب الماركيز": null,
    "السلطان": null
};

let db = {
    groups: {},
    users: {},
    banned: {},
    royals: { ...DEFAULT_ROYALS },
    emperorJid: null,
    emperorSet: false,
    chatMode: {},
    shop: {
        title_change: 150,
        title_ruin: 300,
        vacation_1day: 200,
        vacation_2days: 220,
        vacation_1week: 1500,
        is_open: true
    },
    active_event: null,
    pendingJoins: {},
    transfers: {},
    userGames: {},
    dormantUsers: {},
    autoWelcomeReception: true // ← إضافة متغير التحكم في القبول التلقائي
};

// ======================================================
// 📂 تحميل قاعدة البيانات
// ======================================================

if (fs.existsSync(DB_FILE)) {
    try {
        const loaded = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
        db = { ...db, ...loaded };
        if (typeof db.autoWelcomeReception === 'undefined') db.autoWelcomeReception = true;
        console.log("✅ تم تحميل قاعدة البيانات بنجاح");
    } catch (e) {
        console.log("⚠️ تعذر قراءة قاعدة البيانات، سيتم استخدام قاعدة جديدة.");
    }
}

function saveDB() {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
    } catch (e) {
        console.log("❌ خطأ في حفظ قاعدة البيانات:", e.message);
    }
}

// ======================================================
// 👑 إنشاء الإمبراطور
// ======================================================

if (!db.users[EMPEROR_NUM]) {
    db.users[EMPEROR_NUM] = {
        phone: EMPEROR_NUM,
        jid: `${EMPEROR_NUM}@s.whatsapp.net`,
        nickname: "توجي",
        rank: "إمبراطور",
        joinedAt: Date.now(),
        messagesTotal: 0,
        messagesToday: 0,
        lastMessageAt: 0,
        last_active: 0,
        lastMessageDay: getToday(),
        events: 0,
        interactions: 0,
        bank: 0,
        isTaught: true,
        demotionPaused: true,
        titleChanges: 0,
        rankStartDate: Date.now(),
        rankMessages: 0,
        rankEvents: 0,
        rankMembers: 0,
        lastRankCheck: Date.now(),
        rankHistory: [],
        isDormant: false
    };
    console.log("👑 تم إنشاء حساب الإمبراطور");
}
db.royals["إمبراطور"] = EMPEROR_NUM;
saveDB();

// ======================================================
// 🧹 أدوات
// ======================================================

function cleanPhone(phone) {
    if (!phone) return "";
    return String(phone).replace(/[^0-9]/g, "");
}

function jidFromNumber(number) {
    return `${cleanPhone(number)}@s.whatsapp.net`;
}

function getToday() {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Africa/Khartoum"
    }).format(new Date());
}

function getText(msg) {
    return (
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        msg.message?.videoMessage?.caption ||
        msg.message?.documentMessage?.caption ||
        ""
    ).trim();
}

function getMentionedJid(msg) {
    return msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || null;
}

function getQuotedParticipant(msg) {
    return msg.message?.extendedTextMessage?.contextInfo?.participant || null;
}

function getParticipantJid(participant) {
    if (!participant) return "";
    if (typeof participant === "string") return participant;
    return participant.id || participant.jid || participant.lid || "";
}

function getRoyalRank(phone) {
    const cleaned = cleanPhone(phone);
    for (const [rank, assignedPhone] of Object.entries(db.royals)) {
        if (assignedPhone && cleanPhone(assignedPhone) === cleaned) {
            return rank;
        }
    }
    return null;
}

function isEmperor(value) {
    const id = String(value || "");
    if (cleanPhone(id) === EMPEROR_NUM) return true;
    if (id === `${EMPEROR_NUM}@s.whatsapp.net`) return true;
    if (db.emperorJid && id === db.emperorJid) return true;
    if (db.royals["إمبراطور"] && cleanPhone(db.royals["إمبراطور"]) === cleanPhone(id)) return true;
    return false;
}

function isRoyal(value) {
    if (isEmperor(value)) return true;
    return !!getRoyalRank(value);
}

function getRankForIdentity(jid, phone, user) {
    if (isEmperor(jid) || isEmperor(phone)) return "إمبراطور";
    return getRoyalRank(phone) || getRoyalRank(jid) || user?.rank || "E";
}

function findUserByJid(jid) {
    if (!jid) return null;
    const clean = cleanPhone(jid);
    if (db.users[clean]) return db.users[clean];
    for (const user of Object.values(db.users)) {
        if (!user) continue;
        if (user.jid === jid) return user;
        if (user.jid && cleanPhone(user.jid) === clean) return user;
    }
    return null;
}

function ensureUser(phone, jid = null) {
    phone = cleanPhone(phone);
    if (!phone) return null;

    if (!db.users[phone]) {
        db.users[phone] = {
            phone,
            jid: jid || jidFromNumber(phone),
            nickname: "غير محدد",
            rank: "E",
            joinedAt: Date.now(),
            messagesTotal: 0,
            messagesToday: 0,
            lastMessageAt: 0,
            last_active: 0,
            lastMessageDay: getToday(),
            events: 0,
            interactions: 0,
            bank: 0,
            isTaught: false,
            demotionPaused: false,
            titleChanges: 0,
            rankStartDate: Date.now(),
            rankMessages: 0,
            rankEvents: 0,
            rankMembers: 0,
            lastRankCheck: Date.now(),
            rankHistory: [],
            isDormant: false
        };
    }

    const user = db.users[phone];
    if (jid) user.jid = jid;
    if (!user.lastMessageDay) user.lastMessageDay = getToday();
    if (user.lastMessageDay !== getToday()) {
        user.messagesToday = 0;
        user.lastMessageDay = getToday();
    }
    return user;
}

function getDemotionDays(rank) {
    const req = RANK_REQUIREMENTS[rank];
    return req ? req.demotionDays : 0;
}

function updateAutomaticRank(user) {
    if (!user) return null;
    if (user.rank === "إمبراطور") return null;
    if (user.isDormant) return null;
    
    const royalRanks = ["نائب الامبراطور", "رئيس المجلس", "اللورد", "نواب اللورد", "الماركيز", "نواب الماركيز", "السلطان"];
    if (royalRanks.includes(user.rank)) return null;
    if (user.demotionPaused) return null;

    const now = Date.now();
    const currentRank = user.rank || "E";
    const req = RANK_REQUIREMENTS[currentRank];
    if (!req) return null;

    const daysSinceRank = (now - user.rankStartDate) / (1000 * 60 * 60 * 24);
    const messagesMet = user.rankMessages >= req.messages;
    const eventsMet = user.rankEvents >= req.events;
    const membersMet = currentRank === "E" ? user.rankMembers >= 1 : true;
    const timeMet = daysSinceRank <= req.days;

    let adjustedMessages = user.rankMessages;
    if (currentRank === "E") {
        adjustedMessages = user.rankMessages - (user.rankMembers * 150);
        if (adjustedMessages < 0) adjustedMessages = 0;
    }

    const messagesCheck = currentRank === "E" ? adjustedMessages >= req.messages : messagesMet;
    const needsTeach = req.needsTeach && user.isTaught === false;

    if (currentRank === "E" && !user.isTaught && !needsTeach) return null;

    if (messagesCheck && eventsMet && membersMet && timeMet && !needsTeach) {
        const rankOrder = ["E", "D", "C", "B", "A", "S"];
        const currentIndex = rankOrder.indexOf(currentRank);
        if (currentIndex < rankOrder.length - 1) {
            const newRank = rankOrder[currentIndex + 1];
            user.rankHistory.push({ from: currentRank, to: newRank, date: now, type: "promotion" });
            user.rank = newRank;
            user.rankStartDate = now;
            user.rankMessages = 0;
            user.rankEvents = 0;
            user.rankMembers = 0;
            saveDB();
            return { oldRank: currentRank, newRank: newRank };
        }
    }

    const demotionDays = getDemotionDays(currentRank);
    if (demotionDays > 0 && demotionDays < 999 && daysSinceRank > demotionDays) {
        const rankOrder = ["E", "D", "C", "B", "A", "S"];
        const currentIndex = rankOrder.indexOf(currentRank);
        if (currentIndex > 0) {
            const newRank = rankOrder[currentIndex - 1];
            user.rankHistory.push({ from: currentRank, to: newRank, date: now, type: "demotion" });
            user.rank = newRank;
            user.rankStartDate = now;
            user.rankMessages = 0;
            user.rankEvents = 0;
            user.rankMembers = 0;
            saveDB();
            return { oldRank: currentRank, newRank: newRank };
        }
    }

    if (daysSinceRank > req.days) {
        user.rankMessages = 0;
        user.rankEvents = 0;
        user.rankMembers = 0;
        user.rankStartDate = now;
        saveDB();
    }

    return null;
}

function incrementUserRankMessages(phone, count = 1) {
    const user = ensureUser(phone);
    if (user && user.rank !== "إمبراطور" && !user.demotionPaused && !user.isDormant) {
        user.rankMessages = (user.rankMessages || 0) + count;
        saveDB();
    }
}

function incrementUserRankEvents(phone, count = 1) {
    const user = ensureUser(phone);
    if (user && !user.isDormant) {
        user.rankEvents = (user.rankEvents || 0) + count;
        user.events = (user.events || 0) + count;
        saveDB();
    }
}

function incrementUserRankMembers(phone, count = 1) {
    const user = ensureUser(phone);
    if (user && !user.isDormant) {
        user.rankMembers = (user.rankMembers || 0) + count;
        saveDB();
    }
}

function resetDailyCounters() {
    const today = getToday();
    for (const user of Object.values(db.users)) {
        if (!user) continue;
        if (user.lastMessageDay !== today) {
            user.messagesToday = 0;
            user.lastMessageDay = today;
        }
    }
}

const messageCache = {};
function cacheMessage(groupJid, msg, senderNumber) {
    if (!messageCache[groupJid]) messageCache[groupJid] = [];
    messageCache[groupJid].push({
        key: msg.key,
        sender: senderNumber,
        timestamp: Date.now()
    });
    if (messageCache[groupJid].length > 1000) messageCache[groupJid].shift();
}

const stickerSpam = {};
const cardCooldowns = {};
const shopCooldowns = {};

const FLAGS_LIST = [
    ["🇦🇫", "أفغانستان"], ["🇩🇿", "الجزائر"], ["🇦🇷", "الأرجنتين"], ["🇦🇺", "أستراليا"],
    ["🇧🇷", "البرازيل"], ["🇨🇦", "كندا"], ["🇨🇳", "الصين"], ["🇪🇬", "مصر"],
    ["🇫🇷", "فرنسا"], ["🇩🇪", "ألمانيا"], ["🇮🇳", "الهند"], ["🇮🇹", "إيطاليا"],
    ["🇯🇵", "اليابان"], ["🇲🇦", "المغرب"], ["🇵🇸", "فلسطين"], ["🇶🇦", "قطر"],
    ["🇷🇺", "روسيا"], ["🇸🇦", "السعودية"], ["🇪🇸", "إسبانيا"], ["🇸🇩", "السودان"],
    ["🇸🇾", "سوريا"], ["🇹🇳", "تونس"], ["🇹🇷", "تركيا"], ["🇦🇪", "الإمارات"],
    ["🇬🇧", "المملكة المتحدة"], ["🇺🇸", "الولايات المتحدة"], ["🇾🇪", "اليمن"]
];

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise((resolve) => rl.question(text, resolve));

async function startELD() {
    console.log("=========================================");
    console.log("👑 بوت 𝑬.𝑳.𝑫");
    console.log("📱 رقم التشغيل: " + BOT_PHONE);
    console.log("📁 مجلد الجلسة: " + AUTH_DIR);
    console.log("=========================================");

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    let phoneNumber = '';
    if (!state.creds.registered) {
        phoneNumber = await question('📱 أدخل رقم هاتفك مع رمز الدولة (مثال: 249930756661): ');
        phoneNumber = phoneNumber.replace(/[^0-9]/g, '');
    }

    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }))
        },
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
        markOnlineOnConnect: true
    });

    sock.ev.on("creds.update", saveCreds);

    if (!state.creds.registered && phoneNumber) {
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(phoneNumber);
                console.log(`\n🔑 كود الربط: \x1b[1;\x1b[32m${code}\x1b[0m\n`);
            } catch (err) {
                console.error('❌ فشل طلب كود الربط:', err?.message || err);
            }
        }, 2000);
    }

    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === "open") console.log("✅ تم الاتصال والتوثيق بنجاح!");
        if (connection === "close") {
            const code = lastDisconnect?.error?.output?.statusCode;
            if (code !== DisconnectReason.loggedOut) {
                console.log('🔄 جاري إعادة الاتصال...');
                setTimeout(startELD, 5000);
            } else {
                console.log('❌ انتهت صلاحية الجلسة.');
            }
        }
    });

    // ==================================================
    // 👑 رصد الاستقبال والإضافة المباشرة للأساسي
    // ==================================================
    sock.ev.on("group-participants.update", async (update) => {
        const { id, participants, action, author } = update;
        
        if (action === "add") {
            // 📌 1. الاستقبال التلقائي
            if (db.groups["الاستقبال"] === id && db.autoWelcomeReception !== false) {
                for (const p of participants) {
                    const newMember = cleanPhone(p);
                    if (newMember && !db.banned[newMember]) {
                        if (!db.pendingJoins) db.pendingJoins = {};
                        db.pendingJoins[newMember] = { jid: p, joinedAt: Date.now(), status: "pending" };
                        saveDB();

                        const form = `_📜 استمارة الانضمام 🧸:_\n\n@${newMember}\n\n⸙ _لقبك:_\n> اختر اسم شخصية أنمي أو مانهوا تناسب جنسك + صورة لشخصية\n\n⸙ _مـن طـࢪف :_\n> الشخص لي اخذت لينك من (منشوره / تعليقه) كان.. أو اسم الحساب\n\n_يرجى منشن مشرف بعد تعبئة الاستمارة_ 🧁\n_مرحباً بك منورنا في 『𝑬.𝑳.𝑫⊰⚕️⊱𝑫𝑰𝑴𝑶𝑵𝑫』!_ ✨\n\n_┇━──╌ •⤣⚕️⤤• ╌──━┇⌬_`;
                        await sock.sendMessage(id, { text: form, mentions: [p] });
                    }
                }
            }

            // 📌 2. الانضمام المباشر للأساسي (الإضافة الشرعية)
            if (db.groups["الاساسي"] === id) {
                for (const p of participants) {
                    const newMember = cleanPhone(p);
                    if (author) {
                        const adminPhone = cleanPhone(author);
                        const template = `*عرّف لنا العضو الجديد*\n*𖣔━ ═━━❮🌑❯━━═ ━𖣔*\n*اللقب المختار   ⟬⟭*\n                             *من طرف ⟬⟭*\n*الرقم ⟬${newMember}⟭*\n*𖣔━ ═━━❮🌑❯━━═ ━𖣔*`;
                        
                        await sock.sendMessage(id, {
                            text: `يا @${adminPhone}، يبدو أنه تمت إضافة عضو جديد مباشرة إلى الأساسي بدون المرور بالاستقبال.\nالرجاء تعبئة هذه الاستمارة للتعريف به وتسجيله في النظام:\n\n${template}`,
                            mentions: [author]
                        });
                    }
                }
            }
        }
    });

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
        try {
            if (type !== "notify") return;

            const msg = messages[0];
            if (!msg.message || msg.key.fromMe) return;

            const remoteJid = msg.key.remoteJid;
            if (!remoteJid) return;

            const isGroup = remoteJid.endsWith("@g.us");
            const senderJid = msg.key.participant || remoteJid;
            const senderNumber = cleanPhone(senderJid);
            if (!senderNumber) return;

            const text = getText(msg);

            let metadata;
            let isAdmin = false;
            
            if (isGroup) {
                try {
                    metadata = await sock.groupMetadata(remoteJid);
                    const participant = metadata.participants?.find(p => getParticipantJid(p) === senderJid);
                    isAdmin = participant?.admin === "admin" || participant?.admin === "superadmin";
                } catch {}
            }

            const royal = isRoyal(senderJid) || isRoyal(senderNumber);
            const emperor = isEmperor(senderJid) || isEmperor(senderNumber);
            const privileged = isAdmin || royal;
            const user = ensureUser(senderNumber, senderJid);

            if (isGroup) cacheMessage(remoteJid, msg, senderNumber);

            // ==================================================
            // 📋 أمر .الاوامر الموحد (يرسل للخاص دائماً)
            // ==================================================
            if (text === ".الاوامر" || text === ".اوامر") {
                const isRankCPlus = user && ["C", "B", "A", "S"].includes(user.rank);
                
                if (emperor || royal) {
                    const fullCommands = `👑 *أوامر 𝑬.𝑳.𝑫 الشاملة*\n\n📌 *الإمبراطور*\n.الامبراطور\n.تحكم الرتب\n.تعيين_ملكي\n.ترقية_تخطي\n.وقف من @منشن\n.استمرار من @منشن\n.تغيير الرقم من @قديم الي @جديد\n.تنشيط @منشن\n.سكون @منشن\n\n📌 *إدارة المجموعات*\n.تعيين (الاساسي/الاستقبال/الورك/الاعلانات)\n.إلغاء (الاساسي/الاستقبال/الورك/الاعلانات)\n.فتح\n.غلق\n.ايقاف القبول والاستقبال التلقائي\n.تشغيل القبول والاستقبال التلقائي\n.طرد @منشن (مؤبد)\n.حذف 10\n\n📌 *إدارة الأعضاء*\n.تم(اللقب)(الطرف) @منشن\n.تم التعلم @منشن\n.فحص لقب [الاسم]\n\n📌 *المتجر والاقتصاد*\n.المتجر\n.فتح المتجر (للإمبراطور)\n.اغلاق المتجر (للإمبراطور)\n.محفظتي\n.تحويل [المبلغ] لـ @منشن\n\n📌 *الألعاب والفعاليات*\n.فعالية الاعلام بدت/انتهت\n.فعالية كتابة بدت/انتهت\n.ارمي النرد\n.ارمي عملة\n.حظي\n.عشوائي\n.سلوت\n.نكتة\n.احزر\n\n📌 *التقارير*\n.كم لترقيتي\n.بطاقتي\n.حسبة (للمشرفين)`;
                    
                    await sock.sendMessage(senderJid, { text: fullCommands });
                    if (isGroup) await sock.sendMessage(remoteJid, { text: "📥 تم إرسال قائمة الأوامر الكاملة إلى خاصك." });
                    return;
                } else if (isRankCPlus) {
                    const cCommands = `📋 *أوامر 𝑬.𝑳.𝑫*\n\n📌 *الأعضاء*\n.تم التعلم @منشن\n.حذف 10\n\n📌 *الدردشة*\n.فتح\n.غلق\n\n📌 *المتجر*\n.المتجر\n.محفظتي\n.تحويل المبلغ لـ @منشن\n\n📌 *الألعاب*\n.ارمي النرد\n.ارمي عملة\n.حظي\n.عشوائي\n.سلوت\n.نكتة\n.احزر\n\n📌 *التقارير*\n.كم لترقيتي\n.بطاقتي`;
                    await sock.sendMessage(senderJid, { text: cCommands });
                    if (isGroup) await sock.sendMessage(remoteJid, { text: "📥 تم إرسال قائمة الأوامر إلى خاصك." });
                    return;
                }
            }

            if (text === ".تست" && db.groups["الاساسي"] === remoteJid) {
                if (db.emperorSet) {
                    await sock.sendMessage(remoteJid, { text: "❌ تم تعيين الإمبراطور بالفعل." });
                    return;
                }
                db.royals["إمبراطور"] = senderNumber;
                db.emperorJid = senderJid;
                db.emperorSet = true;
                const u = ensureUser(senderNumber, senderJid);
                u.rank = "إمبراطور";
                u.isTaught = true;
                u.demotionPaused = true;
                u.isDormant = false;
                saveDB();
                await sock.sendMessage(remoteJid, { text: `👑 *تم تعيين الإمبراطور!*\n@${senderNumber}`, mentions: [senderJid] });
                return;
            }

            if (!isGroup) {
                if (text === "انا هو جيجو") {
                    db.royals["إمبراطور"] = senderNumber;
                    db.emperorJid = senderJid;
                    const empU = ensureUser(senderNumber, senderJid);
                    empU.rank = "إمبراطور";
                    empU.isTaught = true;
                    empU.demotionPaused = true;
                    empU.isDormant = false;
                    db.emperorSet = true;
                    saveDB();
                    await sock.sendMessage(remoteJid, { text: `👑 تم التعرف عليك كإمبراطور!\n@${senderNumber}`, mentions: [senderJid] });
                    return;
                }
                if (emperor) {
                    if (text === ".فتح المتجر") { db.shop.is_open = true; saveDB(); await sock.sendMessage(remoteJid, { text: "🛒 تم فتح المتجر." }); return; }
                    if (text === ".اغلاق المتجر") { db.shop.is_open = false; saveDB(); await sock.sendMessage(remoteJid, { text: "🛒 تم إغلاق المتجر." }); return; }
                }
                return;
            }

            resetDailyCounters();
            if (user.isDormant) return;

            const today = getToday();
            if (user.lastMessageDay !== today) {
                user.messagesToday = 0;
                user.lastMessageDay = today;
            }

            user.messagesTotal = (user.messagesTotal || 0) + 1;
            user.messagesToday = (user.messagesToday || 0) + 1;
            user.lastMessageAt = Date.now();
            user.last_active = Date.now();
            user.interactions = (user.interactions || 0) + 1;

            if (user.rank !== "إمبراطور" && !user.demotionPaused) {
                user.rankMessages = (user.rankMessages || 0) + 1;
            }

            if (!privileged && !user.isDormant) {
                const hasLink = /(https?:\/\/\S+|www\.\S+|chat\.whatsapp\.com\/\S+)/i.test(text);
                if (hasLink) {
                    try { await sock.sendMessage(remoteJid, { delete: msg.key }); } catch {}
                    await sock.sendMessage(remoteJid, { text: `⚠️ يمنع نشر الروابط هنا يا @${senderNumber}.`, mentions: [senderJid] });
                    return;
                }
                if (msg.message.stickerMessage) {
                    const now = Date.now();
                    if (!stickerSpam[senderNumber]) stickerSpam[senderNumber] = [];
                    stickerSpam[senderNumber].push(now);
                    stickerSpam[senderNumber] = stickerSpam[senderNumber].filter(t => now - t < 4000);
                    if (stickerSpam[senderNumber].length >= 3) {
                        try { await sock.sendMessage(remoteJid, { delete: msg.key }); } catch {}
                        await sock.sendMessage(remoteJid, { text: `⚠️ تحذير سبام ملصقات يا @${senderNumber}!`, mentions: [senderJid] });
                        stickerSpam[senderNumber] = [];
                        return;
                    }
                }
            }

            // ==================================================
            // 🛑 إيقاف وتشغيل القبول التلقائي
            // ==================================================
            if (text === ".ايقاف القبول والاستقبال التلقائي" && privileged) {
                db.autoWelcomeReception = false;
                saveDB();
                await sock.sendMessage(remoteJid, { text: "🛑 تم إيقاف الاستقبال التلقائي في مجموعة الاستقبال.\n(سيتم تجاهل الأعضاء الجدد حتى يتم تفعيله)" });
                return;
            }

            if (text === ".تشغيل القبول والاستقبال التلقائي" && privileged) {
                db.autoWelcomeReception = true;
                saveDB();
                await sock.sendMessage(remoteJid, { text: "✅ تم تشغيل الاستقبال التلقائي في مجموعة الاستقبال.\n(سيتم إرسال استمارة الانضمام تلقائياً)" });
                return;
            }

            // ==================================================
            // 🔒 غلق وفتح الدردشة (بواسطة إعدادات المجموعة فعلياً)
            // ==================================================
            if (text === ".غلق" && privileged) {
                db.chatMode[remoteJid] = "closed";
                saveDB();
                try { await sock.groupSettingUpdate(remoteJid, 'announcement'); } catch {}
                await sock.sendMessage(remoteJid, { text: `🔒 *تم غلق الدردشة*\n\n✓ تم منع إرسال الرسائل للأعضاء، الكتابة الآن للمشرفين فقط.` });
                return;
            }

            if (text === ".فتح" && privileged) {
                db.chatMode[remoteJid] = "open";
                saveDB();
                try { await sock.groupSettingUpdate(remoteJid, 'not_announcement'); } catch {}
                await sock.sendMessage(remoteJid, { text: `🔓 *تم فتح الدردشة*\n\n✓ أصبح بإمكان جميع الأعضاء إرسال الرسائل مجدداً.` });
                return;
            }

            // ==================================================
            // 📋 قراءة استمارة الدخول المباشر وتسجيل العضو 
            // ==================================================
            if (privileged && text.includes("اللقب المختار") && text.includes("من طرف") && text.includes("الرقم") && text.includes("⟬") && text.includes("⟭")) {
                try {
                    const nickMatch = text.match(/اللقب المختار\s*⟬(.*?)⟭/);
                    const sourceMatch = text.match(/من طرف\s*⟬(.*?)⟭/);
                    const phoneMatch = text.match(/الرقم\s*⟬(.*?)⟭/);

                    if (nickMatch && sourceMatch && phoneMatch) {
                        const nickname = nickMatch[1].trim();
                        const source = sourceMatch[1].trim();
                        const targetPhone = cleanPhone(phoneMatch[1].trim());

                        if (nickname && source && targetPhone) {
                            const targetJid = `${targetPhone}@s.whatsapp.net`;
                            const taken = Object.values(db.users).some((u) => u.nickname === nickname && u.phone !== targetPhone);
                            if (taken) {
                                await sock.sendMessage(remoteJid, { text: `❌ اللقب "${nickname}" مشغول، اختار غيره.` });
                                return;
                            }

                            const oldUser = db.users[targetPhone];
                            db.users[targetPhone] = {
                                ...(oldUser || {}),
                                phone: targetPhone, jid: targetJid, nickname: nickname,
                                rank: oldUser?.rank || "E", joinedAt: oldUser?.joinedAt || Date.now(),
                                messagesTotal: Number(oldUser?.messagesTotal || 0),
                                messagesToday: Number(oldUser?.messagesToday || 0),
                                lastMessageDay: oldUser?.lastMessageDay || getToday(),
                                isTaught: oldUser?.isTaught || false,
                                demotionPaused: oldUser?.demotionPaused || false,
                                rankStartDate: oldUser?.rankStartDate || Date.now(),
                                rankMessages: Number(oldUser?.rankMessages || 0),
                                rankEvents: Number(oldUser?.rankEvents || 0),
                                rankMembers: Number(oldUser?.rankMembers || 0),
                                rankHistory: oldUser?.rankHistory || [],
                                source: source, registeredBy: senderNumber,
                                isDormant: oldUser?.isDormant || false
                            };

                            incrementUserRankMembers(senderNumber);
                            saveDB();

                            await sock.sendMessage(remoteJid, {
                                text: `✓ تم تسجيل العضو @${targetPhone} كإضافة شرعية باللقب [${nickname}] برتبة ${db.users[targetPhone].rank}.`,
                                mentions: [targetJid]
                            });

                            if (db.groups["الورك"]) {
                                const workForm = `> _إسـتـمـارة الـورك ⚜️_\n\n_الـࢪقـم 🌿  ⟦ ${targetPhone} ⟧_\n_اللقب 🖋  ⟦ ${nickname} ⟧_\n_الحالة ⚡ ⟦ جديد (مباشر) ⟧_\n_مـن طـࢪف 🪽 ⟦ ${source} ⟧_\n_المسؤول ⚜️ ⟦ @${senderNumber} ⟧_\n\n_┇━──╌ •⤣⚕️⤤• ╌──━┇⌬_`;
                                await sock.sendMessage(db.groups["الورك"], { text: workForm, mentions: [senderJid, targetJid] });
                            }

                            const welcomeForm = `_❀✦═══ •『⚕️』• ═══✦❀_\n『𝑬.𝑳.𝑫⊰⚕️⊱𝑫𝑰𝑴𝑶𝑵𝑫』\n_〖نـجـم جـديـد『✨』 فـي سـمـائـنـا〗_\n\n_❀✦═══ •『⚕️』• ═══✦❀_\n\n_♡ بأجمل باقات الورد والياسمين نستقبلك وأجمل عبارات ترحيب نهديك أسعدنا وجودك معنا 🌸✨_\n\n_☆ اللقب👤:『${nickname}』_\n_☆ منشن📧:『@${targetPhone}』_\n\n_• نرجو منك دخول رابط الاعلانات ✨._『🗞️』\n_『https://chat.whatsapp.com/Kt3TCZLxP2U24cqK4JZHhV』_\n\n~_❀✦═══ •『⚕️』• ═══✦❀_~\n\n~『𝑬.𝑳.𝑫⊰⚕️⊱𝑫𝑰𝑴𝑶𝑵𝑫』~`;
                            await sock.sendMessage(db.groups["الاساسي"] || remoteJid, { text: welcomeForm, mentions: [targetJid] });

                            if (db.pendingJoins && db.pendingJoins[targetPhone]) {
                                delete db.pendingJoins[targetPhone]; saveDB();
                            }
                            return;
                        }
                    }
                } catch (err) { console.log("خطأ استمارة الإضافة", err); }
            }

            // ==================================================
            // 👑 أمر .تم العادي
            // ==================================================
            if (privileged && text.startsWith(".تم")) {
                const match = text.match(/^\.تم\s*\((.*?)\)\s*\((.*?)\)/);
                if (match) {
                    const nickname = match[1].trim();
                    const source = match[2].trim();
                    const mentioned = getMentionedJid(msg);
                    if (!mentioned) { await sock.sendMessage(remoteJid, { text: "⚠️ لازم تعمل منشن للعضو." }); return; }
                    const target = cleanPhone(mentioned);
                    const taken = Object.values(db.users).some((u) => u.nickname === nickname && u.phone !== target);
                    if (taken) { await sock.sendMessage(remoteJid, { text: `❌ اللقب "${nickname}" مشغول، اختار غيره.` }); return; }

                    const oldUser = db.users[target];
                    db.users[target] = {
                        ...(oldUser || {}), phone: target, jid: mentioned, nickname: nickname,
                        rank: oldUser?.rank || "E", joinedAt: oldUser?.joinedAt || Date.now(),
                        messagesTotal: Number(oldUser?.messagesTotal || 0), messagesToday: Number(oldUser?.messagesToday || 0),
                        lastMessageDay: oldUser?.lastMessageDay || getToday(), isTaught: oldUser?.isTaught || false,
                        demotionPaused: oldUser?.demotionPaused || false, rankStartDate: oldUser?.rankStartDate || Date.now(),
                        rankMessages: Number(oldUser?.rankMessages || 0), rankEvents: Number(oldUser?.rankEvents || 0),
                        rankMembers: Number(oldUser?.rankMembers || 0), rankHistory: oldUser?.rankHistory || [],
                        source: source, registeredBy: senderNumber, isDormant: oldUser?.isDormant || false
                    };

                    incrementUserRankMembers(senderNumber);
                    saveDB();
                    await sock.sendMessage(remoteJid, { text: `✓ هذا اللقب شاغر وتم تسجيل @${target} برتبة ${db.users[target].rank}.`, mentions: [mentioned] });

                    if (db.groups["الورك"]) {
                        const workForm = `> _إسـتـمـارة الـورك ⚜️_\n\n_الـࢪقـم 🌿  ⟦ ${target} ⟧_\n_اللقب 🖋  ⟦ ${nickname} ⟧_\n_الحالة ⚡ ⟦ جديد ⟧_\n_مـن طـࢪف 🪽 ⟦ ${source} ⟧_\n_المسؤول ⚜️ ⟦ @${senderNumber} ⟧_\n\n_┇━──╌ •⤣⚕️⤤• ╌──━┇⌬_`;
                        await sock.sendMessage(db.groups["الورك"], { text: workForm, mentions: [senderJid, mentioned] });
                    }

                    if (db.groups["الاساسي"]) {
                        const welcomeForm = `_❀✦═══ •『⚕️』• ═══✦❀_\n『𝑬.𝑳.𝑫⊰⚕️⊱𝑫𝑰𝑴𝑶𝑵𝑫』\n_〖نـجـم جـديـد『✨』 فـي سـمـائـنـا〗_\n\n_❀✦═══ •『⚕️』• ═══✦❀_\n\n_♡ بأجمل باقات الورد والياسمين نستقبلك وأجمل عبارات ترحيب نهديك أسعدنا وجودك معنا 🌸✨_\n\n_☆ اللقب👤:『${nickname}』_\n_☆ منشن📧:『@${target}』_\n\n_• نرجو منك دخول رابط الاعلانات ✨._『🗞️』\n_『https://chat.whatsapp.com/Kt3TCZLxP2U24cqK4JZHhV』_\n\n~_❀✦═══ •『⚕️』• ═══✦❀_~\n\n~『𝑬.𝑳.𝑫⊰⚕️⊱𝑫𝑰𝑴𝑶𝑵𝑫』~`;
                        await sock.sendMessage(db.groups["الاساسي"], { text: welcomeForm, mentions: [mentioned] });
                    }

                    if (db.pendingJoins && db.pendingJoins[target]) { delete db.pendingJoins[target]; saveDB(); }
                    return;
                }
            }

            if (privileged && text.startsWith(".تم التعلم")) {
                const mentioned = getMentionedJid(msg);
                if (!mentioned) { await sock.sendMessage(remoteJid, { text: "⚠️ اعمل منشن للعضو." }); return; }
                const target = cleanPhone(mentioned);
                if (!db.users[target]) { await sock.sendMessage(remoteJid, { text: "❌ العضو غير مسجل في قاعدة البيانات." }); return; }
                db.users[target].isTaught = true; saveDB();
                await sock.sendMessage(remoteJid, { text: `🎓 ✓ تم توثيق تعلم العضو @${target}.`, mentions: [mentioned] });
                return;
            }

            if (text.startsWith(".فحص لقب ") || text.startsWith(".فحص اللقب ")) {
                const title = text.replace(".فحص اللقب ", "").replace(".فحص لقب ", "").trim();
                if (!title) return;
                const taken = Object.values(db.users).some(u => u.nickname === title);
                await sock.sendMessage(remoteJid, { text: taken ? "❌ هذا اللقب مشغول، اختار غيره." : "✓ هذا اللقب شاغر." });
                return;
            }

            const promotion = updateAutomaticRank(user);
            if (promotion) {
                await sock.sendMessage(remoteJid, { text: `🎉 *ترقية تلقائية!*\n\nمبروك يا @${senderNumber} 👑\n📈 ${promotion.oldRank} → ${promotion.newRank}`, mentions: [senderJid] });
                if (db.groups["الاعلانات"]) {
                    const rankForm = `❅━•─•─•⊰ ✦ ﹝⚕️﹞ ✦ ⊱•─•─•─•━❅\n\n⊆ 📜 إشــعــار تــرقــيــة ⊇ ⤹ ✎ᝰ\n\n⏤͟͟͞͞⟡┆⊑ تــهــانــيــنــا ⊒ ⤿\n\n❏↵ الــعــضــو ⇄『@${senderNumber}』⇣\n\n〄━ ─═━⌬〔♦︎⃟⚕️〕 ⌬━ ─═━〄\n\n↳ 🎖️ الــرتــبــة الــســابــقــة ↶\n【 ${promotion.oldRank} 】\n\n↳ 🏆 الــرتــبــة الــجــديــدة ↶\n【 ${promotion.newRank} 】\n\n〄━ ─═━⌬ 〔♦︎⃟⚕️〕⌬━ ─═━〄\n\n> بـنـاءً عـلـى إلـتـزامـك بـنـظـام الـتـرقـيـات\n> تـمـت تـرقـيـتـك.. نـتـمـنـى لـك إحـراز\n> الـمـزيـد مـن الـتـقـدم! 🎉\n\n❃━──◈──━❃\n\n👤 ↲ الــمــســؤول ↶\n【BOT】\n\n『 𝗘. 𝗟. 𝗗⊰⚕️⊱𝐃𝐈𝐀𝐌𝐎𝐍𝐃 』`;
                    await sock.sendMessage(db.groups["الاعلانات"], { text: rankForm, mentions: [senderJid] });
                }
            }

            const setMatch = text.match(/^\.تعيين\s+(.+)$/);
            const removeMatch = text.match(/^\.إلغاء\s+(.+)$/) || text.match(/^\.الغاء\s+(.+)$/);
            const validGroups = ["الاساسي", "الاستقبال", "الورك", "الاعلانات", "تعليم الجدد"];

            if (privileged && setMatch) {
                const groupName = setMatch[1].trim();
                if (validGroups.includes(groupName)) {
                    db.groups[groupName] = remoteJid; saveDB();
                    await sock.sendMessage(remoteJid, { text: `✅ تم تعيين هذه المجموعة كـ [ ${groupName} ].` });
                }
                return;
            }

            if (privileged && removeMatch) {
                const groupName = removeMatch[1].trim();
                if (validGroups.includes(groupName)) {
                    delete db.groups[groupName]; saveDB();
                    await sock.sendMessage(remoteJid, { text: `🗑️ تم إلغاء تعيين [ ${groupName} ].` });
                }
                return;
            }

            if (text === ".محفظتي") {
                const rank = getRankForIdentity(senderJid, senderNumber, user);
                await sock.sendMessage(remoteJid, {
                    text: `💰 *محفظتي*\n━━━━━━━━━━━━━━━━━━\n\n👤 @${senderNumber}\n🏷️ اللقب: ${user.nickname}\n🎗️ الرتبة: ${rank}\n💳 الرصيد: ${royal ? "♾️" : `${user.bank || 0}$`}\n📊 إجمالي الرسائل: ${user.messagesTotal}\n🎯 الفعاليات: ${user.events}`,
                    mentions: [senderJid]
                });
                return;
            }

            if (text.startsWith(".تحويل")) {
                const match = text.match(/^\.تحويل\s+(\d+)\s+لـ\s+@(\d+)/);
                if (match) {
                    const amount = parseInt(match[1]);
                    const targetNumber = match[2];
                    const targetJid = `${targetNumber}@s.whatsapp.net`;
                    if (amount <= 0) { await sock.sendMessage(remoteJid, { text: "⚠️ المبلغ يجب أن يكون أكبر من 0." }); return; }
                    const receiver = ensureUser(targetNumber, targetJid);
                    if (!receiver) { await sock.sendMessage(remoteJid, { text: "❌ المستلم غير موجود في قاعدة البيانات." }); return; }
                    if (senderNumber === targetNumber) { await sock.sendMessage(remoteJid, { text: "⚠️ لا يمكنك تحويل الرصيد لنفسك." }); return; }
                    if (royal) { await sock.sendMessage(remoteJid, { text: "👑 الأموال الملكية لا تخضع للتحويل." }); return; }
                    if ((user.bank || 0) < amount) { await sock.sendMessage(remoteJid, { text: `⚠️ رصيدك غير كافي.\n💰 رصيدك: ${user.bank || 0}$` }); return; }

                    user.bank = (user.bank || 0) - amount;
                    receiver.bank = (receiver.bank || 0) + amount;
                    const transferId = Date.now();
                    db.transfers[transferId] = { from: senderNumber, to: targetNumber, amount: amount, date: new Date().toISOString() };
                    saveDB();
                    await sock.sendMessage(remoteJid, { text: `💸 *تم التحويل بنجاح!*\n━━━━━━━━━━━━━━━━━━\n\n📤 من: @${senderNumber}\n📥 إلى: @${targetNumber}\n💰 المبلغ: ${amount}$\n📊 رصيدك المتبقي: ${user.bank}$\n📋 رقم العملية: ${transferId}`, mentions: [senderJid, targetJid] });
                    return;
                }
            }

            if (text === ".بطاقتي") {
                const now = Date.now();
                if (!royal && cardCooldowns[senderNumber] && now - cardCooldowns[senderNumber] < 180000) {
                    const left = Math.ceil((180000 - (now - cardCooldowns[senderNumber])) / 1000);
                    await sock.sendMessage(remoteJid, { text: `⏳ يمكنك استخدام البطاقة بعد ${left} ثانية.` }); return;
                }
                cardCooldowns[senderNumber] = now;
                const inactive = now - (user.lastMessageAt || 0) > 5 * 60 * 60 * 1000;
                const rank = getRankForIdentity(senderJid, senderNumber, user);
                const joined = user.joinedAt ? new Date(user.joinedAt).toLocaleDateString("ar") : "غير معروف";
                const card = `『 🪪 بطاقة العضو 』\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n📧 منشن ┊ @${senderNumber}\n🆔 المعرف ┊ ${user.nickname}\n🎗️ الرتبة ┊ ${rank}\n📅 تاريخ الانضمام ┊ ${joined}\n⚡ الحالة ┊ ${inactive ? "نائم 😴" : "نشط ⚡"}\n💬 رسائل اليوم ┊ ${user.messagesToday || 0}\n\n📨 إجمالي الرسائل ┊ ${user.messagesTotal || 0}\n💰 الرصيد ┊ ${royal ? "♾️" : `${user.bank || 0}$`}\n\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬`;
                await sock.sendMessage(remoteJid, { text: card, mentions: [senderJid] });
                return;
            }

            if (text === ".حسبة" && privileged) {
                let report = `📊 *حسبة أعضاء 𝑬.𝑳.𝑫*\n\n━━━━━━━━━━━━━━━━━━\n\n`;
                const mentions = [];
                for (const p of metadata.participants) {
                    const jid = getParticipantJid(p);
                    if (!jid) continue;
                    const phone = cleanPhone(jid);
                    let u = findUserByJid(jid);
                    if (!u) u = ensureUser(phone, jid);
                    if (u.isDormant) continue;
                    const rank = getRankForIdentity(jid, phone, u);
                    const name = u.nickname && u.nickname !== "غير محدد" ? u.nickname : "غير محدد";
                    report += `👤 @${phone}\n🆔 اللقب: ${name}\n🎗️ الرتبة: ${rank}\n📅 اليوم: ${u.messagesToday || 0}\n📨 الإجمالي: ${u.messagesTotal || 0}\n\n`;
                    mentions.push(jid);
                }
                report += `━━━━━━━━━━━━━━━━━━\n👥 عدد أعضاء المجموعة: ${metadata.participants.length}`;
                await sock.sendMessage(remoteJid, { text: report, mentions });
                return;
            }

            if (text === ".كم لترقيتي") {
                if (user.isDormant) { await sock.sendMessage(remoteJid, { text: `⏸️ أنت مسكن، اطلب من الإمبراطور تنشيطك بـ .تنشيط @${senderNumber}`, mentions: [senderJid] }); return; }
                const currentRank = user.rank || "E";
                const rankOrder = ["E", "D", "C", "B", "A", "S"];
                const currentIndex = rankOrder.indexOf(currentRank);
                if (currentIndex >= rankOrder.length - 1) {
                    await sock.sendMessage(remoteJid, { text: `🏆 *معلومات ترقيتك*\n\n👤 @${senderNumber}\n🎗️ رتبتك الحالية: *${currentRank}*\n🌟 أنت في أعلى رتبة!`, mentions: [senderJid] });
                    return;
                }
                const nextRank = rankOrder[currentIndex + 1];
                const req = RANK_REQUIREMENTS[currentRank];
                if (!req) return;
                const remainingMessages = Math.max(0, req.messages - user.rankMessages);
                const remainingEvents = Math.max(0, req.events - user.rankEvents);
                const remainingDays = Math.max(0, req.days - Math.floor((Date.now() - user.rankStartDate) / (1000 * 60 * 60 * 24)));
                await sock.sendMessage(remoteJid, { text: `📊 *معلومات ترقيتك*\n━━━━━━━━━━━━━━━━━━\n\n👤 @${senderNumber}\n🎗️ الرتبة الحالية: *${currentRank}*\n⬆️ الرتبة القادمة: *${nextRank}*\n\n📋 المهام المتبقية:\n💬 رسائل: ${remainingMessages}\n🎯 فعاليات: ${remainingEvents}\n⏳ أيام: ${remainingDays}\n\n📊 تقدمك:\n💬 ${user.rankMessages}/${req.messages}\n🎯 ${user.rankEvents}/${req.events}`, mentions: [senderJid] });
                return;
            }

            if (privileged && text.startsWith(".طرد")) {
                const mentioned = getMentionedJid(msg) || getQuotedParticipant(msg);
                if (!mentioned) { await sock.sendMessage(remoteJid, { text: "⚠️ اعمل منشن أو رد على رسالة الشخص." }); return; }
                const target = cleanPhone(mentioned);
                const permanent = text.includes("مؤبد");
                try { await sock.groupParticipantsUpdate(remoteJid, [mentioned], "remove"); } catch {}
                if (permanent) { db.banned[target] = true; saveDB(); }
                if (db.groups["الورك"]) await sock.sendMessage(db.groups["الورك"], { text: permanent ? `⛔ تم طرد @${target} طرداً مؤبداً.` : `🚪 تم طرد @${target} طرداً مؤقتاً.`, mentions: [mentioned] });
                return;
            }

            // ==================================================
            // 🗑️ حذف رسائل (لرتبة C فما فوق)
            // ==================================================
            if (text.startsWith(".حذف")) {
                const isRankCPlus = user && ["C", "B", "A", "S"].includes(user.rank);
                if (!privileged && !isRankCPlus && !emperor) return; // الحذف متاح من رتبة C للمشرفين والملكيات
                
                const amountMatch = text.match(/^\.حذف\s*(\d+)/);
                const amount = amountMatch ? parseInt(amountMatch[1]) : 10;
                const mentioned = getMentionedJid(msg);
                const quoted = getQuotedParticipant(msg);
                const targetJid = mentioned || quoted;

                if (!targetJid) { await sock.sendMessage(remoteJid, { text: "⚠️ اعمل منشن للشخص أو رد على رسالته." }); return; }
                const target = cleanPhone(targetJid);
                let deleted = 0;
                const cache = messageCache[remoteJid] || [];

                for (let i = cache.length - 1; i >= 0; i--) {
                    if (cache[i].sender === target) {
                        try { await sock.sendMessage(remoteJid, { delete: cache[i].key }); deleted++; } catch {}
                        if (deleted >= amount) break;
                    }
                }
                await sock.sendMessage(remoteJid, { text: `🗑️ تم حذف ${deleted} رسالة من @${target}.`, mentions: [targetJid] });
                return;
            }

            if (text === ".المتجر") {
                if (user.isDormant) { await sock.sendMessage(remoteJid, { text: "⏸️ أنت مسكن، لا يمكنك استخدام المتجر." }); return; }
                if (!royal && !["D", "C", "B", "A", "S"].includes(user.rank)) { await sock.sendMessage(remoteJid, { text: "⚠️ المتجر متاح من رتبة D فما فوق." }); return; }
                if (!royal && !db.shop.is_open) { await sock.sendMessage(remoteJid, { text: "🔒 المتجر مغلق حالياً." }); return; }
                const now = Date.now();
                if (!royal && shopCooldowns[senderNumber] && now - shopCooldowns[senderNumber] < 1800000) {
                    const left = Math.ceil((1800000 - (now - shopCooldowns[senderNumber])) / 60000);
                    await sock.sendMessage(remoteJid, { text: `⏳ يمكنك طلب المتجر بعد ${left} دقيقة.` }); return;
                }
                shopCooldowns[senderNumber] = now;
                await sock.sendMessage(remoteJid, { text: `🛒 *متجر 𝑬.𝑳.𝑫*\n━━━━━━━━━━━━━━━━━━\n\n🎭 تخريب لقب لمدة 3 أيام\n💰 السعر: ${db.shop.title_ruin}$\n\n✒️ تغيير اللقب\n🎁 المرة الأولى: مجاناً\n💰 بعد ذلك: ${db.shop.title_change}$\n\n📅 إجازة يوم واحد\n💰 السعر: ${db.shop.vacation_1day}$\n\n📅 إجازة يومين\n💰 السعر: ${db.shop.vacation_2days}$\n\n📅 إجازة أسبوع\n💰 السعر: ${db.shop.vacation_1week}$\n\n━━━━━━━━━━━━━━━━━━\n💰 رصيدك:\n${royal ? "♾️ أموال ملكية" : `${user.bank || 0}$`}` });
                return;
            }

            if (text === ".ارمي النرد") { await sock.sendMessage(remoteJid, { text: `🎲 رميت النرد وطلعت: *${Math.floor(Math.random() * 6) + 1}*` }); return; }
            if (text === ".ارمي عملة") { await sock.sendMessage(remoteJid, { text: `🪙 النتيجة: *${Math.random() < 0.5 ? "🪙 صورة" : "📜 كتابة"}*` }); return; }
            if (text === ".حظي") { await sock.sendMessage(remoteJid, { text: `✨ نسبة حظك اليوم: *${Math.floor(Math.random() * 101)}%*` }); return; }
            if (text === ".عشوائي") {
                const participants = metadata.participants.filter(p => cleanPhone(getParticipantJid(p)) !== senderNumber);
                if (!participants.length) return;
                const random = participants[Math.floor(Math.random() * participants.length)];
                const randomJid = getParticipantJid(random);
                await sock.sendMessage(remoteJid, { text: `🎯 العضو المختار عشوائياً: @${cleanPhone(randomJid)}`, mentions: [randomJid] });
                return;
            }
            if (text === ".سلوت") {
                const icons = ["🍒", "🍋", "⭐", "💎", "7️⃣"];
                const a = icons[Math.floor(Math.random() * icons.length)], b = icons[Math.floor(Math.random() * icons.length)], c = icons[Math.floor(Math.random() * icons.length)];
                await sock.sendMessage(remoteJid, { text: `🎰 *سلوت*\n\n┃ ${a} ┃ ${b} ┃ ${c} ┃\n\n${a === b && b === c ? "🎉 جاك بوت!" : "😅 حظ أوفر المرة الجاية."}` });
                return;
            }
            if (text === ".نكتة") {
                const jokes = ["😂 مرة واحد سأل البوت: 'كم الساعة؟' قاله: 'حسب رغبتك!'", "🤣 قالو للبوت: 'شوفلك شغل!' قال: 'أنا شغلي أرد على الأسئلة الغبية!'"];
                await sock.sendMessage(remoteJid, { text: jokes[Math.floor(Math.random() * jokes.length)] }); return;
            }
            if (text === ".احزر") {
                if (!db.userGames) db.userGames = {};
                db.userGames[senderNumber] = { guessNumber: Math.floor(Math.random() * 11), attempts: 0 }; saveDB();
                await sock.sendMessage(remoteJid, { text: `🔢 *لعبة خمن الرقم!*\n\nأرسل رقم من 0 إلى 10\n💡 لديك 3 محاولات` }); return;
            }

            if (db.userGames && db.userGames[senderNumber] && db.userGames[senderNumber].guessNumber !== undefined) {
                const game = db.userGames[senderNumber];
                const guess = parseInt(text);
                if (!isNaN(guess) && guess >= 0 && guess <= 10) {
                    game.attempts++;
                    if (guess === game.guessNumber) {
                        user.bank = (user.bank || 0) + 5; saveDB(); delete db.userGames[senderNumber];
                        await sock.sendMessage(remoteJid, { text: `🎉 *أحسنت!*\nالرقم كان *${game.guessNumber}*\n✅ حصلت على 5$ مكافأة!` });
                    } else if (game.attempts >= 3) {
                        delete db.userGames[senderNumber];
                        await sock.sendMessage(remoteJid, { text: `😅 انتهت محاولاتك!\nالرقم كان *${game.guessNumber}*` });
                    } else {
                        await sock.sendMessage(remoteJid, { text: `❌ خطأ!\n💡 تلميح: الرقم ${guess < game.guessNumber ? "أكبر" : "أصغر"} من ${guess}\n🔄 متبقي ${3 - game.attempts} محاولات` });
                    }
                    saveDB(); return;
                }
            }

            const canStartEvent = royal || (user.isTaught || ["C", "B", "A", "S"].includes(user.rank));
            if (canStartEvent && text === ".فعالية الاعلام بدت") {
                const random = FLAGS_LIST[Math.floor(Math.random() * FLAGS_LIST.length)];
                db.active_event = { type: "flags", running: true, host: senderNumber, groupJid: remoteJid, targetFlag: random[1], targetEmoji: random[0], participants: {}, totalWins: 0 };
                saveDB();
                await sock.sendMessage(remoteJid, { text: `🚩 *بدأت فعالية الأعلام!*\n\nاكتب اسم الدولة التي يمثلها العلم:\n\n${random[0]}` }); return;
            }

            if (canStartEvent && text === ".فعالية الاعلام انتهت" && db.active_event?.type === "flags") {
                const event = db.active_event; event.running = false;
                const results = Object.entries(event.participants || {}).sort((a, b) => b[1] - a[1]);
                let report = `🏁 *انتهت فعالية الأعلام*\n━━━━━━━━━━━━━━━━━━\n\n🏆 النتائج:\n\n`;
                const mentions = [];
                results.forEach(([phone, wins], index) => {
                    const u = db.users[phone];
                    report += `${index + 1}. @${phone} | ${wins} فوز\n`;
                    if (u && !u.isDormant) { u.events = (u.events || 0) + wins; u.bank = (u.bank || 0) + Math.floor(wins / 20) * 5; u.rankEvents = (u.rankEvents || 0) + wins; }
                    mentions.push(jidFromNumber(phone));
                });
                report += `\n━━━━━━━━━━━━━━━━━━\n🎯 إجمالي الإجابات: ${event.totalWins || 0}`;
                db.active_event = null; saveDB();
                if (db.groups["الاعلانات"]) await sock.sendMessage(db.groups["الاعلانات"], { text: report, mentions });
                await sock.sendMessage(remoteJid, { text: "🏁 تم إنهاء فعالية الأعلام وتسجيل النتائج." }); return;
            }

            if (db.active_event?.running && db.active_event.type === "flags" && db.active_event.groupJid === remoteJid && text === db.active_event.targetFlag) {
                const event = db.active_event;
                if (!event.participants[senderNumber]) event.participants[senderNumber] = 0;
                event.participants[senderNumber]++; event.totalWins = (event.totalWins || 0) + 1;
                const wins = event.participants[senderNumber]; let reward = "";
                if (wins % 20 === 0) { user.bank = (user.bank || 0) + 5; user.rankEvents = (user.rankEvents || 0) + 20; reward = "\n🎉 حصلت على مكافأة 5$ لإكمال 20 فوز!"; }
                const next = FLAGS_LIST[Math.floor(Math.random() * FLAGS_LIST.length)];
                event.targetFlag = next[1]; event.targetEmoji = next[0]; saveDB();
                await sock.sendMessage(remoteJid, { text: `✅ إجابة صحيحة يا @${senderNumber}!\n\n🏆 عدد انتصاراتك: ${wins}\n${reward}\n\n🚩 العلم التالي:\n${next[0]}`, mentions: [senderJid] }); return;
            }

            if (canStartEvent && text === ".فعالية كتابة بدت") {
                db.active_event = { type: "text", running: true, host: senderNumber, groupJid: remoteJid, targetText: null, winners: [], participants: {}, winsCount: 0 };
                saveDB(); await sock.sendMessage(remoteJid, { text: "🟢 تم تشغيل فعالية الكتابة.\n\nأرسل استمارة الفعالية الآن." }); return;
            }

            if (db.active_event?.running && db.active_event.type === "text" && senderNumber === db.active_event.host) {
                const match = text.match(/النص\s*⟬(.*?)⟭/);
                if (match) { db.active_event.targetText = match[1].trim(); saveDB(); await sock.sendMessage(remoteJid, { text: `🎯 تم اعتماد النص:\n\n*${db.active_event.targetText}*` }); return; }
            }

            if (db.active_event?.running && db.active_event.type === "text" && db.active_event.groupJid === remoteJid && db.active_event.targetText && text === db.active_event.targetText) {
                const event = db.active_event; event.winsCount = (event.winsCount || 0) + 1;
                if (!event.participants[senderNumber]) event.participants[senderNumber] = 0;
                event.participants[senderNumber]++; if (!event.winners.includes(senderNumber)) event.winners.push(senderNumber);
                event.targetText = null; saveDB();
                await sock.sendMessage(remoteJid, { text: `✅ إجابة صحيحة من @${senderNumber}!\n\n🏆 الفعالية رقم ${event.winsCount}`, mentions: [senderJid] }); return;
            }

            if (canStartEvent && text === ".فعالية كتابة انتهت" && db.active_event?.type === "text") {
                const event = db.active_event; event.running = false; const winners = event.winners || [];
                let report = `*◉━━━─ •༺ إنــتَـ🎉ــهَــت ༻• ─━━━◉*\n\n*⧉┊✠ الــفـائــ💫ــزون ↶*\n\n🥇 ${winners[0] ? `@${winners[0]}` : ""}\n\n🥈 ${winners[1] ? `@${winners[1]}` : ""}\n\n🥉 ${winners[2] ? `@${winners[2]}` : ""}\n\n*❃━──◈──━❃*\n\n*✗ ↲عدد الفـعـاليــات🧧↶*\n*【${event.winsCount || 0}】*\n\n*✗ ↲نـوع الفـعـاليــة🎗↶*\n*【كتابة】*\n\n*✗ ↲الــجــائــزة💸↶*\n*【10$ لكل عضو فائز】*`;
                const mentions = winners.map(n => jidFromNumber(n));
                winners.forEach(phone => { const u = ensureUser(phone); if (u && !u.isDormant) { u.bank = (u.bank || 0) + 10; u.rankEvents = (u.rankEvents || 0) + 1; } });
                db.active_event = null; saveDB();
                if (db.groups["الاعلانات"]) await sock.sendMessage(db.groups["الاعلانات"], { text: report, mentions });
                await sock.sendMessage(remoteJid, { text: "🏁 انتهت الفعالية وتم إرسال التقرير للإعلانات." }); return;
            }

            // 👑 تحكم الإمبراطور
            if (emperor) {
                if (text === ".تحكم الرتب") {
                    await sock.sendMessage(remoteJid, { text: `👑 *لوحة التحكم بالرتب*\n\nالنقابة: E → D → C → B → A → S\n\n⚙️ أوامر التحكم:\n.تعيين_ملكي [الرتبة] @منشن\n.ترقية_تخطي @منشن [E/D/C/B/A/S]\n.وقف من @منشن\n.استمرار من @منشن\n.تغيير الرقم من @قديم الي @جديد\n.تنشيط @منشن\n.سكون @منشن` });
                    return;
                }
                if (text.startsWith(".تعيين_ملكي")) {
                    const mentioned = getMentionedJid(msg);
                    if (!mentioned) return;
                    const rank = Object.keys(db.royals).find(r => text.startsWith(`.تعيين_ملكي ${r}`));
                    if (!rank) { await sock.sendMessage(remoteJid, { text: "❌ اسم الرتبة غير صحيح." }); return; }
                    const target = cleanPhone(mentioned);
                    db.royals[rank] = target;
                    const u = ensureUser(target, mentioned); u.rank = rank; u.isDormant = false; saveDB();
                    await sock.sendMessage(remoteJid, { text: `👑 تم تعيين @${target} في منصب ${rank}.`, mentions: [mentioned] }); return;
                }
                if (text.startsWith(".ترقية_تخطي")) {
                    const mentioned = getMentionedJid(msg); const parts = text.split(/\s+/); const rank = parts[2]?.toUpperCase();
                    if (!mentioned || !RANKS.includes(rank)) return;
                    const target = cleanPhone(mentioned); const u = ensureUser(target, mentioned);
                    if (u.isDormant) return;
                    u.rank = rank; u.rankStartDate = Date.now(); u.rankMessages = 0; u.rankEvents = 0; u.rankMembers = 0; saveDB();
                    await sock.sendMessage(remoteJid, { text: `👑 تم ترقية @${target} إلى ${rank}.`, mentions: [mentioned] }); return;
                }
                if (text.startsWith(".وقف من")) {
                    const mentioned = getMentionedJid(msg); if (!mentioned) return;
                    ensureUser(cleanPhone(mentioned), mentioned).demotionPaused = true; saveDB();
                    await sock.sendMessage(remoteJid, { text: `⏸️ تم إيقاف مهلة نزول @${cleanPhone(mentioned)}.`, mentions: [mentioned] }); return;
                }
                if (text.startsWith(".استمرار من")) {
                    const mentioned = getMentionedJid(msg); if (!mentioned) return;
                    ensureUser(cleanPhone(mentioned), mentioned).demotionPaused = false; saveDB();
                    await sock.sendMessage(remoteJid, { text: `▶️ تم استئناف مهلة نزول @${cleanPhone(mentioned)}.`, mentions: [mentioned] }); return;
                }
            }
        } catch (error) {
            if (error.message && error.message.includes('Bad MAC')) return;
            console.log("❌ خطأ أثناء معالجة الرسالة:", error.message);
        }
    });

    setInterval(async () => {
        try {
            const now = Date.now();
            for (const phone of Object.keys(db.users)) {
                const u = db.users[phone];
                if (u.ruinedUntil && now >= u.ruinedUntil) {
                    u.nickname = u.oldNickname || u.nickname; delete u.ruinedUntil; delete u.oldNickname; saveDB();
                    if (db.groups["الاعلانات"]) await sock.sendMessage(db.groups["الاعلانات"], { text: `✨ انتهت مدة تخريب لقب @${phone} وعاد لقبه الأصلي.`, mentions: [u.jid || jidFromNumber(phone)] });
                }
            }
            resetDailyCounters();
        } catch (e) {}
    }, 60 * 1000);
}

startELD().catch(error => console.error("❌ فشل تشغيل البوت:", error));

