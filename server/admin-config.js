"use strict";
/* =========================================================================
   ADMIN-EDITABLE GAME SETTINGS
   ---------------------------------------------------------------------
   Which of the keys in src/config.json an admin may change for online games,
   what values are acceptable, and how they are grouped on the admin page.
   Settings that only affect how a browser shows the game (spectator delay,
   wrap display, …) are not here: the server has no use for them.

   A change applies to games created afterwards; a game keeps the settings it
   was created with (games.config).
   ========================================================================= */
const num = (label, min, max, step, hint)=> ({kind:'number', label, min, max, step, hint});
const PERSONALITIES = [['Balanced','Cân bằng'], ['Turtle','Rùa'], ['Rusher','Xông pha'], ['Opportunist','Cơ hội']];

const GROUPS = [
  { title:'AI theo độ khó', fields:{
    ...Object.fromEntries([['Easy','Dễ'],['Normal','Thường'],['Hard','Khó']].flatMap(([k,vn])=> [
      ['ai'+k+'Threshold', num(vn+' — ngưỡng đánh', 1, 5, 0.05, 'Tỉ lệ quân ta / quân địch tối thiểu để AI chịu tấn công')],
      ['ai'+k+'Reserve', num(vn+' — giữ quân', 0, 3, 0.05, 'Phần quân giữ lại để phòng các địch kề bên khác')],
    ])),
  }},
  { title:'Tính cách AI (chỉnh thêm lên trên độ khó)', fields:{
    ...Object.fromEntries(PERSONALITIES.flatMap(([k,vn])=> [
      ['pers'+k+'ThresholdAdj', num(vn+' — ngưỡng ±', -2, 2, 0.05, 'Cộng vào ngưỡng tấn công của độ khó (âm = hung hăng hơn)')],
      ['pers'+k+'ReserveMult', num(vn+' — giữ quân ×', 0, 5, 0.1, 'Nhân với mức giữ quân phòng thủ của độ khó')],
      ['pers'+k+'KillBonus', num(vn+' — diệt ×', 0, 5, 0.1, 'Nhân với điểm thưởng khi diệt được người chơi yếu')],
      ['pers'+k+'ContinentBonus', num(vn+' — châu lục ×', 0, 5, 0.1, 'Nhân với điểm thưởng khi chiếm trọn châu lục')],
    ])),
  }},
  { title:'Liên minh & sức mạnh', fields:{
    allianceLeaderVsField: num('Leader khi sức mạnh ≥ … × tổng những người còn lại', 0, 5, 0.05),
    allianceLeaderMargin: num('… và ≥ … × người đứng thứ 2', 1, 5, 0.05),
    powerWeightArmies: num('Sức mạnh: trọng số quân', 0, 20, 0.5),
    powerWeightTerritories: num('Sức mạnh: trọng số lãnh thổ', 0, 20, 0.5),
    powerWeightReinforcements: num('Sức mạnh: trọng số tăng viện/lượt', 0, 50, 0.5),
  }},
  { title:'Thẻ bài & tăng viện', fields:{
    cardAwardEvent: {kind:'enum', label:'Phát thẻ', options:[
      ['on_capture','khi chiếm được lãnh thổ'], ['on_kill','khi diệt được ít nhất 1 quân địch'], ['on_turn_end','hết lượt là có']]},
    tradeValues: {kind:'list', label:'Bảng đổi thẻ', hint:'Số quân nhận được ở lần đổi thứ 1, 2, 3… (cách nhau bởi dấu phẩy)', min:1, max:1000, maxLength:30},
    tradeProgressiveStep: num('Luỹ tiến: hết bảng thì + … mỗi lần', 0, 50, 1),
    tradeExpBase: num('Theo cá nhân: số quân lần đổi đầu', 1, 50, 1),
    tradeExpGrowth: num('Theo cá nhân: hệ số nhân mỗi lần', 1, 3, 0.05),
    reinforceMin: num('Tăng viện tối thiểu mỗi lượt', 0, 20, 1),
    reinforceDivisor: num('Tăng viện = lãnh thổ ÷ …', 1, 10, 1),
  }},
];
const FIELDS = Object.assign({}, ...GROUPS.map(g=> g.fields));

// Returns {values} with only known keys and acceptable values, or {error, key}.
function validateSettings(input){
  if(!input || typeof input!=='object' || Array.isArray(input)) return {error:'bad_settings'};
  const values = {};
  for(const key of Object.keys(input)){
    const f = Object.prototype.hasOwnProperty.call(FIELDS, key) ? FIELDS[key] : null;
    if(!f) return {error:'unknown_setting', key};
    const v = input[key];
    if(f.kind==='number'){
      if(typeof v!=='number' || !Number.isFinite(v) || v<f.min || v>f.max) return {error:'bad_value', key};
    } else if(f.kind==='enum'){
      if(!f.options.some(o=> o[0]===v)) return {error:'bad_value', key};
    } else if(f.kind==='list'){
      if(!Array.isArray(v) || v.length<1 || v.length>f.maxLength ||
         !v.every(n=> Number.isInteger(n) && n>=f.min && n<=f.max)) return {error:'bad_value', key};
    }
    values[key] = v;
  }
  return {values};
}
// Only the admin-editable part of a full config object.
function pickEditable(config){
  const out = {};
  for(const key of Object.keys(FIELDS)) out[key] = config[key];
  return out;
}

module.exports = { GROUPS, FIELDS, validateSettings, pickEditable };
