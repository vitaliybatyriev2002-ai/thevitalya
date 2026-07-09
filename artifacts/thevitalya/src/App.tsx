import { useEffect, useRef, useState } from "react";
import "./index.css";
import accountAvatarVideo from "./assets/account-avatar.mp4";
import {
  MAX_LENGTH as GUESTBOOK_MAX_LENGTH,
  MAX_NICKNAME_LENGTH,
  getClientIp,
  hasSubmitted,
  subscribeToEntries,
  submitEntry,
  type GuestbookEntry,
} from "./lib/guestbook";
import {
  subscribeToAuthState,
  registerUser,
  loginUser,
  logoutUser,
  subscribeToPostList,
  createPost,
  subscribeToReplies,
  createReply,
  validateUsername,
  formatDate,
  uploadImage,
  toggleReaction,
  subscribeToUserReactions,
  postDocRef,
  replyDocRef,
  REACTION_EMOJIS,
  canModerate,
  canManageRoles,
  deletePost,
  deleteReply,
  subscribeToAllUsers,
  setUserRole,
  setUserBanned,
  type ForumUser,
  type ForumPost,
  type ForumReply,
  type ForumAdminUser,
} from "./lib/forum";

/* ══════════════════════════════════════
   XP STARTUP SOUND (Web Audio API)
══════════════════════════════════════ */
function playXPStartup() {
  try {
    const ctx = new AudioContext();

    const note = (
      freq: number,
      startSec: number,
      durSec: number,
      peakGain: number,
      type: OscillatorType = "sine",
    ) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      const t0   = ctx.currentTime + startSec;

      osc.type = type;
      osc.frequency.value = freq;

      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(peakGain, t0 + 0.04);
      gain.gain.setValueAtTime(peakGain, t0 + durSec * 0.6);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + durSec);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + durSec + 0.05);
    };

    /* Brian Eno–inspired XP startup approximation
       F major: low rumble → swell → bright chord */
    note(87.3,  0.00, 1.80, 0.18, "triangle"); // F2 rumble
    note(174.6, 0.00, 1.80, 0.10, "sine");     // F3 bass
    note(130.8, 0.10, 1.60, 0.08, "sine");     // C3

    note(261.6, 0.30, 1.40, 0.12, "sine");     // C4
    note(349.2, 0.30, 1.40, 0.10, "sine");     // F4
    note(440.0, 0.45, 1.20, 0.09, "sine");     // A4

    note(523.3, 0.65, 1.10, 0.14, "sine");     // C5 swell
    note(659.3, 0.80, 1.00, 0.10, "sine");     // E5
    note(698.5, 0.90, 0.90, 0.12, "sine");     // F5 top

    note(523.3, 0.95, 0.80, 0.06, "triangle"); // shimmer
    note(880.0, 1.05, 0.60, 0.04, "sine");     // A5 sparkle

    setTimeout(() => ctx.close(), 3000);
  } catch {
    /* AudioContext not available — ignore silently */
  }
}

/* ══════════════════════════════════════
   XP BOOT SCREEN
══════════════════════════════════════ */
function BootScreen({ onDone }: { onDone: () => void }) {
  const [done, setDone] = useState(false);

  useEffect(() => {
    let count = 0;
    const iv = setInterval(() => {
      count++;
      if (count >= 18) {
        clearInterval(iv);
        setTimeout(() => setDone(true), 400);
      }
    }, 105);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => onDone(), 50);
    return () => clearTimeout(t);
  }, [done, onDone]);

  return (
    <div className="boot-screen">
      <div className="boot-center">
        <div className="boot-logo-row">
          <div className="boot-flag">
            <div className="flag-q1" />
            <div className="flag-q2" />
            <div className="flag-q3" />
            <div className="flag-q4" />
          </div>
          <div className="boot-wordmark">
            <span className="boot-windows">Microsoft</span>
            <span className="boot-xp">Windows<em>XP</em></span>
            <span className="boot-edition">Professional</span>
          </div>
        </div>
        <div className="boot-bar-wrap">
          <div className="boot-bar">
            <div className="boot-bar-group">
              <div className="boot-bar-block" />
              <div className="boot-bar-block" />
              <div className="boot-bar-block" />
            </div>
          </div>
        </div>
      </div>
      <p className="boot-copy">Copyright © Microsoft Corporation</p>
    </div>
  );
}

/* ══════════════════════════════════════
   XP LOGON SCREEN — auto-play with animated cursor
══════════════════════════════════════ */
type AutoPhase =
  | "idle"
  | "moving-tile"
  | "selected"
  | "moving-arrow"
  | "loggingIn"
  | "done";

const ACCOUNT = { name: "theVITALYA", emoji: "🌐", avatarVideo: accountAvatarVideo as string | undefined, color: "#0a0f14", hint: "Администратор" };

function XpFlag({ size = 24 }: { size?: number }) {
  return (
    <div className="boot-flag" style={{ width: size, height: size, borderRadius: 3, gap: 2 }}>
      <div className="flag-q1" /><div className="flag-q2" />
      <div className="flag-q3" /><div className="flag-q4" />
    </div>
  );
}

/* XP-style arrow cursor rendered as SVG */
function XpCursor({ clicking }: { clicking: boolean }) {
  return (
    <svg
      width="22" height="26" viewBox="0 0 22 26"
      style={{ transform: clicking ? "scale(0.82)" : "scale(1)", transition: "transform .08s" }}
    >
      <polygon points="2,1 2,21 7,16 10,24 13,23 10,15 17,15" fill="black" />
      <polygon points="3,2.5 3,19 7.5,14.5 10.5,22 12,21.5 9,14 16,14" fill="white" />
    </svg>
  );
}

