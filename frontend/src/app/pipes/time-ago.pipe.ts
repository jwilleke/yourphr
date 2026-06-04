import { Pipe, PipeTransform } from '@angular/core';

/**
 * Relative "x ago" formatting (replacement for ngx-moment's amTimeAgo).
 * Pure pipe: computes once at render — fine for transient/refreshed views
 * (toasts, the background-jobs list). Falls back to '' for empty input.
 */
@Pipe({
    name: 'timeAgo',
    standalone: false
})
export class TimeAgoPipe implements PipeTransform {
  transform(value: string | number | Date | null | undefined): string {
    if (value === null || value === undefined || value === '') {
      return '';
    }
    const then = new Date(value).getTime();
    if (isNaN(then)) {
      return '';
    }
    const seconds = Math.floor((Date.now() - then) / 1000);
    if (seconds < 0) {
      return 'in the future';
    }
    if (seconds < 5) {
      return 'just now';
    }
    const intervals: [string, number][] = [
      ['year', 31536000],
      ['month', 2592000],
      ['day', 86400],
      ['hour', 3600],
      ['minute', 60],
      ['second', 1],
    ];
    for (const [label, secs] of intervals) {
      const count = Math.floor(seconds / secs);
      if (count >= 1) {
        return `${count} ${label}${count > 1 ? 's' : ''} ago`;
      }
    }
    return 'just now';
  }
}
