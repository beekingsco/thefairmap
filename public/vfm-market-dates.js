'use strict';

// First Monday Trade Days runs Thursday through Sunday before the first
// Monday of each month — never on Monday. Gates open Thursday 8:00 and the
// grounds close Sunday 16:00, America/Chicago.
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof root !== 'undefined') root.VfmMarketDates = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var CHICAGO = 'America/Chicago';
  var WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  var OPEN_HOUR = 8;
  var CLOSE_HOUR = 16;

  function chicagoParts(date) {
    var fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: CHICAGO,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      weekday: 'short'
    });
    var bag = {};
    var parts = fmt.formatToParts(date);
    for (var i = 0; i < parts.length; i += 1) {
      if (parts[i].type !== 'literal') bag[parts[i].type] = parts[i].value;
    }
    var hour = Number(bag.hour);
    if (hour === 24) hour = 0;
    return {
      year: Number(bag.year),
      month: Number(bag.month),
      day: Number(bag.day),
      hour: hour,
      minute: Number(bag.minute),
      second: Number(bag.second),
      weekday: String(bag.weekday || '').replace('.', '')
    };
  }

  function weekdayIndex(year, month, day) {
    // 18:00 UTC is afternoon in Chicago on the same calendar date, including DST.
    var probe = new Date(Date.UTC(year, month - 1, day, 18, 0, 0));
    var wd = new Intl.DateTimeFormat('en-US', {
      timeZone: CHICAGO,
      weekday: 'short'
    }).format(probe).replace('.', '');
    var idx = WEEKDAYS.indexOf(wd);
    if (idx < 0) throw new Error('Unrecognized Chicago weekday: ' + wd);
    return idx;
  }

  function addDays(year, month, day, delta) {
    var dt = new Date(Date.UTC(year, month - 1, day + delta));
    return {
      year: dt.getUTCFullYear(),
      month: dt.getUTCMonth() + 1,
      day: dt.getUTCDate()
    };
  }

  function firstMonday(year, month) {
    var day = 1;
    while (weekdayIndex(year, month, day) !== 1) day += 1;
    return { year: year, month: month, day: day };
  }

  function marketWindow(year, month) {
    var monday = firstMonday(year, month);
    var open = addDays(monday.year, monday.month, monday.day, -4);
    var close = addDays(monday.year, monday.month, monday.day, -1);
    if (weekdayIndex(open.year, open.month, open.day) !== 4) {
      throw new Error('Market open is not Thursday');
    }
    if (weekdayIndex(close.year, close.month, close.day) !== 0) {
      throw new Error('Market close is not Sunday');
    }
    return { open: open, close: close, monday: monday };
  }

  function chicagoOffsetMs(instant) {
    var p = chicagoParts(instant);
    var asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    return asUtc - instant.getTime();
  }

  function chicagoWallTimeToUtcMs(year, month, day, hour, minute, second) {
    var guess = Date.UTC(year, month - 1, day, hour, minute, second || 0);
    var utc = guess - chicagoOffsetMs(new Date(guess));
    var utc2 = guess - chicagoOffsetMs(new Date(utc));
    return utc2;
  }

  function shiftMonth(year, month, delta) {
    var index = (year * 12) + (month - 1) + delta;
    return {
      year: Math.floor(index / 12),
      month: (index % 12) + 1
    };
  }

  function withInstants(window) {
    return {
      open: window.open,
      close: window.close,
      monday: window.monday,
      openMs: chicagoWallTimeToUtcMs(window.open.year, window.open.month, window.open.day, OPEN_HOUR, 0, 0),
      closeMs: chicagoWallTimeToUtcMs(window.close.year, window.close.month, window.close.day, CLOSE_HOUR, 0, 0)
    };
  }

  function getActiveWindow(now) {
    var p = chicagoParts(now || new Date());
    var nowMs = (now || new Date()).getTime();
    for (var i = 0; i < 18; i += 1) {
      var cursor = shiftMonth(p.year, p.month, i);
      var window = withInstants(marketWindow(cursor.year, cursor.month));
      if (nowMs <= window.closeMs) return window;
    }
    return withInstants(marketWindow(p.year, p.month));
  }

  function formatRange(open, close) {
    var openMonth = MONTHS[open.month - 1];
    var closeMonth = MONTHS[close.month - 1];
    if (open.year === close.year && open.month === close.month) {
      return openMonth + ' ' + open.day + '-' + close.day;
    }
    if (open.year === close.year) {
      return openMonth + ' ' + open.day + '-' + closeMonth + ' ' + close.day;
    }
    return openMonth + ' ' + open.day + ', ' + open.year + '-' + closeMonth + ' ' + close.day + ', ' + close.year;
  }

  function formatLong(date) {
    return MONTHS[date.month - 1] + ' ' + date.day + ', ' + date.year;
  }

  return {
    CHICAGO: CHICAGO,
    OPEN_HOUR: OPEN_HOUR,
    CLOSE_HOUR: CLOSE_HOUR,
    chicagoParts: chicagoParts,
    weekdayIndex: weekdayIndex,
    firstMonday: firstMonday,
    marketWindow: marketWindow,
    getActiveWindow: getActiveWindow,
    formatRange: formatRange,
    formatLong: formatLong
  };
});
