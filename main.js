const fs = require("fs");

function timeToSeconds(timeStr) {
  timeStr = timeStr.trim();
  const parts = timeStr.split(" ");
  const [h, m, s] = parts[0].split(":").map(Number);
  const period = parts[1].toLowerCase();
  let hours = h;
  if (period === "am") {
    if (hours === 12) hours = 0;
  } else {
    if (hours !== 12) hours += 12;
  }
  return hours * 3600 + m * 60 + s;
}

function durationToSeconds(dur) {
  const [h, m, s] = dur.trim().split(":").map(Number);
  return h * 3600 + m * 60 + s;
}

function secondsToDuration(totalSec) {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function secondsToLongDuration(totalSec) {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function getShiftDuration(startTime, endTime) {
  const startSec = timeToSeconds(startTime);
  const endSec = timeToSeconds(endTime);
  return secondsToDuration(endSec - startSec);
}

function getIdleTime(startTime, endTime) {
  const startSec = timeToSeconds(startTime);
  const endSec = timeToSeconds(endTime);
  const deliveryStart = 8 * 3600;
  const deliveryEnd = 22 * 3600;
  let idle = 0;
  if (startSec < deliveryStart) {
    idle += Math.min(deliveryStart, endSec) - startSec;
  }
  if (endSec > deliveryEnd) {
    idle += endSec - Math.max(deliveryEnd, startSec);
  }
  if (idle < 0) idle = 0;
  return secondsToDuration(idle);
}

function getActiveTime(shiftDuration, idleTime) {
  return secondsToDuration(durationToSeconds(shiftDuration) - durationToSeconds(idleTime));
}

function metQuota(date, activeTime) {
  const activeSec = durationToSeconds(activeTime);
  const [year, month, day] = date.split("-").map(Number);
  const isEid = year === 2025 && month === 4 && day >= 10 && day <= 30;
  const quotaSec = isEid ? 6 * 3600 : 8 * 3600 + 24 * 60;
  return activeSec >= quotaSec;
}

function addShiftRecord(textFile, shiftObj) {
  const { driverID, driverName, date, startTime, endTime } = shiftObj;
  let lines = [];
  if (fs.existsSync(textFile)) {
    const content = fs.readFileSync(textFile, "utf8").trim();
    if (content) lines = content.split("\n");
  }
  for (const line of lines) {
    const cols = line.split(",");
    if (cols[0].trim() === driverID && cols[2].trim() === date) {
      return {};
    }
  }
  const shiftDuration = getShiftDuration(startTime, endTime);
  const idleTime = getIdleTime(startTime, endTime);
  const activeTime = getActiveTime(shiftDuration, idleTime);
  const quota = metQuota(date, activeTime);
  const hasBonus = false;
  const newRecord = {
    driverID, driverName, date,
    startTime: startTime.trim(),
    endTime: endTime.trim(),
    shiftDuration, idleTime, activeTime,
    metQuota: quota, hasBonus
  };
  const newLine = `${driverID},${driverName},${date},${startTime.trim()},${endTime.trim()},${shiftDuration},${idleTime},${activeTime},${quota},${hasBonus}`;
  let lastIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].split(",")[0].trim() === driverID) lastIndex = i;
  }
  if (lastIndex === -1) {
    lines.push(newLine);
  } else {
    lines.splice(lastIndex + 1, 0, newLine);
  }
  fs.writeFileSync(textFile, lines.join("\n") + "\n", "utf8");
  return newRecord;
}

function setBonus(textFile, driverID, date, newValue) {
  const lines = fs.readFileSync(textFile, "utf8").trim().split("\n");
  for (let i = 0; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols[0].trim() === driverID && cols[2].trim() === date) {
      cols[9] = String(newValue);
      lines[i] = cols.join(",");
      break;
    }
  }
  fs.writeFileSync(textFile, lines.join("\n") + "\n", "utf8");
}

function countBonusPerMonth(textFile, driverID, month) {
  const lines = fs.readFileSync(textFile, "utf8").trim().split("\n");
  const targetMonth = parseInt(month, 10);
  let found = false;
  let count = 0;
  for (const line of lines) {
    const cols = line.split(",");
    if (cols[0].trim() === driverID) {
      found = true;
      const recordMonth = parseInt(cols[2].trim().split("-")[1], 10);
      if (recordMonth === targetMonth && cols[9].trim() === "true") count++;
    }
  }
  return found ? count : -1;
}

function getTotalActiveHoursPerMonth(textFile, driverID, month) {
  const lines = fs.readFileSync(textFile, "utf8").trim().split("\n");
  let totalSec = 0;
  for (const line of lines) {
    const cols = line.split(",");
    if (cols[0].trim() === driverID) {
      const recordMonth = parseInt(cols[2].trim().split("-")[1], 10);
      if (recordMonth === month) totalSec += durationToSeconds(cols[7].trim());
    }
  }
  return secondsToLongDuration(totalSec);
}

function getRequiredHoursPerMonth(textFile, rateFile, bonusCount, driverID, month) {
  const rateLines = fs.readFileSync(rateFile, "utf8").trim().split("\n");
  let dayOff = null;
  for (const line of rateLines) {
    const cols = line.split(",");
    if (cols[0].trim() === driverID) {
      dayOff = cols[1].trim();
      break;
    }
  }
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const shiftLines = fs.readFileSync(textFile, "utf8").trim().split("\n");
  let totalSec = 0;
  for (const line of shiftLines) {
    const cols = line.split(",");
    if (cols[0].trim() !== driverID) continue;
    const dateStr = cols[2].trim();
    const recordMonth = parseInt(dateStr.split("-")[1], 10);
    if (recordMonth !== month) continue;
    const dateObj = new Date(dateStr);
    if (dayNames[dateObj.getDay()] === dayOff) continue;
    const [y, mo, d] = dateStr.split("-").map(Number);
    const isEid = y === 2025 && mo === 4 && d >= 10 && d <= 30;
    totalSec += isEid ? 6 * 3600 : 8 * 3600 + 24 * 60;
  }
  totalSec -= bonusCount * 2 * 3600;
  if (totalSec < 0) totalSec = 0;
  return secondsToLongDuration(totalSec);
}

function getNetPay(driverID, actualHours, requiredHours, rateFile) {
  const rateLines = fs.readFileSync(rateFile, "utf8").trim().split("\n");
  let basePay = 0;
  let tier = 0;
  for (const line of rateLines) {
    const cols = line.split(",");
    if (cols[0].trim() === driverID) {
      basePay = parseInt(cols[2].trim(), 10);
      tier = parseInt(cols[3].trim(), 10);
      break;
    }
  }
  const allowedMissing = { 1: 50, 2: 20, 3: 10, 4: 3 };
  const allowedSec = allowedMissing[tier] * 3600;
  const actualSec = durationToSeconds(actualHours);
  const requiredSec = durationToSeconds(requiredHours);
  if (actualSec >= requiredSec) return basePay;
  const missingSec = requiredSec - actualSec;
  if (missingSec <= allowedSec) return basePay;
  const billableHours = Math.floor((missingSec - allowedSec) / 3600);
  const deductionRatePerHour = Math.floor(basePay / 185);
  return basePay - billableHours * deductionRatePerHour;
}

module.exports = {
  getShiftDuration,
  getIdleTime,
  getActiveTime,
  metQuota,
  addShiftRecord,
  setBonus,
  countBonusPerMonth,
  getTotalActiveHoursPerMonth,
  getRequiredHoursPerMonth,
  getNetPay
};
