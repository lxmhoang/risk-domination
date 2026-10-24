/* =========================================================================
   PLAYER AVATARS — a set of 12 small cartoon faces (inline SVG, drawn for this game)
   ---------------------------------------------------------------------
   Shown in the player cards (renderPlayerList() in 06-render-game.js). A player's avatar is
   AVATARS[id % 12], so it stays the same for the whole match; player 0 (you) is the general.
   Each is a 64x64 picture with its own background — the player's color goes around it as a ring.
   ========================================================================= */
const _eye = (x,y,r)=> `<circle cx="${x}" cy="${y}" r="${r||3.2}" fill="#fff"/><circle cx="${x}" cy="${y+0.4}" r="${(r||3.2)*0.52}" fill="#1b1b2b"/>`;
const AVATARS = [
  // general
  `<rect width="64" height="64" fill="#6c757d"/><circle cx="32" cy="38" r="17" fill="#f1c9a0"/>
   <path d="M6 24 Q32 2 58 24 Q50 30 44 27 Q32 20 20 27 Q14 30 6 24z" fill="#1d3557"/><path d="M6 24 Q32 2 58 24" fill="none" stroke="#e9b949" stroke-width="2.5"/>
   <circle cx="32" cy="13" r="3" fill="#e63946"/>${_eye(25,38)}${_eye(39,38)}
   <path d="M22 47 Q32 43 42 47 Q32 51 22 47z" fill="#5a3a22"/><path d="M26 52 Q32 55 38 52" fill="none" stroke="#b5654a" stroke-width="2" stroke-linecap="round"/>`,
  // lion
  `<rect width="64" height="64" fill="#ffd166"/><circle cx="32" cy="35" r="26" fill="#b8631a"/><circle cx="32" cy="36" r="17" fill="#f4a63c"/>
   <circle cx="19" cy="22" r="5" fill="#f4a63c"/><circle cx="45" cy="22" r="5" fill="#f4a63c"/>
   <ellipse cx="32" cy="43" rx="9" ry="6.5" fill="#fbd38d"/><path d="M28.5 38.5h7l-3.5 4z" fill="#3b2418"/>${_eye(25,32)}${_eye(39,32)}
   <path d="M32 42.5v3M28 46q4 2 8 0" fill="none" stroke="#3b2418" stroke-width="1.6" stroke-linecap="round"/>`,
  // fox
  `<rect width="64" height="64" fill="#bde0fe"/><path d="M10 6l15 17-17 7z" fill="#d9480f"/><path d="M54 6L39 23l17 7z" fill="#d9480f"/>
   <path d="M9 27Q32 19 55 27L49 47Q32 61 15 47z" fill="#f28c28"/><path d="M19 37Q32 31 45 37Q40 55 32 57Q24 55 19 37z" fill="#fff"/>
   <circle cx="32" cy="50" r="3.2" fill="#222"/>${_eye(23,34,3)}${_eye(41,34,3)}`,
  // wolf
  `<rect width="64" height="64" fill="#cfd8dc"/><path d="M11 5l14 19-17 6z" fill="#546e7a"/><path d="M53 5L39 24l17 6z" fill="#546e7a"/>
   <path d="M10 27Q32 17 54 27L49 47Q32 60 15 47z" fill="#78909c"/><path d="M21 40Q32 34 43 40Q39 54 32 56Q25 54 21 40z" fill="#cfd8dc"/>
   <path d="M29 47h6l-3 4z" fill="#1b1b2b"/><circle cx="23" cy="34" r="3.4" fill="#ffd54a"/><circle cx="41" cy="34" r="3.4" fill="#ffd54a"/>
   <path d="M23 31.5v5M41 31.5v5" stroke="#1b1b2b" stroke-width="1.6"/>`,
  // bear
  `<rect width="64" height="64" fill="#c7f9cc"/><circle cx="14" cy="16" r="8" fill="#6f4518"/><circle cx="50" cy="16" r="8" fill="#6f4518"/>
   <circle cx="14" cy="16" r="4" fill="#c58c52"/><circle cx="50" cy="16" r="4" fill="#c58c52"/><circle cx="32" cy="37" r="21" fill="#8d5524"/>
   <ellipse cx="32" cy="45" rx="10" ry="8" fill="#e0b184"/><ellipse cx="32" cy="41" rx="4" ry="3" fill="#2b1a0e"/>${_eye(23,33)}${_eye(41,33)}
   <path d="M32 44v3M28 48q4 2.5 8 0" fill="none" stroke="#2b1a0e" stroke-width="1.6" stroke-linecap="round"/>`,
  // panda
  `<rect width="64" height="64" fill="#e0fbfc"/><circle cx="14" cy="16" r="8" fill="#1d1d28"/><circle cx="50" cy="16" r="8" fill="#1d1d28"/>
   <circle cx="32" cy="37" r="21" fill="#fff"/><ellipse cx="23" cy="34" rx="6" ry="8" fill="#1d1d28" transform="rotate(20 23 34)"/>
   <ellipse cx="41" cy="34" rx="6" ry="8" fill="#1d1d28" transform="rotate(-20 41 34)"/><circle cx="23.5" cy="34" r="2.4" fill="#fff"/><circle cx="40.5" cy="34" r="2.4" fill="#fff"/>
   <ellipse cx="32" cy="44" rx="4" ry="3" fill="#1d1d28"/><path d="M32 47v2M28 50q4 2.5 8 0" fill="none" stroke="#1d1d28" stroke-width="1.6" stroke-linecap="round"/>`,
  // owl
  `<rect width="64" height="64" fill="#b5838d"/><path d="M12 8l10 12H10z M52 8L42 20h12z" fill="#6b4226"/><ellipse cx="32" cy="38" rx="21" ry="22" fill="#8d5a2b"/>
   <ellipse cx="32" cy="46" rx="12" ry="12" fill="#e7c9a0"/><circle cx="22" cy="31" r="10" fill="#f6e7c1"/><circle cx="42" cy="31" r="10" fill="#f6e7c1"/>
   <circle cx="22" cy="31" r="6" fill="#f4a100"/><circle cx="42" cy="31" r="6" fill="#f4a100"/><circle cx="22" cy="31" r="3" fill="#111"/><circle cx="42" cy="31" r="3" fill="#111"/>
   <path d="M28 38h8l-4 8z" fill="#e8590c"/>`,
  // cat
  `<rect width="64" height="64" fill="#ffe5ec"/><path d="M10 6l5 22 14-9z" fill="#e0833b"/><path d="M54 6l-5 22-14-9z" fill="#e0833b"/>
   <path d="M13 12l3 12 7-4z M51 12l-3 12-7-4z" fill="#ffb3c1"/><ellipse cx="32" cy="38" rx="22" ry="19" fill="#f4a261"/>
   <path d="M32 19v8M24 21l2 6M40 21l-2 6" stroke="#c76a2a" stroke-width="2.2" stroke-linecap="round"/>${_eye(23,36)}${_eye(41,36)}
   <path d="M29 42h6l-3 3.5z" fill="#e5567d"/><path d="M32 45.5v2.5M27 49q5 2 5-1.5 0 3.5 5 1.5" fill="none" stroke="#5a2d12" stroke-width="1.5" stroke-linecap="round"/>
   <path d="M8 40l11 2M8 46l11-2M56 40l-11 2M56 46l-11-2" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/>`,
  // bull
  `<rect width="64" height="64" fill="#ffd6a5"/><path d="M12 28Q0 24 4 8Q10 18 20 22z" fill="#f8f4e3" stroke="#bfae7d" stroke-width="1.2"/>
   <path d="M52 28Q64 24 60 8Q54 18 44 22z" fill="#f8f4e3" stroke="#bfae7d" stroke-width="1.2"/><ellipse cx="10" cy="32" rx="6" ry="4" fill="#5c3b20"/><ellipse cx="54" cy="32" rx="6" ry="4" fill="#5c3b20"/>
   <path d="M15 20Q32 12 49 20L46 46Q32 54 18 46z" fill="#6b4226"/><ellipse cx="32" cy="46" rx="13" ry="10" fill="#f0a9a0"/>
   <ellipse cx="27" cy="46" rx="2.2" ry="3" fill="#7a2e2e"/><ellipse cx="37" cy="46" rx="2.2" ry="3" fill="#7a2e2e"/>${_eye(23,33,3)}${_eye(41,33,3)}
   <path d="M20 29l7 3M44 29l-7 3" stroke="#2b1a0e" stroke-width="2" stroke-linecap="round"/><circle cx="32" cy="54" r="3.5" fill="none" stroke="#e9b949" stroke-width="1.8"/>`,
  // boar
  `<rect width="64" height="64" fill="#caffbf"/><path d="M10 10l12 9-13 8z M54 10L42 19l13 8z" fill="#4a3a30"/><path d="M12 25Q32 15 52 25L49 47Q32 58 15 47z" fill="#6d5a4d"/>
   <ellipse cx="32" cy="45" rx="13" ry="10" fill="#d99a8c"/><ellipse cx="27.5" cy="45" rx="2.2" ry="3" fill="#6e3030"/><ellipse cx="36.5" cy="45" rx="2.2" ry="3" fill="#6e3030"/>
   <path d="M19 50Q14 46 16 38Q20 44 23 48z M45 50Q50 46 48 38Q44 44 41 48z" fill="#fffbe6" stroke="#c9b98a" stroke-width="1"/>${_eye(23,33,3)}${_eye(41,33,3)}
   <path d="M19 29l7 2M45 29l-7 2" stroke="#1b1b1b" stroke-width="2" stroke-linecap="round"/>`,
  // eagle
  `<rect width="64" height="64" fill="#a0c4ff"/><path d="M6 64Q10 44 32 42Q54 44 58 64z" fill="#6b4226"/><path d="M20 62q12-8 24 0" fill="none" stroke="#fff" stroke-width="3"/>
   <path d="M14 30Q16 8 32 8Q48 8 50 30Q46 44 32 46Q18 44 14 30z" fill="#fafafa"/><path d="M13 29Q22 22 32 24Q42 22 51 29" fill="none" stroke="#ddd" stroke-width="2"/>
   <path d="M24 31Q32 28 40 31L32 52Q26 44 24 31z" fill="#f2b705"/><path d="M32 52L28 41h8z" fill="#d68c00"/>
   <circle cx="23" cy="26" r="3.6" fill="#fff"/><circle cx="41" cy="26" r="3.6" fill="#fff"/><circle cx="23.5" cy="26.5" r="2" fill="#111"/><circle cx="40.5" cy="26.5" r="2" fill="#111"/>
   <path d="M17 20l9 4M47 20l-9 4" stroke="#6b4226" stroke-width="2.4" stroke-linecap="round"/>`,
  // robot
  `<rect width="64" height="64" fill="#adb5bd"/><path d="M32 4v9" stroke="#495057" stroke-width="3"/><circle cx="32" cy="5" r="3.5" fill="#e63946"/>
   <rect x="11" y="13" width="42" height="40" rx="9" fill="#ced4da" stroke="#868e96" stroke-width="2"/><rect x="16" y="23" width="32" height="14" rx="7" fill="#212529"/>
   <circle cx="25" cy="30" r="4.4" fill="#22d3ee"/><circle cx="39" cy="30" r="4.4" fill="#22d3ee"/><circle cx="26" cy="29" r="1.4" fill="#fff"/><circle cx="40" cy="29" r="1.4" fill="#fff"/>
   <path d="M22 45h20M26 45v4M32 45v4M38 45v4" stroke="#495057" stroke-width="2.2" stroke-linecap="round"/><rect x="6" y="26" width="5" height="12" rx="2" fill="#868e96"/><rect x="53" y="26" width="5" height="12" rx="2" fill="#868e96"/>`,
];
function avatarSvg(id){
  const art = AVATARS[id % AVATARS.length];
  return `<svg viewBox="0 0 64 64" aria-hidden="true">${art}</svg>`;
}