function LogonScreen({ onDone }: { onDone: () => void }) {
  const [autoPhase, setAutoPhase]     = useState<AutoPhase>("idle");
  const [cursorVisible, setCursorVisible] = useState(false);
  const [clicking, setClicking]       = useState(false);
  const [fadeOut, setFadeOut]         = useState(false);
  const [dots, setDots]               = useState(0);

  /* cursor position state – starts bottom-right area */
  const [curX, setCurX] = useState(0);
  const [curY, setCurY] = useState(0);
  const [ready, setReady] = useState(false);  /* true after first position set */

  const tileRef  = useRef<HTMLDivElement>(null);
  const arrowRef = useRef<HTMLButtonElement>(null);

  /* dot animation while logging in */
  useEffect(() => {
    if (autoPhase !== "loggingIn") return;
    const iv = setInterval(() => setDots((d) => (d + 1) % 4), 400);
    return () => clearInterval(iv);
  }, [autoPhase]);

  /* ── master timeline ── */
  useEffect(() => {
    const ts: ReturnType<typeof setTimeout>[] = [];
    const T = (fn: () => void, ms: number) => ts.push(setTimeout(fn, ms));

    /* t=0: place cursor off-screen bottom-right, invisible */
    setCurX(window.innerWidth  * 0.74);
    setCurY(window.innerHeight * 0.66);

    /* t=180: cursor fades in */
    T(() => { setReady(true); setCursorVisible(true); }, 180);

    /* t=430: move cursor toward user tile */
    T(() => {
      if (tileRef.current) {
        const r = tileRef.current.getBoundingClientRect();
        setCurX(r.left + 40);
        setCurY(r.top  + 38);
      }
      setAutoPhase("moving-tile");
    }, 430);

    /* t=870: arrive at tile → click flash → select */
    T(() => {
      setClicking(true);
      setTimeout(() => setClicking(false), 130);
      setAutoPhase("selected");
    }, 870);

    /* t=1080: arrow button rendered — move cursor to it */
    T(() => {
      if (arrowRef.current) {
        const r = arrowRef.current.getBoundingClientRect();
        setCurX(r.left + 16);
        setCurY(r.top  + 16);
      }
      setAutoPhase("moving-arrow");
    }, 1080);

    /* t=1300: click arrow → start login */
    T(() => {
      setClicking(true);
      setTimeout(() => setClicking(false), 130);
      setAutoPhase("loggingIn");
    }, 1300);

    /* t=1440: hide cursor */
    T(() => setCursorVisible(false), 1440);

    /* t=3550: begin fade-out */
    T(() => setFadeOut(true), 3550);

    /* t=4050: hand off to desktop */
    T(() => onDone(), 4050);

    return () => ts.forEach(clearTimeout);
  }, [onDone]);

  const isSelected  = autoPhase === "selected" || autoPhase === "moving-arrow";
  const isLoggingIn = autoPhase === "loggingIn" || autoPhase === "done";

  return (
    <div className={`logon-screen ${fadeOut ? "logon-fadeout" : ""}`}>

      {/* ── Background image (natural size, no stretch) ── */}
      <img src="/logon-bg.jpg" alt="" className="logon-bg" />

      {/* ── Animated XP cursor ── */}
      {cursorVisible && (
        <div
          className="xp-auto-cursor"
          style={{
            left: curX,
            top:  curY,
            opacity: ready ? 1 : 0,
            transition: ready
              ? "left .42s cubic-bezier(.25,.46,.45,.94), top .42s cubic-bezier(.25,.46,.45,.94), opacity .15s"
              : "none",
          }}
        >
          <XpCursor clicking={clicking} />
        </div>
      )}

      {/* ── Top banner ── */}
      <div className="logon-top">
        <div className="logon-top-left">
          <XpFlag size={28} />
          <div className="logon-top-wordmark">
            <span className="logon-top-windows">Microsoft</span>
            <span className="logon-top-xp">Windows<em>XP</em></span>
          </div>
        </div>
        <div className="logon-top-divider" />
        <p className="logon-top-hint">
          {isLoggingIn
            ? `Вход в систему${".".repeat(dots)}`
            : "Для начала щёлкните своё имя пользователя"}
        </p>
      </div>

      {/* ── Center panel ── */}
      <div className="logon-panel">
        {isLoggingIn ? (
          <div className="logon-loading" key="loading">
            <div className="logon-loading-avatar" style={{ background: ACCOUNT.color }}>
              <video
                className="logon-avatar-video"
                src={ACCOUNT.avatarVideo}
                autoPlay
                loop
                muted
                playsInline
              />
              <div className="logon-avatar-sheen" />
            </div>
            <p className="logon-loading-name">{ACCOUNT.name}</p>
            <div className="logon-progress-bar">
              <div className="logon-progress-fill" />
            </div>
            <p className="logon-loading-sub">Загрузка личных настроек…</p>
          </div>
        ) : (
          <div className="logon-accounts" key="accounts">
            <div
              ref={tileRef}
              className={`logon-tile ${isSelected ? "logon-tile-selected" : ""}`}
            >
              <div className="logon-avatar" style={{ background: ACCOUNT.color }}>
                <video
                  className="logon-avatar-video"
                  src={ACCOUNT.avatarVideo}
                  autoPlay
                  loop
                  muted
                  playsInline
                />
                <div className="logon-avatar-sheen" />
                {isSelected && <div className="logon-avatar-glow" />}
              </div>
              <div className="logon-tile-info">
                <p className="logon-tile-name">{ACCOUNT.name}</p>
                <p className="logon-tile-hint">{ACCOUNT.hint}</p>
                {isSelected && (
                  <div className="logon-tile-actions">
                    <button ref={arrowRef} className="logon-arrow-btn">
                      <span className="logon-arrow">›</span>
                    </button>
                    <span className="logon-arrow-hint">Вход…</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Bottom bar ── */}
      <div className="logon-bottom">
        <button className="logon-shutdown-btn">
          <span className="logon-shutdown-icon">⏻</span>
          <span>Выключить компьютер</span>
        </button>
        <p className="logon-bottom-hint">Для помощи нажмите Alt + F4 🙂</p>
        <div className="logon-bottom-right">
          <XpFlag size={20} />
          <span className="logon-bottom-copy">Microsoft Windows XP</span>
        </div>
      </div>
    </div>
  );
}

/* ─── Clock ─── */
function Clock() {
  const [time, setTime] = useState(() => new Date());
  useEffect(() => {
    const iv = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(iv);
  }, []);
  return (
    <span className="xp-clock">
      {time.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
    </span>
  );
}

/* ─── Taskbar ─── */
function Taskbar({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="xp-taskbar">
      <button className="xp-start" onClick={onOpen}>
        <span className="xp-start-logo">⊞</span>
        <span className="xp-start-text">Пуск</span>
      </button>

      <div className="xp-taskbar-divider" />

      <button className="xp-taskbar-btn" onClick={onOpen}>
        <span className="xp-taskbar-avatar">
          <video
            src={ACCOUNT.avatarVideo}
            autoPlay
            loop
            muted
            playsInline
          />
        </span>
        theVITALYA — Network Access
      </button>

      <div className="xp-taskbar-spacer" />

      <div className="xp-tray">
        <span title="Сеть">🔗</span>
        <span title="Звук">🔊</span>
        <Clock />
      </div>
    </div>
  );
}

/* ─── Desktop icons ─── */
const ICONS = [
  { label: "theVITALYA",    emoji: "🌐" },
  { label: "Корзина",       emoji: "🗑️" },
  { label: "здесь был...",  emoji: "📃" },
  { label: "Форум",         emoji: "💬" },
];

/* ─── Telegram links ─── */
const LINKS = [
  { name: "N'USELESS Chat",      cyrillic: "Основной чат общения",  icon: "✈️", url: "https://t.me/n_useless" },
  { name: "perforatorSKIE",      cyrillic: "Канал",                  icon: "📡", url: "https://t.me/useless_mlbb" },
  { name: "БУСТМЛББ.РФ",        cyrillic: "Телеграм бот",           icon: "🤖", url: "https://t.me/boostmlbbrf_bot" },
  { name: "БУСТМЛББ.РФ",        cyrillic: "Сайт",                   icon: "🌐", url: "https://бустмлбб.рф" },
  { name: "n'useless BOT n.1 👽", cyrillic: "Развлекательный бот",  icon: "👾", url: "https://t.me/NUSELESS_BOT" },
];

/* Height of the fixed bottom taskbar (.xp-taskbar) in px — kept in sync with index.css */
const TASKBAR_HEIGHT = 36;

/* ─── Reusable drag hook ─── */
function useDrag(initOffset = { x: 0, y: 0 }) {
  const ref  = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // On mobile, skip JS positioning — CSS media query handles layout
    if (window.innerWidth <= 600) {
      setReady(true);
      return;
    }
    // Keep the window's bottom edge above the fixed taskbar (36px, z-index
    // above windows) so footer controls like the reply form's send button
    // never end up hidden underneath it.
    const availableHeight = window.innerHeight - TASKBAR_HEIGHT;
    const maxLeft = Math.max(0, window.innerWidth  - el.offsetWidth);
    const maxTop  = Math.max(0, availableHeight - el.offsetHeight);
    const left = (window.innerWidth  - el.offsetWidth)  / 2 + initOffset.x;
    const top  = (availableHeight - el.offsetHeight) / 2 + initOffset.y;
    el.style.left = Math.min(Math.max(0, left), maxLeft) + "px";
    el.style.top  = Math.min(Math.max(0, top),  maxTop)  + "px";
    setReady(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Dragging is disabled; kept as a no-op so existing call sites don't need to change. */
  const onDragStart = (_e: React.PointerEvent<HTMLDivElement>) => {};

  const winStyle: React.CSSProperties = ready
    ? { position: "fixed" }
    : { position: "fixed", visibility: "hidden" };

  return { ref, winStyle, onDragStart };
}

/* ─── XP Window ─── */
function XPWindow({
  onClose,
  zIndex,
  onFocus,
  onOpenLink,
}: {
  onClose: () => void;
  zIndex: number;
  onFocus: () => void;
  onOpenLink: (link: { name: string; url: string }) => void;
}) {
  const [minimized, setMinimized] = useState(false);
  const { ref, winStyle, onDragStart } = useDrag({ x: -30, y: -30 });

  return (
    <div
      ref={ref}
      className={`xp-window ${minimized ? "xp-minimized" : ""}`}
      style={{ ...winStyle, zIndex }}
      onPointerDown={onFocus}
    >
      <div className="xp-titlebar" onPointerDown={(e) => { onFocus(); onDragStart(e); }}>
        <video className="xp-win-icon" src={ACCOUNT.avatarVideo} autoPlay loop muted playsInline />
        <span className="xp-win-title">theVITALYA — Network Access</span>
        <div className="xp-win-btns">
          <button className="xp-wb xp-wb-min" onClick={() => setMinimized((m) => !m)} title="Свернуть">─</button>
          <button className="xp-wb xp-wb-max" title="Развернуть">□</button>
          <button className="xp-wb xp-wb-close" onClick={onClose} title="Закрыть">✕</button>
        </div>
      </div>

      {!minimized && (
        <div className="xp-menubar">
          <span className="xp-menu-item">Файл</span>
          <span className="xp-menu-item">Правка</span>
          <span className="xp-menu-item">Вид</span>
          <span className="xp-menu-item">Справка</span>
        </div>
      )}

      {!minimized && (
        <div className="xp-body">
          <div className="xp-sidebar">
            <div className="xp-sidebar-section">
              <p className="xp-sidebar-title">Задачи</p>
              <a href="#" className="xp-sidebar-link">🔗 Подключиться</a>
              <a href="#" className="xp-sidebar-link">📋 Скопировать ссылку</a>
              <a href="#" className="xp-sidebar-link">📌 Закрепить чат</a>
            </div>
            <div className="xp-sidebar-section">
              <p className="xp-sidebar-title">Детали</p>
              <p className="xp-sidebar-info">Тип: Сеть</p>
              <p className="xp-sidebar-info">Статус: Активен</p>
              <p className="xp-sidebar-info">Участников: 1000+</p>
            </div>
          </div>

          <div className="xp-content">
            <div className="xp-content-header">
              <span className="xp-folder-icon">📁</span>
              <div>
                <p className="xp-content-title">Telegram Communities</p>
                <p className="xp-content-sub">Выберите канал для подключения</p>
              </div>
            </div>

            <div className="xp-items">
              {LINKS.map((link, i) => (
                <a
                  key={i}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="xp-item"
                  onClick={(e) => { e.preventDefault(); onOpenLink(link); }}
                >
                  <span className="xp-item-icon">{link.icon}</span>
                  <div className="xp-item-info">
                    <span className="xp-item-name">{link.name}</span>
                    <span className="xp-item-sub">{link.cyrillic}</span>
                  </div>
                  <span className="xp-item-arrow">›</span>
                </a>
              ))}
            </div>

            <div className="xp-statusrow">
              <span className="xp-status-dot" />
              <span className="xp-status-text">5 объектов · Соединение защищено</span>
            </div>
          </div>
        </div>
      )}

      {!minimized && (
        <div className="xp-statusbar">
          <span>5 объектов</span>
          <span className="xp-sb-div" />
          <span>Подключено</span>
        </div>
      )}
    </div>
  );
}

/* ─── PowerShell "connecting" Window ─── */
type PsLine = { text: string; prompt?: boolean };

function buildPsLines(link: { name: string; url: string }): PsLine[] {
  return [
    { text: `Windows PowerShell` },
    { text: `Copyright (C) Microsoft Corporation. All rights reserved.` },
    { text: `` },
    { text: `Попробуйте новую кроссплатформенную версию PowerShell https://aka.ms/pscore6` },
    { text: `` },
    { text: `Connect-Service -Target "${link.name}" -Uri "${link.url}"`, prompt: true },
    { text: `Разрешение имени узла...` },
    { text: `Подключение: ${link.url}` },
    { text: `Согласование TLS 1.3... OK` },
    { text: `Проверка сертификата... OK` },
    { text: `Соединение установлено.` },
    { text: `Открытие канала...`, prompt: true },
  ];
}

const PROMPT = "PS C:\\Users\\theVITALYA> ";

function PowerShellWindow({
  link,
  onDone,
  zIndex,
}: {
  link: { name: string; url: string };
  onDone: () => void;
  zIndex: number;
}) {
  const lines = useRef(buildPsLines(link)).current;
  const [shown, setShown] = useState(0);
  const [typedChars, setTypedChars] = useState(0);
  const [cursorOn, setCursorOn] = useState(true);
  const { ref, winStyle } = useDrag({ x: 10, y: 20 });

  const current = lines[shown];
  const isTypingLine = current?.prompt;
  const targetLen = current ? current.text.length : 0;

  useEffect(() => {
    if (shown >= lines.length) {
      const t = setTimeout(onDone, 260);
      return () => clearTimeout(t);
    }

    if (isTypingLine && typedChars < targetLen) {
      const t = setTimeout(() => setTypedChars((c) => c + 1), 12 + Math.random() * 18);
      return () => clearTimeout(t);
    }

    const delay = isTypingLine ? 90 : 45 + Math.random() * 55;
    const t = setTimeout(() => {
      setShown((s) => s + 1);
      setTypedChars(0);
    }, delay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, typedChars]);

  useEffect(() => {
    const t = setInterval(() => setCursorOn((c) => !c), 500);
    return () => clearInterval(t);
  }, []);

  return (
    <div ref={ref} className="ps-window" style={{ ...winStyle, zIndex }}>
      <div className="ps-titlebar">
        <span className="ps-titlebar-icon">
          <svg viewBox="0 0 16 16" width="14" height="14">
            <rect width="16" height="16" rx="2" fill="#012456" />
            <text x="8" y="12" textAnchor="middle" fontSize="10" fill="#fff" fontFamily="Consolas, monospace">&gt;_</text>
          </svg>
        </span>
        <span className="ps-titlebar-title">Windows PowerShell</span>
        <div className="ps-titlebar-btns">
          <button className="ps-tb-btn" tabIndex={-1}>─</button>
          <button className="ps-tb-btn" tabIndex={-1}>□</button>
          <button className="ps-tb-btn ps-tb-close" onClick={onDone} title="Закрыть">✕</button>
        </div>
      </div>
      <div className="ps-body">
        {lines.slice(0, shown).map((line, i) => (
          <div key={i} className="ps-line">
            {line.prompt && <span className="ps-prompt">{PROMPT}</span>}
            {line.text}
          </div>
        ))}
        {current && (
          <div className="ps-line">
            {isTypingLine && <span className="ps-prompt">{PROMPT}</span>}
            {isTypingLine ? current.text.slice(0, typedChars) : ""}
            {cursorOn && <span className="ps-cursor">█</span>}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Notepad Window ─── */
function NotepadWindow({ onClose, zIndex, onFocus }: { onClose: () => void; zIndex: number; onFocus: () => void }) {
  const { ref, winStyle, onDragStart } = useDrag({ x: 40, y: 60 });
  return (
    <div
      ref={ref}
      className="xp-window xp-notepad"
      style={{ ...winStyle, zIndex }}
      onPointerDown={onFocus}
    >
      <div className="xp-titlebar" onPointerDown={(e) => { onFocus(); onDragStart(e); }}>
        <span className="xp-win-icon" style={{ fontSize: 14 }}>📝</span>
        <span className="xp-win-title">прочитать.txt — Блокнот</span>
        <div className="xp-win-btns">
          <button className="xp-wb xp-wb-min">─</button>
          <button className="xp-wb xp-wb-max">□</button>
          <button className="xp-wb xp-wb-close" onClick={onClose}>✕</button>
        </div>
      </div>
      <div className="xp-menubar">
        <span className="xp-menu-item">Файл</span>
        <span className="xp-menu-item">Правка</span>
        <span className="xp-menu-item">Формат</span>
        <span className="xp-menu-item">Вид</span>
        <span className="xp-menu-item">Справка</span>
      </div>
      <div className="xp-notepad-toolbar">
        <button
          className="xp-notepad-save"
          onClick={() => {
            const blob = new Blob(["\uFEFF" + "зачем зашёл"], { type: "text/plain;charset=utf-8" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = "прочитать.txt";
            a.click();
            URL.revokeObjectURL(a.href);
          }}
        >
          💾 Сохранить
        </button>
      </div>
      <div className="xp-notepad-body">
        зачем зашёл
      </div>
    </div>
  );
}

/* ─── WordPad fonts ─── */
const WP_FONTS = [
  { label: "Calibri",          value: "Calibri, Tahoma, sans-serif" },
  { label: "Arial",            value: "Arial, Helvetica, sans-serif" },
  { label: "Times New Roman",  value: "'Times New Roman', Times, serif" },
  { label: "Courier New",      value: "'Courier New', Courier, monospace" },
  { label: "Comic Sans MS",    value: "'Comic Sans MS', cursive" },
  { label: "Tahoma",           value: "Tahoma, sans-serif" },
  { label: "Verdana",          value: "Verdana, sans-serif" },
  { label: "Georgia",          value: "Georgia, serif" },
];
const WP_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72];

/* ─── WordPad Window (guestbook) ─── */
function WordPadWindow({ onClose, zIndex, onFocus }: { onClose: () => void; zIndex: number; onFocus: () => void }) {
  const { ref, winStyle, onDragStart } = useDrag({ x: 90, y: 50 });
  const [entries, setEntries] = useState<GuestbookEntry[]>([]);
  const [clientIp, setClientIp] = useState<string | null>(null);
  const [alreadyWrote, setAlreadyWrote] = useState<boolean | null>(null);
  const [nickname, setNickname] = useState("");
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // ─── formatting state ───
  const [fontFamily, setFontFamily] = useState(WP_FONTS[0].value);
  const [fontSize, setFontSize]     = useState(12);
  const [bold, setBold]             = useState(false);
  const [italic, setItalic]         = useState(false);
  const [underline, setUnderline]   = useState(false);

  // ─── dropdown open state ───
  const [fontOpen, setFontOpen]   = useState(false);
  const [sizeOpen, setSizeOpen]   = useState(false);
  const fontRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef<HTMLDivElement>(null);

  // close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (fontRef.current && !fontRef.current.contains(e.target as Node)) setFontOpen(false);
      if (sizeRef.current && !sizeRef.current.contains(e.target as Node)) setSizeOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToEntries(
      (list) => setEntries(list),
      () => setErrorMsg("Не удалось загрузить записи."),
    );

    (async () => {
      try {
        const ip = await getClientIp();
        setClientIp(ip);
        const already = await hasSubmitted(ip);
        setAlreadyWrote(already);
      } catch {
        setErrorMsg("Не удалось определить ваш IP-адрес. Отправка недоступна.");
        setAlreadyWrote(null);
      }
    })();

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [entries]);

  const handleSubmit = async () => {
    if (!clientIp || alreadyWrote || submitting) return;
    const text = draft.trim();
    if (!text) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await submitEntry(clientIp, nickname, text);
      setAlreadyWrote(true);
      setDraft("");
    } catch {
      setErrorMsg("Не удалось сохранить запись. Возможно, вы уже писали здесь.");
      setAlreadyWrote(true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      ref={ref}
      className="xp-window xp-wordpad"
      style={{ ...winStyle, zIndex }}
      onPointerDown={onFocus}
    >
      <div className="xp-titlebar" onPointerDown={(e) => { onFocus(); onDragStart(e); }}>
        <span className="xp-win-icon" style={{ fontSize: 14 }}>📃</span>
        <span className="xp-win-title">здесь был....rtf — WordPad</span>
        <div className="xp-win-btns">
          <button className="xp-wb xp-wb-min">─</button>
          <button className="xp-wb xp-wb-max">□</button>
          <button className="xp-wb xp-wb-close" onClick={onClose}>✕</button>
        </div>
      </div>
      <div className="xp-menubar">
        <span className="xp-menu-item">Файл</span>
        <span className="xp-menu-item">Правка</span>
        <span className="xp-menu-item">Вид</span>
        <span className="xp-menu-item">Вставка</span>
        <span className="xp-menu-item">Формат</span>
        <span className="xp-menu-item">Справка</span>
      </div>
      <div className="xp-ribbon">
        <div className="xp-ribbon-tabs">
          <span className="xp-ribbon-tab xp-ribbon-tab-active">Главная</span>
          <span className="xp-ribbon-tab">Вид</span>
        </div>
        <div className="xp-ribbon-groups">
          <div className="xp-ribbon-group">
            <button
              className="xp-ribbon-btn xp-ribbon-btn-big"
              onClick={() => {
                const content = entries.map((e) => `${e.nickname}: ${e.text}`).join("\r\n") || "здесь был...";
                const blob = new Blob(["\uFEFF" + content], { type: "text/plain;charset=utf-8" });
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = "здесь был....rtf";
                a.click();
                URL.revokeObjectURL(a.href);
              }}
            >
              <span className="xp-ribbon-btn-icon">💾</span>
              <span>Сохранить</span>
            </button>
            <div className="xp-ribbon-label">Буфер обмена</div>
          </div>
          <div className="xp-ribbon-sep" />
          <div className="xp-ribbon-group xp-ribbon-group-font">
            {/* Font picker */}
            <div className="xp-ribbon-row" style={{ gap: 4 }}>
              <div className="xp-combo" ref={fontRef}>
                <button
                  className="xp-combo-btn xp-combo-font"
                  onClick={() => { setFontOpen(v => !v); setSizeOpen(false); }}
                >
                  <span style={{ fontFamily, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 90 }}>
                    {WP_FONTS.find(f => f.value === fontFamily)?.label ?? "Calibri"}
                  </span>
                  <span className="xp-combo-arrow">▾</span>
                </button>
                {fontOpen && (
                  <div className="xp-combo-list xp-combo-list-font">
                    {WP_FONTS.map(f => (
                      <div
                        key={f.value}
                        className={`xp-combo-item${f.value === fontFamily ? " xp-combo-item-active" : ""}`}
                        style={{ fontFamily: f.value }}
                        onMouseDown={(e) => { e.preventDefault(); setFontFamily(f.value); setFontOpen(false); }}
                      >
                        {f.label}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {/* Size picker */}
              <div className="xp-combo" ref={sizeRef}>
                <button
                  className="xp-combo-btn xp-combo-size"
                  onClick={() => { setSizeOpen(v => !v); setFontOpen(false); }}
                >
                  <span>{fontSize}</span>
                  <span className="xp-combo-arrow">▾</span>
                </button>
                {sizeOpen && (
                  <div className="xp-combo-list xp-combo-list-size">
                    {WP_SIZES.map(s => (
                      <div
                        key={s}
                        className={`xp-combo-item${s === fontSize ? " xp-combo-item-active" : ""}`}
                        onMouseDown={(e) => { e.preventDefault(); setFontSize(s); setSizeOpen(false); }}
                      >
                        {s}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {/* B / I / U */}
            <div className="xp-ribbon-row" style={{ marginTop: 4 }}>
              <button
                className={`xp-fmt-btn${bold ? " xp-fmt-btn-on" : ""}`}
                onClick={() => setBold(v => !v)}
                title="Жирный"
              ><b>Ж</b></button>
              <button
                className={`xp-fmt-btn${italic ? " xp-fmt-btn-on" : ""}`}
                onClick={() => setItalic(v => !v)}
                title="Курсив"
              ><i style={{ fontFamily: "Georgia, serif" }}>К</i></button>
              <button
                className={`xp-fmt-btn${underline ? " xp-fmt-btn-on" : ""}`}
                onClick={() => setUnderline(v => !v)}
                title="Подчёркнутый"
              ><u>Ч</u></button>
              <div className="xp-fmt-sep" />
              <button
                className="xp-fmt-btn"
                onClick={() => { setBold(false); setItalic(false); setUnderline(false); setFontFamily(WP_FONTS[0].value); setFontSize(12); }}
                title="Сбросить форматирование"
                style={{ fontSize: 10, padding: "0 4px" }}
              >✕A</button>
            </div>
            <div className="xp-ribbon-label">Шрифт</div>
          </div>
          <div className="xp-ribbon-sep" />
          <div className="xp-ribbon-group">
            <div className="xp-ribbon-row">
              <button className="xp-ribbon-mini" disabled>≡</button>
              <button className="xp-ribbon-mini" disabled>≡</button>
              <button className="xp-ribbon-mini" disabled>≡</button>
              <button className="xp-ribbon-mini" disabled>≡</button>
            </div>
            <div className="xp-ribbon-label">Абзац</div>
          </div>
        </div>
      </div>
      <div className="xp-ruler" />
      <div
        className="xp-notepad-body xp-wordpad-body"
        ref={bodyRef}
        style={{
          fontFamily,
          fontSize,
          fontWeight: bold ? "bold" : "normal",
          fontStyle: italic ? "italic" : "normal",
          textDecoration: underline ? "underline" : "none",
        }}
      >
        {entries.length === 0 && <div className="xp-notepad-placeholder">здесь был...</div>}
        {entries.map((entry) => (
          <div key={entry.id} className="xp-notepad-line">
            {`> ${entry.nickname}: ${entry.text}`}
          </div>
        ))}
      </div>
      <div className="xp-notepad-input-row">
        {alreadyWrote === false && (
          <>
            <input
              type="text"
              className="xp-notepad-input xp-notepad-input-nickname"
              value={nickname}
              maxLength={MAX_NICKNAME_LENGTH}
              placeholder="Никнейм"
              disabled={submitting}
              onChange={(e) => setNickname(e.target.value.slice(0, MAX_NICKNAME_LENGTH))}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSubmit();
              }}
            />
            <input
              type="text"
              className="xp-notepad-input"
              value={draft}
              maxLength={GUESTBOOK_MAX_LENGTH}
              placeholder="Напишите что-нибудь (до 32 символов)…"
              disabled={submitting}
              onChange={(e) => setDraft(e.target.value.slice(0, GUESTBOOK_MAX_LENGTH))}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSubmit();
              }}
            />
            <span className="xp-notepad-counter">{draft.length}/{GUESTBOOK_MAX_LENGTH}</span>
            <button
              className="xp-notepad-submit"
              onClick={handleSubmit}
              disabled={submitting || !draft.trim()}
            >
              {submitting ? "…" : "Отправить"}
            </button>
          </>
        )}
        {alreadyWrote === true && (
          <span className="xp-notepad-status">Вы уже оставили запись здесь. Спасибо!</span>
        )}
        {alreadyWrote === null && (
          <span className="xp-notepad-status">Проверяем…</span>
        )}
        {errorMsg && <span className="xp-notepad-error">{errorMsg}</span>}
      </div>
    </div>
  );
}

/* ─── Forum Window ─── */
type ForumView = "auth" | "posts" | "post" | "admin";

function RoleBadge({ role }: { role: ForumUser["role"] }) {
  if (role === "owner") return <span className="xp-forum-role-badge xp-forum-role-owner" title="Главный администратор">👑 Владелец</span>;
  if (role === "admin") return <span className="xp-forum-role-badge xp-forum-role-admin" title="Администратор">🛡️ Админ</span>;
  return null;
}

function ForumWindow({ onClose, zIndex, onFocus }: { onClose: () => void; zIndex: number; onFocus: () => void }) {
  const { ref, winStyle, onDragStart } = useDrag({ x: 80, y: 20 });
  const [view, setView]               = useState<ForumView>("auth");
  const [authTab, setAuthTab]         = useState<"login" | "register">("login");
  const [authUser, setAuthUser]       = useState("");
  const [authPass, setAuthPass]       = useState("");
  const [authErr, setAuthErr]         = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [forumUser, setForumUser]     = useState<ForumUser | null>(null);
  const [posts, setPosts]             = useState<ForumPost[]>([]);
  const [postsLoading, setPostsLoading] = useState(true);
  const [showNewPost, setShowNewPost] = useState(false);
  const [newTitle, setNewTitle]       = useState("");
  const [newBody, setNewBody]         = useState("");
  const [newImage, setNewImage]       = useState<File | null>(null);
  const [newImagePreview, setNewImagePreview] = useState<string | null>(null);
  const [posting, setPosting]         = useState(false);
  const [selectedPost, setSelectedPost] = useState<ForumPost | null>(null);
  const [replies, setReplies]         = useState<ForumReply[]>([]);
  const [replyDraft, setReplyDraft]   = useState("");
  const [replyImage, setReplyImage]   = useState<File | null>(null);
  const [replyImagePreview, setReplyImagePreview] = useState<string | null>(null);
  const [replyLoading, setReplyLoading] = useState(false);
  const [lightboxUrl, setLightboxUrl]     = useState<string | null>(null);
  const [userReactions, setUserReactions] = useState<Record<string, string>>({});
  const [adminUsers, setAdminUsers]       = useState<ForumAdminUser[]>([]);
  const [adminBusyUid, setAdminBusyUid]   = useState<string | null>(null);
  const [adminErr, setAdminErr]           = useState<string | null>(null);
  const repliesEndRef  = useRef<HTMLDivElement>(null);
  const repliesBodyRef = useRef<HTMLDivElement>(null);
  const [repliesLoadedFor, setRepliesLoadedFor] = useState<string | null>(null);
  const newImageRef    = useRef<HTMLInputElement>(null);
  const replyImageRef  = useRef<HTMLInputElement>(null);

  const isModerator = !!forumUser && canModerate(forumUser.role);

  useEffect(() => {
    return subscribeToAuthState((u) => {
      setForumUser(u);
      if (u) setView(v => v === "auth" ? "posts" : v);
      else   setView("auth");
    });
  }, []);

  useEffect(() => {
    if (!forumUser) { setUserReactions({}); return; }
    return subscribeToUserReactions(forumUser.uid, setUserReactions);
  }, [forumUser?.uid]);

  useEffect(() => {
    if (view !== "posts") return;
    setPostsLoading(true);
    return subscribeToPostList((list) => { setPosts(list); setPostsLoading(false); });
  }, [view]);

  useEffect(() => {
    if (view !== "admin" || !isModerator) return;
    return subscribeToAllUsers(setAdminUsers);
  }, [view, isModerator]);

  useEffect(() => {
    if (view !== "post" || !selectedPost) return;
    setRepliesLoadedFor(null);
    return subscribeToReplies(selectedPost.id, (list) => {
      setReplies(list);
      setRepliesLoadedFor(selectedPost.id);
    });
  }, [view, selectedPost?.id]);

  // Jump straight to the most recent reply the moment a topic (and its
  // first batch of replies) has loaded — instantly, not a smooth scroll,
  // so long threads never get stuck showing the top.
  useEffect(() => {
    if (!selectedPost || repliesLoadedFor !== selectedPost.id) return;
    repliesEndRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
  }, [repliesLoadedFor, selectedPost?.id]);

  // Keep following new replies once the thread is already open.
  useEffect(() => {
    if (!repliesLoadedFor) return;
    repliesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [replies, repliesLoadedFor]);

  const handleImageSelect = (file: File, setter: (f: File | null) => void, previewSetter: (s: string | null) => void) => {
    if (file.size > 15 * 1024 * 1024) { alert("Файл слишком большой. Максимум 15 МБ (изображение будет сжато автоматически)."); return; }
    setter(file);
    const reader = new FileReader();
    reader.onload = (e) => previewSetter(e.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleAuth = async () => {
    setAuthErr(null);
    const usernameErr = validateUsername(authUser);
    if (usernameErr) { setAuthErr(usernameErr); return; }
    if (authPass.length < 6) { setAuthErr("Пароль: минимум 6 символов"); return; }
    setAuthLoading(true);
    try {
      const u = authTab === "register"
        ? await registerUser(authUser, authPass)
        : await loginUser(authUser, authPass);
      setForumUser(u);
      setView("posts");
    } catch (e: unknown) {
      const code = (e as { code?: string }).code ?? "";
      const message = (e as { message?: string }).message ?? "";
      if (message === "BANNED") setAuthErr("Этот аккаунт заблокирован администрацией.");
      else if (code === "auth/email-already-in-use")  setAuthErr("Пользователь уже существует");
      else if (["auth/user-not-found","auth/wrong-password","auth/invalid-credential"].includes(code))
        setAuthErr("Неверный никнейм или пароль");
      else setAuthErr("Ошибка. Попробуйте снова.");
    } finally { setAuthLoading(false); }
  };

  const handleNewPost = async () => {
    if (!forumUser || !newTitle.trim() || !newBody.trim()) return;
    setPosting(true);
    try {
      let imageUrl: string | undefined;
      if (newImage) imageUrl = await uploadImage(newImage);
      await createPost(forumUser, newTitle, newBody, imageUrl);
      setNewTitle(""); setNewBody(""); setNewImage(null); setNewImagePreview(null); setShowNewPost(false);
    } catch (err) {
      alert(`Не удалось создать тему: ${(err as Error).message ?? "неизвестная ошибка"}`);
    } finally { setPosting(false); }
  };

  const handleReply = async () => {
    if (!forumUser || !selectedPost || !replyDraft.trim()) return;
    setReplyLoading(true);
    try {
      let imageUrl: string | undefined;
      if (replyImage) imageUrl = await uploadImage(replyImage);
      await createReply(forumUser, selectedPost.id, replyDraft, imageUrl);
      setReplyDraft(""); setReplyImage(null); setReplyImagePreview(null);
    } catch (err) {
      alert(`Не удалось отправить ответ: ${(err as Error).message ?? "неизвестная ошибка"}`);
    } finally { setReplyLoading(false); }
  };

  const openPost = (post: ForumPost) => { setSelectedPost(post); setReplies([]); setView("post"); };
  const goBack   = () => { setView("posts"); setSelectedPost(null); };

  const handleDeletePost = async (post: ForumPost, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!forumUser || !window.confirm(`Удалить тему «${post.title}»?`)) return;
    try {
      await deletePost(forumUser, post.id);
      if (selectedPost?.id === post.id) goBack();
    } catch (err) { alert((err as Error).message); }
  };

  const handleDeleteReply = async (reply: ForumReply) => {
    if (!forumUser || !selectedPost || !window.confirm("Удалить это сообщение?")) return;
    try { await deleteReply(forumUser, selectedPost.id, reply.id); }
    catch (err) { alert((err as Error).message); }
  };

  const handleSetRole = async (target: ForumAdminUser, role: "admin" | "user") => {
    if (!forumUser) return;
    setAdminErr(null); setAdminBusyUid(target.uid);
    try { await setUserRole(forumUser, target.uid, role); }
    catch (err) { setAdminErr((err as Error).message); }
    finally { setAdminBusyUid(null); }
  };

  const handleSetBanned = async (target: ForumAdminUser, banned: boolean) => {
    if (!forumUser) return;
    setAdminErr(null); setAdminBusyUid(target.uid);
    try { await setUserBanned(forumUser, target, banned); }
    catch (err) { setAdminErr((err as Error).message); }
    finally { setAdminBusyUid(null); }
  };

  return (
    <div ref={ref} className="xp-window xp-forum" style={{ ...winStyle, zIndex }} onPointerDown={onFocus}>
      <div className="xp-titlebar" onPointerDown={(e) => { onFocus(); onDragStart(e); }}>
        <span className="xp-win-icon" style={{ fontSize: 14 }}>💬</span>
        <span className="xp-win-title">Форум — theVITALYA Community</span>
        <div className="xp-win-btns">
          <button className="xp-wb xp-wb-min">─</button>
          <button className="xp-wb xp-wb-max">□</button>
          <button className="xp-wb xp-wb-close" onClick={onClose}>✕</button>
        </div>
      </div>

      <div className="xp-menubar">
        <span className="xp-menu-item">Файл</span>
        <span className="xp-menu-item">Вид</span>
        <span className="xp-menu-item">Сервис</span>
        <span className="xp-menu-item">Справка</span>
      </div>

      <div className="xp-forum-toolbar">
        {view === "post"  && <button className="xp-forum-tbtn" onClick={goBack}>◀ Назад к темам</button>}
        {view === "posts" && <button className="xp-forum-tbtn xp-forum-tbtn-new" onClick={() => setShowNewPost(v => !v)}>📝 Новая тема</button>}
        {view === "posts" && <div className="xp-forum-tb-sep" />}
        {isModerator && view !== "admin" && (
          <button className="xp-forum-tbtn" onClick={() => setView("admin")}>⚙️ Админ-панель</button>
        )}
        {view === "admin" && <button className="xp-forum-tbtn" onClick={goBack}>◀ Назад к темам</button>}
        <span style={{ flex: 1 }} />
        {forumUser && (
          <div className="xp-forum-avatar-badge">
            <div className="xp-forum-avatar-sm">{forumUser.username[0].toUpperCase()}</div>
            <span className="xp-forum-userinfo">{forumUser.username}</span>
            <RoleBadge role={forumUser.role} />
            <button className="xp-forum-tbtn" onClick={() => logoutUser()}>Выйти</button>
          </div>
        )}
      </div>

      <div className="xp-forum-body">

        {/* ── AUTH ── */}
        {view === "auth" && (
          <div className="xp-forum-auth">
            <div className="xp-forum-auth-panel">
              <div className="xp-forum-auth-header">
                <div className="xp-forum-auth-icon">💬</div>
                <div>
                  <div className="xp-forum-auth-title">theVITALYA Forum</div>
                  <div className="xp-forum-auth-subtitle">Добро пожаловать на форум сообщества</div>
                </div>
              </div>
              <div className="xp-forum-auth-body">
                <div className="xp-forum-auth-tabs">
                  <button className={`xp-forum-tab${authTab === "login" ? " xp-forum-tab-on" : ""}`} onClick={() => { setAuthTab("login"); setAuthErr(null); }}>Войти</button>
                  <button className={`xp-forum-tab${authTab === "register" ? " xp-forum-tab-on" : ""}`} onClick={() => { setAuthTab("register"); setAuthErr(null); }}>Регистрация</button>
                </div>
                <div className="xp-forum-auth-form">
                  <label className="xp-forum-label">Никнейм <span className="xp-forum-hint-text">(латиница, цифры, _)</span></label>
                  <input className="xp-forum-input" value={authUser} onChange={e => setAuthUser(e.target.value)} placeholder="от 3 до 20 символов" onKeyDown={e => e.key === "Enter" && handleAuth()} />
                  <label className="xp-forum-label">Пароль</label>
                  <input className="xp-forum-input" type="password" value={authPass} onChange={e => setAuthPass(e.target.value)} placeholder="минимум 6 символов" onKeyDown={e => e.key === "Enter" && handleAuth()} />
                  {authErr && <div className="xp-forum-err">{authErr}</div>}
                  <button className="xp-forum-btn-primary" onClick={handleAuth} disabled={authLoading}>
                    {authLoading ? "Подключение…" : authTab === "login" ? "Войти" : "Зарегистрироваться"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── POSTS LIST ── */}
        {view === "posts" && (
          <div className="xp-forum-posts">
            {showNewPost && (
              <div className="xp-forum-new-post">
                <div className="xp-forum-new-post-title">📝 Создать новую тему</div>
                <input className="xp-forum-input" placeholder="Заголовок темы" value={newTitle} onChange={e => setNewTitle(e.target.value)} maxLength={80} />
                <textarea className="xp-forum-textarea" placeholder="Текст сообщения…" value={newBody} onChange={e => setNewBody(e.target.value)} rows={4} />
                {newImagePreview && (
                  <div className="xp-forum-img-preview">
                    <img src={newImagePreview} alt="preview" onClick={() => setLightboxUrl(newImagePreview)} />
                    <button className="xp-forum-img-remove" onClick={() => { setNewImage(null); setNewImagePreview(null); }}>✕</button>
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <button className="xp-forum-btn-primary" onClick={handleNewPost} disabled={posting || !newTitle.trim() || !newBody.trim()}>{posting ? "Публикация…" : "Создать тему"}</button>
                  <button className="xp-forum-tbtn xp-forum-tbtn-attach" onClick={() => newImageRef.current?.click()}>📎 Прикрепить фото</button>
                  <button className="xp-forum-tbtn" onClick={() => { setShowNewPost(false); setNewImage(null); setNewImagePreview(null); }}>Отмена</button>
                  <input ref={newImageRef} type="file" accept="image/*" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (f) handleImageSelect(f, setNewImage, setNewImagePreview); e.target.value = ""; }} />
                </div>
              </div>
            )}

            <div className="xp-forum-category">
              <span className="xp-forum-category-icon">📋</span>
              <span className="xp-forum-category-name">Общий форум</span>
              <span className="xp-forum-category-count">{posts.length} тем</span>
            </div>

            <div className="xp-forum-table-head">
              <div className="xp-forum-th xp-forum-th-topic">Тема</div>
              <div className="xp-forum-th xp-forum-th-author">Автор</div>
              <div className="xp-forum-th xp-forum-th-replies">Ответов</div>
              <div className="xp-forum-th xp-forum-th-date">Дата</div>
            </div>

            {postsLoading && <div className="xp-forum-empty">⏳ Загрузка тем…</div>}
            {!postsLoading && posts.length === 0 && <div className="xp-forum-empty">Тем пока нет — создайте первую!</div>}

            <div className="xp-forum-list">
              {posts.map((post, i) => (
                <div key={post.id} className={`xp-forum-post-row${i % 2 === 1 ? " xp-forum-post-row-alt" : ""}`} onClick={() => openPost(post)}>
                  <div className="xp-forum-td xp-forum-td-topic">
                    <span className="xp-forum-post-icon">{post.imageUrl ? "🖼️" : "📄"}</span>
                    <div className="xp-forum-post-info">
                      <span className="xp-forum-post-title">{post.title}</span>
                      <span className="xp-forum-post-preview">{post.body.slice(0, 70)}{post.body.length > 70 ? "…" : ""}</span>
                    </div>
                  </div>
                  <div className="xp-forum-td xp-forum-td-author">
                    <div className="xp-forum-avatar-xs">{post.authorName[0]?.toUpperCase()}</div>
                    <span>{post.authorName}</span>
                  </div>
                  <div className="xp-forum-td xp-forum-td-replies">{post.replyCount}</div>
                  <div className="xp-forum-td xp-forum-td-date">{formatDate(post.createdAt)}</div>
                  {isModerator && (
                    <button className="xp-forum-mod-delete" title="Удалить тему" onClick={(e) => handleDeletePost(post, e)}>🗑</button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── ADMIN PANEL ── */}
        {view === "admin" && isModerator && (
          <div className="xp-forum-admin">
            <div className="xp-forum-category">
              <span className="xp-forum-category-icon">⚙️</span>
              <span className="xp-forum-category-name">Управление пользователями</span>
              <span className="xp-forum-category-count">{adminUsers.length} чел.</span>
            </div>
            {adminErr && <div className="xp-forum-err">{adminErr}</div>}
            <div className="xp-forum-table-head">
              <div className="xp-forum-th xp-forum-th-topic">Пользователь</div>
              <div className="xp-forum-th xp-forum-th-author">Роль</div>
              <div className="xp-forum-th xp-forum-th-replies">Статус</div>
              <div className="xp-forum-th xp-forum-th-date">Действия</div>
            </div>
            <div className="xp-forum-list">
              {adminUsers.map((u) => {
                const busy = adminBusyUid === u.uid;
                const isSelf = forumUser?.uid === u.uid;
                const canAct = !isSelf && (forumUser ? (u.role === "owner" ? false : canManageRoles(forumUser.role) || u.role === "user") : false);
                return (
                  <div key={u.uid} className="xp-forum-post-row xp-forum-admin-row">
                    <div className="xp-forum-td xp-forum-td-topic">
                      <div className="xp-forum-avatar-xs">{u.username[0]?.toUpperCase()}</div>
                      <span>{u.username}{isSelf && " (вы)"}</span>
                    </div>
                    <div className="xp-forum-td xp-forum-td-author"><RoleBadge role={u.role} />{u.role === "user" && "Участник"}</div>
                    <div className="xp-forum-td xp-forum-td-replies">{u.banned ? "🚫 Заблокирован" : "✅ Активен"}</div>
                    <div className="xp-forum-td xp-forum-td-date" style={{ gap: 6, display: "flex", flexWrap: "wrap" }}>
                      {forumUser && canManageRoles(forumUser.role) && u.role !== "owner" && (
                        u.role === "admin"
                          ? <button className="xp-forum-tbtn" disabled={busy} onClick={() => handleSetRole(u, "user")}>Снять админа</button>
                          : <button className="xp-forum-tbtn" disabled={busy} onClick={() => handleSetRole(u, "admin")}>Сделать админом</button>
                      )}
                      {u.role !== "owner" && canAct && (
                        u.banned
                          ? <button className="xp-forum-tbtn" disabled={busy} onClick={() => handleSetBanned(u, false)}>Разбанить</button>
                          : <button className="xp-forum-tbtn xp-forum-mod-delete-text" disabled={busy} onClick={() => handleSetBanned(u, true)}>Забанить</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── POST DETAIL ── */}
        {view === "post" && selectedPost && (
          <div className="xp-forum-detail">
            <div className="xp-forum-detail-header">
              <span className="xp-forum-detail-icon">📄</span>
              <span className="xp-forum-detail-title">{selectedPost.title}</span>
            </div>

            <div className="xp-forum-replies" ref={repliesBodyRef}>
              <div className="xp-forum-msg xp-forum-msg-op">
                <div className="xp-forum-msg-sidebar">
                  <div className="xp-forum-avatar">{selectedPost.authorName[0]?.toUpperCase()}</div>
                  <div className="xp-forum-msg-username">{selectedPost.authorName}</div>
                  <div className="xp-forum-msg-rank">{selectedPost.authorRole === 'owner' ? 'Владелец' : selectedPost.authorRole === 'admin' ? 'Админ' : 'Участник'}</div>
                  <div className="xp-forum-msg-sidebar-right">
                    <span className="xp-forum-msg-num">#1</span>
                    <span className="xp-forum-reply-date">{formatDate(selectedPost.createdAt)}</span>
                    {isModerator && (
                      <button className="xp-forum-mod-delete" title="Удалить тему" onClick={() => handleDeletePost(selectedPost)}>🗑</button>
                    )}
                  </div>
                </div>
                <div className="xp-forum-msg-content">
                  <div className="xp-forum-op-body">{selectedPost.body}</div>
                  {selectedPost.imageUrl && (
                    <div className="xp-forum-msg-img">
                      <img src={selectedPost.imageUrl} alt="вложение" onClick={() => setLightboxUrl(selectedPost.imageUrl!)} />
                    </div>
                  )}
                  <div className="xp-forum-reactions">
                    {REACTION_EMOJIS.map(emoji => {
                      const count = Math.max(0, selectedPost.reactions?.[emoji] ?? 0);
                      const active = userReactions[selectedPost.id] === emoji;
                      return (
                        <button key={emoji} className={`xp-forum-reaction-btn${active ? " xp-forum-reaction-active" : ""}`}
                          onClick={() => forumUser && toggleReaction(forumUser, selectedPost.id, emoji, postDocRef(selectedPost.id))}>
                          {emoji}{count > 0 && <span className="xp-forum-reaction-count">{count}</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {replies.length === 0 && <div className="xp-forum-empty">Ответов пока нет. Будьте первым!</div>}
              {replies.map((r, i) => (
                <div key={r.id} className="xp-forum-msg">
                  <div className="xp-forum-msg-sidebar">
                    <div className="xp-forum-avatar">{r.authorName[0]?.toUpperCase()}</div>
                    <div className="xp-forum-msg-username">{r.authorName}</div>
                    <div className="xp-forum-msg-rank">{r.authorRole === 'owner' ? 'Владелец' : r.authorRole === 'admin' ? 'Админ' : 'Участник'}</div>
                    <div className="xp-forum-msg-sidebar-right">
                      <span className="xp-forum-msg-num">#{i + 2}</span>
                      <span className="xp-forum-reply-date">{formatDate(r.createdAt)}</span>
                      {isModerator && (
                        <button className="xp-forum-mod-delete" title="Удалить сообщение" onClick={() => handleDeleteReply(r)}>🗑</button>
                      )}
                    </div>
                  </div>
                  <div className="xp-forum-msg-content">
                    <div className="xp-forum-reply-body">{r.body}</div>
                    {r.imageUrl && (
                      <div className="xp-forum-msg-img">
                        <img src={r.imageUrl} alt="вложение" onClick={() => setLightboxUrl(r.imageUrl!)} />
                      </div>
                    )}
                    <div className="xp-forum-reactions">
                      {REACTION_EMOJIS.map(emoji => {
                        const count = Math.max(0, r.reactions?.[emoji] ?? 0);
                        const active = userReactions[r.id] === emoji;
                        return (
                          <button key={emoji} className={`xp-forum-reaction-btn${active ? " xp-forum-reaction-active" : ""}`}
                            onClick={() => forumUser && selectedPost && toggleReaction(forumUser, r.id, emoji, replyDocRef(selectedPost.id, r.id))}>
                            {emoji}{count > 0 && <span className="xp-forum-reaction-count">{count}</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={repliesEndRef} />
            </div>

            <div className="xp-forum-reply-form">
              <div className="xp-forum-reply-form-label">✏️ Ответить в теме</div>
              <textarea className="xp-forum-textarea" placeholder="Написать ответ…" value={replyDraft} onChange={e => setReplyDraft(e.target.value)} rows={2} />
              {replyImagePreview && (
                <div className="xp-forum-img-preview">
                  <img src={replyImagePreview} alt="preview" onClick={() => setLightboxUrl(replyImagePreview)} />
                  <button className="xp-forum-img-remove" onClick={() => { setReplyImage(null); setReplyImagePreview(null); }}>✕</button>
                </div>
              )}
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button className="xp-forum-btn-primary" onClick={handleReply} disabled={replyLoading || !replyDraft.trim()}>
                  {replyLoading ? "Отправка…" : "Отправить ответ"}
                </button>
                <button className="xp-forum-tbtn xp-forum-tbtn-attach" onClick={() => replyImageRef.current?.click()}>📎 Прикрепить фото</button>
                <input ref={replyImageRef} type="file" accept="image/*" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (f) handleImageSelect(f, setReplyImage, setReplyImagePreview); e.target.value = ""; }} />
              </div>
            </div>
          </div>
        )}

      </div>

      {lightboxUrl && (
        <div className="xp-forum-lightbox" onClick={() => setLightboxUrl(null)}>
          <div className="xp-forum-lightbox-inner" onClick={e => e.stopPropagation()}>
            <img src={lightboxUrl} alt="full size" />
            <button className="xp-forum-lightbox-close" onClick={() => setLightboxUrl(null)}>✕ Закрыть</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Trash Window ─── */
function TrashWindow({ onClose, onOpenNotepad, zIndex, onFocus }: { onClose: () => void; onOpenNotepad: () => void; zIndex: number; onFocus: () => void }) {
  const { ref, winStyle, onDragStart } = useDrag({ x: 60, y: 40 });
  const [fileSelected, setFileSelected] = useState(false);

  return (
    <div
      ref={ref}
      className="xp-window"
      style={{ ...winStyle, zIndex }}
      onPointerDown={onFocus}
    >
      <div className="xp-titlebar" onPointerDown={(e) => { onFocus(); onDragStart(e); }}>
        <span className="xp-win-icon" style={{ fontSize: 14 }}>🗑️</span>
        <span className="xp-win-title">Корзина</span>
        <div className="xp-win-btns">
          <button className="xp-wb xp-wb-min">─</button>
          <button className="xp-wb xp-wb-max">□</button>
          <button className="xp-wb xp-wb-close" onClick={onClose}>✕</button>
        </div>
      </div>
      <div className="xp-menubar">
        <span className="xp-menu-item">Файл</span>
        <span className="xp-menu-item">Правка</span>
        <span className="xp-menu-item">Вид</span>
        <span className="xp-menu-item">Справка</span>
      </div>
      <div className="xp-body">
        <div className="xp-sidebar">
          <div className="xp-sidebar-section">
            <p className="xp-sidebar-title">Задачи корзины</p>
            <a href="#" className="xp-sidebar-link">🗑️ Очистить корзину</a>
            <a href="#" className="xp-sidebar-link">↩️ Восстановить объект</a>
          </div>
          <div className="xp-sidebar-section">
            <p className="xp-sidebar-title">Детали</p>
            <p className="xp-sidebar-info">Объектов: 1</p>
            <p className="xp-sidebar-info">Размер: 21 Б</p>
            <p className="xp-sidebar-info">Дата: 03:23 28 июня 2026</p>
          </div>
        </div>
        <div className="xp-content">
          <div className="xp-content-header">
            <span className="xp-folder-icon">🗑️</span>
            <div>
              <p className="xp-content-title">Корзина</p>
              <p className="xp-content-sub">Удалённые объекты</p>
            </div>
          </div>
          <div className="xp-items">
            <div
              className={`xp-file-item ${fileSelected ? "xp-file-selected" : ""}`}
              onClick={(e) => { e.stopPropagation(); setFileSelected(true); }}
              onDoubleClick={onOpenNotepad}
            >
              <span className="xp-file-icon">📄</span>
              <div className="xp-item-info">
                <span className="xp-item-name">прочитать.txt</span>
                <span className="xp-item-sub">Текстовый документ · 1 КБ</span>
              </div>
            </div>
          </div>
          <div className="xp-statusrow">
            <span className="xp-status-dot" style={{ background: "#e74c3c" }} />
            <span className="xp-status-text">1 объект · Удалено</span>
          </div>
        </div>
      </div>
      <div className="xp-statusbar">
        <span>1 объект</span>
        <span className="xp-sb-div" />
        <span>21 Б</span>
      </div>
    </div>
  );
}

/* ─── App ─── */
type AppPhase = "boot" | "logon" | "desktop";
type WinId = "main" | "trash" | "notepad" | "wordpad" | "forum";

export default function App() {
  const [phase, setPhase]           = useState<AppPhase>("boot");
  const [winOpen, setWinOpen]       = useState(false);
  const [trashOpen, setTrashOpen]   = useState(false);
  const [notepadOpen, setNotepadOpen] = useState(false);
  const [wordpadOpen, setWordpadOpen] = useState(false);
  const [forumOpen, setForumOpen]   = useState(false);
  const [selected, setSelected]     = useState<number | null>(null);
  const [zStack, setZStack]         = useState<WinId[]>([]);
  const [psLink, setPsLink]         = useState<{ name: string; url: string } | null>(null);

  const bringToFront = (id: WinId) =>
    setZStack(prev => [...prev.filter(x => x !== id), id]);

  const openWin = (id: WinId, setter: (v: boolean) => void) => {
    setter(true);
    bringToFront(id);
  };

  const zOf = (id: WinId) => 100 + zStack.indexOf(id);

  useEffect(() => {
    if (phase !== "desktop") return;
    playXPStartup();
  }, [phase]);

  if (phase === "boot") return <BootScreen onDone={() => setPhase("logon")} />;
  if (phase === "logon") return <LogonScreen onDone={() => setPhase("desktop")} />;

  const handleDoubleClick = (i: number) => {
    if (i === 0) openWin("main", setWinOpen);
    if (i === 1) openWin("trash", setTrashOpen);
    if (i === 2) openWin("wordpad", setWordpadOpen);
    if (i === 3) openWin("forum", setForumOpen);
  };

  return (
    <div className="xp-desktop" onClick={() => setSelected(null)}>
      <div className="xp-icons">
        {ICONS.map((ic, i) => (
          <div
            key={i}
            className={`xp-icon ${selected === i ? "xp-icon-selected" : ""}`}
            onClick={(e) => { e.stopPropagation(); setSelected(i); }}
            onDoubleClick={() => handleDoubleClick(i)}
          >
            <span className="xp-icon-emoji">{ic.emoji}</span>
            <span className="xp-icon-label">{ic.label}</span>
          </div>
        ))}
      </div>

      {winOpen && (
        <XPWindow
          onClose={() => setWinOpen(false)}
          zIndex={zOf("main")}
          onFocus={() => bringToFront("main")}
          onOpenLink={(link) => setPsLink(link)}
        />
      )}
      {psLink && (
        <PowerShellWindow
          link={psLink}
          zIndex={999}
          onDone={() => {
            window.open(psLink.url, "_blank", "noopener,noreferrer");
            setPsLink(null);
          }}
        />
      )}
      {trashOpen && (
        <TrashWindow
          onClose={() => setTrashOpen(false)}
          onOpenNotepad={() => openWin("notepad", setNotepadOpen)}
          zIndex={zOf("trash")}
          onFocus={() => bringToFront("trash")}
        />
      )}
      {notepadOpen && (
        <NotepadWindow
          onClose={() => setNotepadOpen(false)}
          zIndex={zOf("notepad")}
          onFocus={() => bringToFront("notepad")}
        />
      )}
      {wordpadOpen && (
        <WordPadWindow
          onClose={() => setWordpadOpen(false)}
          zIndex={zOf("wordpad")}
          onFocus={() => bringToFront("wordpad")}
        />
      )}
      {forumOpen && (
        <ForumWindow
          onClose={() => setForumOpen(false)}
          zIndex={zOf("forum")}
          onFocus={() => bringToFront("forum")}
        />
      )}

      <Taskbar onOpen={() => openWin("main", setWinOpen)} />
    </div>
  );
}
