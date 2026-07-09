/**
 * Month price calendar (design handoff screen 3): one cell per night with the
 * server's price, the nearby-hotels price-range caption and a position marker
 * colored by where the price sits in that range. Days with a pending
 * recommendation are buttons that jump to the matching card below. No
 * animation — by design.
 *
 * All derivation lives in calendarModel.ts (pure, unit-tested); this file is
 * presentation only.
 */

import { useState } from 'react';
import { formatMoney, formatMoneyBare } from '../../components/Money';
import { Explainer } from '../../components/Explainer';
import { IconChevronLeft, IconChevronRight, IconSpire } from '../../components/icons';
import type { CalendarDay, CalendarRow } from './calendarModel';
import {
  buildCalendarModel,
  monthLabel,
  monthsWithData,
  roomTypeNamesFrom,
} from './calendarModel';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function cellClass(day: CalendarDay): string {
  if (!day.inMonth) return 'cal-cell cal-cell-out';
  if (day.eventName) return 'cal-cell cal-cell-event';
  if (day.isWeekend) return 'cal-cell cal-cell-weekend';
  return 'cal-cell';
}

function longDate(isoDate: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(Date.parse(`${isoDate}T00:00:00Z`));
}

/** Visual clamp so the marker dot never bleeds past the rounded track ends. */
function markerLeft(position: number): string {
  return `${Math.round(6 + position * 88)}%`;
}

function DayCellContent({ day }: { day: CalendarDay }) {
  return (
    <>
      <span className="cal-cell-top">
        <span className="cal-day-num">
          {day.inMonth ? Number(day.date.slice(8, 10)) : ''}
        </span>
        {day.eventName && (
          <span className="event-pill" title={day.eventName}>
            <IconSpire />
            event
          </span>
        )}
      </span>
      {day.price !== undefined && day.currency && (
        <>
          <span className="cal-price">
            {formatMoney(day.price, day.currency, { stripWholeFraction: true })}
          </span>
          {day.bandLow !== undefined && day.bandHigh !== undefined && (
            <span className="cal-range">
              vs {formatMoneyBare(day.bandLow)}–{formatMoneyBare(day.bandHigh)}
            </span>
          )}
          {day.position !== undefined && day.markerClass && (
            <span className="cal-band" aria-hidden="true">
              <span
                className={`cal-marker ${day.markerClass}`}
                style={{ left: markerLeft(day.position) }}
              />
            </span>
          )}
        </>
      )}
    </>
  );
}

interface PriceCalendarProps {
  rows: CalendarRow[];
  propertyName: string;
  /** Called with the recommendation id when a pending day cell is activated. */
  onDayClick: (recommendationId: string) => void;
}

export function PriceCalendar({ rows, propertyName, onDayClick }: PriceCalendarProps) {
  const [monthChoice, setMonthChoice] = useState<string | null>(null);
  const [roomChoice, setRoomChoice] = useState<string | null>(null);

  const roomNames = roomTypeNamesFrom(rows);
  if (roomNames.length === 0) return null;

  // Fall back gracefully when the stored choice no longer exists in the data
  // (property switch, range change): first room name, first month with data.
  const room = roomChoice && roomNames.includes(roomChoice) ? roomChoice : roomNames[0];
  // Month bounds follow the SELECTED room — rooms can have data in different
  // months, and a grid of 42 blank cells helps no one.
  const roomRows = rows.filter((row) => row.roomTypeName === room);
  const months = monthsWithData(roomRows);
  if (months.length === 0) return null;
  const month = monthChoice && months.includes(monthChoice) ? monthChoice : months[0];
  const monthIndex = months.indexOf(month);
  const days = buildCalendarModel(roomRows, month, room);

  return (
    <section className="cal-card" aria-label="Price calendar">
      <div className="cal-head">
        <div className="cal-head-left">
          <h3 className="cal-month">{monthLabel(month)}</h3>
          <span className="cal-caption">
            {propertyName} · {room}
          </span>
          <Explainer label="the price range">
            This is what nearby hotels charge for the same night — the
            lowest and highest rate we found among them.
          </Explainer>
          <span className="cal-nav">
            <button
              type="button"
              className="btn-icon"
              aria-label="Previous month"
              disabled={monthIndex <= 0}
              onClick={() => setMonthChoice(months[monthIndex - 1])}
            >
              <IconChevronLeft />
            </button>
            <button
              type="button"
              className="btn-icon"
              aria-label="Next month"
              disabled={monthIndex >= months.length - 1}
              onClick={() => setMonthChoice(months[monthIndex + 1])}
            >
              <IconChevronRight />
            </button>
          </span>
          {roomNames.length > 1 && (
            <label className="cal-room-field">
              Room type
              <select
                value={room}
                onChange={(event) => setRoomChoice(event.target.value)}
              >
                {roomNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div className="cal-legend">
          <span>
            <span className="legend-dot legend-raise" aria-hidden="true" />
            Room to raise
          </span>
          <span>
            <span className="legend-dot legend-well" aria-hidden="true" />
            Well placed
          </span>
          <span>
            <span className="legend-dot legend-top" aria-hidden="true" />
            Near the top
          </span>
        </div>
      </div>

      <div className="cal-weekdays">
        {WEEKDAYS.map((weekday) => (
          <div key={weekday}>{weekday}</div>
        ))}
      </div>

      <div className="cal-grid">
        {days.map((day) =>
          day.hasPending && day.recommendationId ? (
            <button
              key={day.date}
              type="button"
              className={cellClass(day)}
              aria-label={`Review the suggested price for ${longDate(day.date)}`}
              onClick={() => onDayClick(day.recommendationId as string)}
            >
              <DayCellContent day={day} />
            </button>
          ) : (
            <div key={day.date} className={cellClass(day)}>
              <DayCellContent day={day} />
            </div>
          ),
        )}
      </div>
    </section>
  );
}
