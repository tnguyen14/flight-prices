"""Shared formatting helpers for time and date values."""

import re


def fmt_time_tuple(t: tuple[int, int]) -> str:
    """Format (hour, minute) tuple as 'H:MM AM/PM'. Used by swoop backend."""
    h, m = t
    return _fmt_hm(h, m)


def fmt_time_list(t) -> str:
    """Format [hour, minute] list as 'H:MM AM/PM'. Handles None/missing values. Used by fast backend."""
    if not t:
        return "N/A"
    h = t[0] if t[0] is not None else 0
    m = t[1] if len(t) > 1 and t[1] is not None else 0
    return _fmt_hm(h, m)


def _fmt_hm(h: int, m: int) -> str:
    if h == 0:
        return f"12:{m:02d} AM"
    elif h < 12:
        return f"{h}:{m:02d} AM"
    elif h == 12:
        return f"12:{m:02d} PM"
    else:
        return f"{h - 12}:{m:02d} PM"


def fmt_date_tuple(d: tuple[int, int, int]) -> str:
    """Format (year, month, day) tuple as 'YYYY-MM-DD'."""
    return f"{d[0]:04d}-{d[1]:02d}-{d[2]:02d}"


def fmt_date_list(d) -> str:
    """Format [year, month, day] list as 'YYYY-MM-DD'."""
    return f"{d[0]:04d}-{d[1]:02d}-{d[2]:02d}"


def time_to_minutes(time_str: str) -> int:
    """Convert 'H:MM AM/PM' to minutes since midnight for sorting."""
    m = re.match(r'(\d{1,2}):(\d{2})\s*(AM|PM)', time_str, re.IGNORECASE)
    if not m:
        return 0
    hours = int(m.group(1))
    minutes = int(m.group(2))
    period = m.group(3).upper()
    if period == "PM" and hours != 12:
        hours += 12
    if period == "AM" and hours == 12:
        hours = 0
    return hours * 60 + minutes
